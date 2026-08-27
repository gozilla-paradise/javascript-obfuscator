/* eslint-disable */
import { inject, injectable } from 'inversify';
import * as ESTree from 'estree';
import * as estraverse from '@javascript-obfuscator/estraverse';
import type * as eslintScope from 'eslint-scope';
import { ScopeAnalyzer } from '../analyzers/scope-analyzer/ScopeAnalyzer';
import { ServiceIdentifiers } from '../container/ServiceIdentifiers';


import { VMFunctionFlag } from '../enums/vm/VMFlag';
import { VMOpcode } from '../enums/vm/VMOpcode';
import {
    VMBinaryOperator,
    VMCaptureSource,
    VMPrivateOperation,
    VMPropertyKind,
    VMReferenceKind,
    VMUnaryOperator,
    VMUpdateOperator
} from '../enums/vm/VMOperand';


import { VMUnsupportedSyntaxError } from '../errors/VMUnsupportedSyntaxError';

import type { IOptions } from '../interfaces/options/IOptions';
import { IVMCompiler } from '../interfaces/vm/IVMCompiler';
import {
    IVMExceptionRow,

    IVMFunction,
    IVMProgram,
    TVMConstant,
    VMConstantTag
} from '../interfaces/vm/IVMProgram';
import { IVMSelectedFunction, TVMFunctionNode } from '../interfaces/vm/IVMSelectedFunction';
import { NodeMetadata } from '../node/NodeMetadata';
import { NodeUtils } from '../node/NodeUtils';

interface IVMCompileContext {
    readonly captures: Map<string, number>;
    readonly constants: VMConstantPool;
    readonly instructions: MutableVMInstruction[];
    readonly locals: Map<string, number>;
    readonly lexicalLocals: Set<string>;

    readonly node: TVMFunctionNode;
    readonly breakTargets: number[][];
    readonly continueTargets: number[][];
    readonly iteratorSlots: ({ readonly slot: number; readonly async: boolean } | null)[];
    readonly exceptionTable: IVMExceptionRow[];
    readonly finalizers: ESTree.BlockStatement[];
    withDepth: number;
    readonly captureNamesByNode: Map<TVMFunctionNode, readonly string[]>;
    readonly operationsByNode: Map<
        TVMFunctionNode,
        readonly ESTree.ArrowFunctionExpression[]
    >;
    readonly operations: ESTree.ArrowFunctionExpression[];


}

interface MutableVMInstruction {
    address: number;
    nextAddress: number;
    opcode: number;
    operands: number[];
}

class VMConstantPool {
    private readonly constants: TVMConstant[] = [];
    private readonly indexes: Map<string, number> = new Map();

    public add(constant: TVMConstant): number {
        const key: string = VMConstantPool.getKey(constant);
        const existing: number | undefined = this.indexes.get(key);

        if (existing !== undefined) {
            return existing;
        }

        const index: number = this.constants.length;
        this.constants.push(constant);
        this.indexes.set(key, index);

        return index;
    }

    public getConstants(): readonly TVMConstant[] {
        return this.constants;
    }

    private static getKey(constant: TVMConstant): string {
        switch (constant[0]) {
            case VMConstantTag.Number:
                if (Number.isNaN(constant[1])) {
                    return 'number:nan';
                }
                if (Object.is(constant[1], -0)) {
                    return 'number:-0';
                }

                return `number:${String(constant[1])}`;

            case VMConstantTag.BigInt:
                return `bigint:${constant[1].toString(10)}`;

            case VMConstantTag.String:
                return `string:${constant[1]}`;

            case VMConstantTag.RegExp:
                return `regexp:${constant[1]}/${constant[2]}`;

            case VMConstantTag.SignedIntArray:
                return `ints:${constant[1].join(',')}`;

            default:
                return `tag:${constant[0]}`;
        }
    }
}

@injectable()
export class VMCompiler implements IVMCompiler {
    public static readonly runtimeIdentifier: string = '__jovm';
    public constructor(
        @inject(ServiceIdentifiers.IOptions) private readonly options: IOptions
    ) {}


    public compile(
        selection: readonly IVMSelectedFunction[],
        program: ESTree.Program
    ): IVMProgram {
        const constants: VMConstantPool = new VMConstantPool();
        const functionsById: Map<number, IVMFunction> = new Map();
        const selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction> = new Map(
            selection.map((selected: IVMSelectedFunction) => [selected.node, selected])
        );
        const scopeAnalyzer: ScopeAnalyzer = new ScopeAnalyzer();
        scopeAnalyzer.analyze(program);
        if (this.options.vmCallContextOpcodes) {
            VMCompiler.prepareCallContexts(selection, scopeAnalyzer, program);
        }
        const captureNamesByNode: Map<TVMFunctionNode, readonly string[]> = new Map(
            selection.map((selected: IVMSelectedFunction) => [
                selected.node,
                VMCompiler.collectCaptureNames(selected.node, scopeAnalyzer)
            ])
        );
        const operationsByNode: Map<
            TVMFunctionNode,
            readonly ESTree.ArrowFunctionExpression[]
        > = new Map();
        const compilationOrder: IVMSelectedFunction[] = [...selection].sort(
            (left: IVMSelectedFunction, right: IVMSelectedFunction) =>
                right.sourceStart - left.sourceStart
        );

        for (const selected of compilationOrder) {
            const captures: readonly string[] =
                captureNamesByNode.get(selected.node) ?? [];
            const locals: Map<string, number> = VMCompiler.collectLocalBindings(selected.node);
            const lexicalLocals: Set<string> = VMCompiler.collectLexicalBindings(selected.node);
            const context: IVMCompileContext = {
                captures: new Map(
                    captures.map((name: string, index: number) => [name, index])
                ),
                constants,
                instructions: [],
                locals,
                lexicalLocals,
                node: selected.node,
                breakTargets: [],
                continueTargets: [],
                iteratorSlots: [],
                exceptionTable: [],
                finalizers: [],
                withDepth: 0,
                captureNamesByNode,
                operationsByNode,
                operations: []
            };

            VMCompiler.emitLocalInitializers(context);

            if (selected.node.body.type === 'BlockStatement') {
                VMCompiler.compileStatements(selected.node.body.body, context, selectionByNode);
            } else {
                VMCompiler.compileExpression(selected.node.body, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.Return);
            }

            const terminalAddress: number = context.instructions.length;
            const hasTerminalJumpTarget: boolean = context.instructions.some(
                (instruction: MutableVMInstruction) =>
                    [
                        VMOpcode.Jump,
                        VMOpcode.JumpIfTrue,
                        VMOpcode.JumpIfFalse,
                        VMOpcode.JumpIfNullish
                    ].includes(instruction.opcode) &&
                    instruction.operands[0] === terminalAddress
            );

            if (
                context.instructions.length === 0 ||
                hasTerminalJumpTarget ||
                ![VMOpcode.Return, VMOpcode.Throw].includes(
                    context.instructions[context.instructions.length - 1].opcode
                )
            ) {
                VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                VMCompiler.emit(context, VMOpcode.Return);
            }

            VMCompiler.finalizeInstructions(context.instructions);
            const flags: number = VMCompiler.getFunctionFlags(selected.node);
            const vmFunction: IVMFunction = {
                id: selected.id,
                flags,
                arity: VMCompiler.getArity(selected.node.params),
                localCount: locals.size,
                captureCount: captures.length,
                instructions: context.instructions,
                exceptionTable: context.exceptionTable
            };

            operationsByNode.set(selected.node, [...context.operations]);
            functionsById.set(selected.id, vmFunction);
            VMCompiler.replaceFunctionBody(
                selected.node,
                selected.id,
                captures,
                flags,
                context.operations
            );
        }
        if (this.options.vmCallContextOpcodes) {
            VMCompiler.rewriteExternalCallContexts(program);
        }


        return {
            version: 1,
            flags: 0,
            constants: constants.getConstants(),
            functions: [...functionsById.values()].sort(
                (left: IVMFunction, right: IVMFunction) => left.id - right.id
            )
        };
    }

    private static prepareCallContexts(
        selection: readonly IVMSelectedFunction[],
        scopeAnalyzer: ScopeAnalyzer,
        program: ESTree.Program
    ): void {
        const selectedByNode: Map<TVMFunctionNode, IVMSelectedFunction> =
            new Map(
                selection.map((selected: IVMSelectedFunction) => [
                    selected.node,
                    selected
                ])
            );
        const pendingScopes: eslintScope.Scope[] = [
            scopeAnalyzer.acquireScope(program)
        ];

        while (pendingScopes.length > 0) {
            const scope: eslintScope.Scope = pendingScopes.pop()!;
            pendingScopes.push(...scope.childScopes);
            for (const variable of scope.variables) {
                let selected: IVMSelectedFunction | undefined;
                for (const definition of variable.defs) {
                    const definitionNode = definition.node as ESTree.Node;
                    if (
                        definitionNode.type === 'VariableDeclarator' &&
                        definitionNode.init &&
                        (definitionNode.init.type === 'FunctionExpression' ||
                            definitionNode.init.type ===
                                'ArrowFunctionExpression')
                    ) {
                        selected = selectedByNode.get(definitionNode.init);
                    } else if (
                        definitionNode.type === 'FunctionDeclaration'
                    ) {
                        selected = selectedByNode.get(definitionNode);
                    }
                    if (selected) {break;}
                }
                if (!selected || selected.node.generator) {
                    continue;
                }

                const directCalls: ESTree.CallExpression[] = [];
                let eligible = variable.references.length > 0;
                for (const reference of variable.references) {
                    const identifier = reference.identifier;
                    const parent = identifier.parentNode;
                    if (
                        parent?.type === 'VariableDeclarator' &&
                        parent.id === identifier
                    ) {
                        continue;
                    }
                    if (
                        parent?.type !== 'CallExpression' ||
                        parent.callee !== identifier ||
                        parent.optional
                    ) {
                        eligible = false;
                        break;
                    }
                    directCalls.push(parent);
                }
                if (!eligible || directCalls.length === 0) {
                    continue;
                }

                const token: number = VMCompiler.getCallContextToken(
                    selected.id
                );
                NodeMetadata.set(selected.node, {
                    vmCallContextToken: token
                });
                directCalls.forEach((call: ESTree.CallExpression) => {
                    NodeMetadata.set(call, {
                        vmCallContextFunctionId: selected.id,
                        vmCallContextToken: token
                    });
                });
            }
        }

        for (const selected of selection) {
            const method = selected.node.parentNode;
            if (
                selected.node.generator ||
                method?.type !== 'MethodDefinition' ||
                method.value !== selected.node ||
                method.static ||
                method.kind !== 'method' ||
                method.key.type !== 'PrivateIdentifier' ||
                method.parentNode?.type !== 'ClassBody'
            ) {
                continue;
            }
            const privateName: string = method.key.name;

            const directCalls: ESTree.CallExpression[] = [];
            let eligible = true;
            estraverse.traverse(method.parentNode, {
                enter: (
                    node: ESTree.Node,
                    parentNode: ESTree.Node | null
                ): void => {
                    if (
                        node.type !== 'MemberExpression' ||
                        node.property.type !== 'PrivateIdentifier' ||
                        node.property.name !== privateName
                    ) {
                        return;
                    }
                    if (
                        node.object.type !== 'ThisExpression' ||
                        parentNode?.type !== 'CallExpression' ||
                        parentNode.callee !== node ||
                        parentNode.optional
                    ) {
                        eligible = false;

                        return;
                    }
                    directCalls.push(parentNode);
                }
            });
            if (!eligible || directCalls.length === 0) {
                continue;
            }

            const token: number = VMCompiler.getCallContextToken(selected.id);
            NodeMetadata.set(selected.node, { vmCallContextToken: token });
            directCalls.forEach((call: ESTree.CallExpression) => {
                NodeMetadata.set(call, {
                    vmCallContextFunctionId: selected.id,
                    vmCallContextToken: token
                });
            });
        }
    }

    private static rewriteExternalCallContexts(
        program: ESTree.Program
    ): void {
        estraverse.replace(program, {
            leave: (node: ESTree.Node): ESTree.Node => {
                if (node.type !== 'CallExpression') {
                    return node;
                }
                const token = NodeMetadata.get<
                    ESTree.CallExpressionNodeMetadata,
                    'vmCallContextToken'
                >(node, 'vmCallContextToken');
                if (token === undefined) {
                    return node;
                }

                return {
                    type: 'CallExpression',
                    optional: false,
                    callee: {
                        type: 'MemberExpression',
                        computed: false,
                        optional: false,
                        object: {
                            type: 'Identifier',
                            name: VMCompiler.runtimeIdentifier
                        },
                        property: {
                            type: 'Identifier',
                            name: 'callWithContext'
                        }
                    },
                    arguments: [
                        {
                            type: 'Literal',
                            value: token,
                            raw: String(token)
                        },
                        node.callee as ESTree.Expression,
                        node.callee.type === 'MemberExpression' &&
                        node.callee.property.type === 'PrivateIdentifier'
                            ? <ESTree.Expression>node.callee.object
                            : {
                                  type: 'UnaryExpression',
                                  operator: 'void',
                                  prefix: true,
                                  argument: {
                                      type: 'Literal',
                                      value: 0,
                                      raw: '0'
                                  }
                              },
                        {
                            type: 'ArrayExpression',
                            elements: [...node.arguments]
                        }
                    ]
                };
            }
        });
    }

    private static getCallContextToken(functionId: number): number {
        let hash = 2_166_136_261;
        const value = String(functionId);
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16_777_619);
        }

        return hash >>> 0;
    }

    private static emitLocalInitializers(context: IVMCompileContext): void {
        for (const [name, slot] of context.locals) {
            if (context.lexicalLocals.has(name)) {
                continue;
            }

            VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
            VMCompiler.emit(context, VMOpcode.InitLocal, slot);
        }
    }

    private static compileStatements(
        statements: readonly ESTree.Statement[],
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        for (const statement of statements) {
            VMCompiler.compileStatement(statement, context, selectionByNode);
        }
    }

    private static compileStatement(
        statement: ESTree.Statement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        switch (statement.type) {
            case 'BlockStatement':
                VMCompiler.compileStatements(statement.body, context, selectionByNode);

                return;

            case 'EmptyStatement':
                VMCompiler.emit(context, VMOpcode.Nop);

                return;

            case 'ExpressionStatement':
                VMCompiler.compileExpression(statement.expression, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.Pop);

                return;

            case 'ReturnStatement':
                if (statement.argument) {
                    VMCompiler.compileExpression(statement.argument, context, selectionByNode);
                } else {
                    VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                }
                VMCompiler.compileAbruptCompletion(
                    context,
                    selectionByNode,
                    VMOpcode.Return
                );

                return;

            case 'ThrowStatement':
                VMCompiler.compileExpression(statement.argument, context, selectionByNode);
                VMCompiler.compileAbruptCompletion(
                    context,
                    selectionByNode,
                    VMOpcode.Throw
                );

                return;

            case 'VariableDeclaration':
                for (const declaration of statement.declarations) {
                    VMCompiler.compileVariableDeclarator(declaration, context, selectionByNode);
                }

                return;

            case 'IfStatement': {
                VMCompiler.compileExpression(statement.test, context, selectionByNode);
                const falseJump: MutableVMInstruction = VMCompiler.emit(
                    context,
                    VMOpcode.JumpIfFalse,
                    -1
                );
                VMCompiler.compileStatement(statement.consequent, context, selectionByNode);

                if (!statement.alternate) {
                    falseJump.operands[0] = context.instructions.length;

                    return;
                }

                const endJump: MutableVMInstruction = VMCompiler.emit(context, VMOpcode.Jump, -1);
                falseJump.operands[0] = context.instructions.length;
                VMCompiler.compileStatement(statement.alternate, context, selectionByNode);
                endJump.operands[0] = context.instructions.length;

                return;
            }

            case 'WhileStatement':
                VMCompiler.compileWhileStatement(statement, context, selectionByNode);

                return;

            case 'DoWhileStatement':
                VMCompiler.compileDoWhileStatement(statement, context, selectionByNode);

                return;

            case 'ForStatement':
                VMCompiler.compileForStatement(statement, context, selectionByNode);

                return;

            case 'BreakStatement':
                VMCompiler.emitLoopJump(context, context.breakTargets, statement);

                return;

            case 'ContinueStatement':
                VMCompiler.emitLoopJump(context, context.continueTargets, statement);

                return;

            case 'DebuggerStatement':
                VMCompiler.emit(context, VMOpcode.Debugger);

                return;

            case 'ForInStatement':
            case 'ForOfStatement':
                VMCompiler.compileForInOfStatement(statement, context, selectionByNode);

                return;
            case 'WithStatement':
                VMCompiler.compileExpression(statement.object, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.EnterWith);
                context.withDepth++;
                VMCompiler.compileStatement(statement.body, context, selectionByNode);
                context.withDepth--;
                VMCompiler.emit(context, VMOpcode.ExitWith);

                return;


            case 'FunctionDeclaration': {
                const selected: IVMSelectedFunction | undefined = selectionByNode.get(statement);

                if (!selected || !statement.id) {
                    VMCompiler.throwUnsupported(statement);
                }

                VMCompiler.emitClosure(context, selected);
                VMCompiler.storeIdentifier(context, statement.id.name, true);

                return;
            }

            case 'ClassDeclaration': {
                if (!statement.id) {
                    VMCompiler.throwUnsupported(statement);
                }
                const classExpression: ESTree.ClassExpression = {
                    type: 'ClassExpression',
                    id: statement.id,
                    superClass: statement.superClass,
                    body: statement.body
                };
                const operationIndex: number = context.operations.length;
                context.operations.push(
                    VMCompiler.createClassOperation(classExpression, context)
                );
                VMCompiler.emit(
                    context,
                    VMOpcode.MakeClass,
                    operationIndex,
                    0,
                    0,
                    0,
                    0
                );
                VMCompiler.storeIdentifier(context, statement.id.name, false);

                return;
            }

            case 'SwitchStatement':
                VMCompiler.compileSwitchStatement(statement, context, selectionByNode);

                return;

            case 'TryStatement':
                VMCompiler.compileTryStatement(statement, context, selectionByNode);

                return;

            default:
                VMCompiler.throwUnsupported(statement);
        }
    }

    private static compileSwitchStatement(
        statement: ESTree.SwitchStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.compileExpression(statement.discriminant, context, selectionByNode);
        const discriminantSlot: number = VMCompiler.allocateTemporary(context, 'switch');
        VMCompiler.emit(context, VMOpcode.InitLocal, discriminantSlot);
        const caseJumps: {
            readonly switchCase: ESTree.SwitchCase;
            readonly jump: MutableVMInstruction;
        }[] = [];
        let defaultCase: ESTree.SwitchCase | null = null;

        for (const switchCase of statement.cases) {
            if (!switchCase.test) {
                defaultCase = switchCase;
                continue;
            }

            VMCompiler.emit(context, VMOpcode.GetLocal, discriminantSlot);
            VMCompiler.compileExpression(switchCase.test, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Binary, VMBinaryOperator.StrictEqual);
            caseJumps.push({
                switchCase,
                jump: VMCompiler.emit(context, VMOpcode.JumpIfTrue, -1)
            });
        }

        const unmatchedJump: MutableVMInstruction = VMCompiler.emit(context, VMOpcode.Jump, -1);
        const breakJumps: number[] = [];
        context.breakTargets.push(breakJumps);
        context.continueTargets.push([]);
        context.iteratorSlots.push(null);

        for (const switchCase of statement.cases) {
            const address: number = context.instructions.length;
            caseJumps
                .filter((entry) => entry.switchCase === switchCase)
                .forEach((entry) => {
                    entry.jump.operands[0] = address;
                });
            if (switchCase === defaultCase) {
                unmatchedJump.operands[0] = address;
            }
            VMCompiler.compileStatements(switchCase.consequent, context, selectionByNode);
        }

        const endAddress: number = context.instructions.length;
        if (!defaultCase) {unmatchedJump.operands[0] = endAddress;}
        VMCompiler.patchJumps(context, breakJumps, endAddress);
        context.breakTargets.pop();
        context.continueTargets.pop();
        context.iteratorSlots.pop();
    }

    private static compileAbruptCompletion(
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>,
        opcode: VMOpcode.Return | VMOpcode.Throw
    ): void {
        for (let index: number = 0; index < context.withDepth; index++) {
            VMCompiler.emit(context, VMOpcode.ExitWith);
        }

        if (opcode === VMOpcode.Throw || context.finalizers.length === 0) {
            VMCompiler.emit(context, opcode);

            return;
        }

        const completionSlot: number = VMCompiler.allocateTemporary(context, 'completion');
        VMCompiler.emit(context, VMOpcode.InitLocal, completionSlot);
        [...context.finalizers].reverse().forEach((finalizer: ESTree.BlockStatement) => {
            VMCompiler.compileStatements(finalizer.body, context, selectionByNode);
        });
        VMCompiler.emit(context, VMOpcode.GetLocal, completionSlot);
        VMCompiler.emit(context, opcode);
    }

    private static compileTryStatement(
        statement: ESTree.TryStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const finalizer: ESTree.BlockStatement | null = statement.finalizer ?? null;
        const catchSlot: number =
            statement.handler?.param?.type === 'Identifier'
                ? context.locals.get(statement.handler.param.name) ??
                  VMCompiler.allocateNamedLocal(context, statement.handler.param.name)
                : finalizer
                  ? VMCompiler.allocateTemporary(context, 'exception')
                  : -1;
        const tryStart: number = context.instructions.length;

        if (finalizer) {context.finalizers.push(finalizer);}
        VMCompiler.compileStatements(statement.block.body, context, selectionByNode);
        const tryEnd: number = context.instructions.length;
        const normalExitJump: MutableVMInstruction = VMCompiler.emit(
            context,
            VMOpcode.Jump,
            -1
        );
        let catchAddress: number = -1;
        let catchEnd: number = -1;
        let catchExitJump: MutableVMInstruction | null = null;

        if (statement.handler) {
            catchAddress = context.instructions.length;
            VMCompiler.compileStatements(statement.handler.body.body, context, selectionByNode);
            catchEnd = context.instructions.length;
            catchExitJump = VMCompiler.emit(context, VMOpcode.Jump, -1);
        }

        if (finalizer) {context.finalizers.pop();}
        const normalFinallyAddress: number = context.instructions.length;
        if (finalizer) {
            VMCompiler.compileStatements(finalizer.body, context, selectionByNode);
        }
        const endJump: MutableVMInstruction | null = finalizer
            ? VMCompiler.emit(context, VMOpcode.Jump, -1)
            : null;
        const exceptionalFinallyAddress: number = context.instructions.length;

        if (finalizer) {
            VMCompiler.compileStatements(finalizer.body, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.GetLocal, catchSlot);
            VMCompiler.emit(context, VMOpcode.Throw);
        }

        const endAddress: number = context.instructions.length;
        normalExitJump.operands[0] = finalizer ? normalFinallyAddress : endAddress;
        if (catchExitJump) {
            catchExitJump.operands[0] = finalizer ? normalFinallyAddress : endAddress;
        }
        if (endJump) {endJump.operands[0] = endAddress;}

        context.exceptionTable.push({
            startAddress: tryStart,
            endAddress: tryEnd,
            catchAddress,
            finallyAddress: catchAddress === -1 ? exceptionalFinallyAddress : -1,
            catchSlot
        });
        if (finalizer && catchAddress !== -1) {
            context.exceptionTable.push({
                startAddress: catchAddress,
                endAddress: catchEnd,
                catchAddress: -1,
                finallyAddress: exceptionalFinallyAddress,
                catchSlot
            });
        }
    }

    private static compileWhileStatement(
        statement: ESTree.WhileStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const startAddress: number = context.instructions.length;
        VMCompiler.compileExpression(statement.test, context, selectionByNode);
        const exitJump: MutableVMInstruction = VMCompiler.emit(
            context,
            VMOpcode.JumpIfFalse,
            -1
        );
        const breakJumps: number[] = [];
        const continueJumps: number[] = [];
        context.breakTargets.push(breakJumps);
        context.continueTargets.push(continueJumps);
        context.iteratorSlots.push(null);
        VMCompiler.compileStatement(statement.body, context, selectionByNode);
        VMCompiler.patchJumps(context, continueJumps, startAddress);
        VMCompiler.emit(context, VMOpcode.Jump, startAddress);
        const endAddress: number = context.instructions.length;
        exitJump.operands[0] = endAddress;
        VMCompiler.patchJumps(context, breakJumps, endAddress);
        context.breakTargets.pop();
        context.iteratorSlots.pop();
        context.continueTargets.pop();
    }

    private static compileDoWhileStatement(
        statement: ESTree.DoWhileStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const startAddress: number = context.instructions.length;
        const breakJumps: number[] = [];
        const continueJumps: number[] = [];
        context.breakTargets.push(breakJumps);
        context.continueTargets.push(continueJumps);
        context.iteratorSlots.push(null);
        VMCompiler.compileStatement(statement.body, context, selectionByNode);
        const testAddress: number = context.instructions.length;
        VMCompiler.patchJumps(context, continueJumps, testAddress);
        VMCompiler.compileExpression(statement.test, context, selectionByNode);
        VMCompiler.emit(context, VMOpcode.JumpIfTrue, startAddress);
        const endAddress: number = context.instructions.length;
        VMCompiler.patchJumps(context, breakJumps, endAddress);
        context.breakTargets.pop();
        context.iteratorSlots.pop();
        context.continueTargets.pop();
    }

    private static compileForStatement(
        statement: ESTree.ForStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (statement.init) {
            if (statement.init.type === 'VariableDeclaration') {
                VMCompiler.compileStatement(statement.init, context, selectionByNode);
            } else {
                VMCompiler.compileExpression(statement.init, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.Pop);
            }
        }

        const testAddress: number = context.instructions.length;
        let exitJump: MutableVMInstruction | null = null;

        if (statement.test) {
            VMCompiler.compileExpression(statement.test, context, selectionByNode);
            exitJump = VMCompiler.emit(context, VMOpcode.JumpIfFalse, -1);
        }

        const breakJumps: number[] = [];
        const continueJumps: number[] = [];
        context.breakTargets.push(breakJumps);
        context.continueTargets.push(continueJumps);
        context.iteratorSlots.push(null);
        VMCompiler.compileStatement(statement.body, context, selectionByNode);
        const updateAddress: number = context.instructions.length;
        VMCompiler.patchJumps(context, continueJumps, updateAddress);

        if (statement.update) {
            VMCompiler.compileExpression(statement.update, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Pop);
        }

        VMCompiler.emit(context, VMOpcode.Jump, testAddress);
        const endAddress: number = context.instructions.length;

        if (exitJump) {
            exitJump.operands[0] = endAddress;
        }

        VMCompiler.patchJumps(context, breakJumps, endAddress);
        context.breakTargets.pop();
        context.iteratorSlots.pop();
        context.continueTargets.pop();
    }

    private static emitLoopJump(
        context: IVMCompileContext,
        targetStack: number[][],
        statement: ESTree.BreakStatement | ESTree.ContinueStatement
    ): void {
        if (statement.label || targetStack.length === 0) {
            VMCompiler.throwUnsupported(statement);
        }
        const iterator = context.iteratorSlots[context.iteratorSlots.length - 1];
        if (statement.type === 'BreakStatement' && iterator) {
            VMCompiler.emit(context, VMOpcode.GetLocal, iterator.slot);
            VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
            VMCompiler.emit(context, VMOpcode.IterClose, iterator.async ? 1 : 0);
            if (iterator.async) {
                VMCompiler.emit(context, VMOpcode.Await);
            }
            VMCompiler.emit(context, VMOpcode.Pop);
        }


        const jump: MutableVMInstruction = VMCompiler.emit(context, VMOpcode.Jump, -1);
        targetStack[targetStack.length - 1].push(context.instructions.indexOf(jump));
    }

    private static compileForInOfStatement(
        statement: ESTree.ForInStatement | ESTree.ForOfStatement,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.compileExpression(statement.right, context, selectionByNode);
        const isForIn: boolean = statement.type === 'ForInStatement';
        const isAsync: boolean = statement.type === 'ForOfStatement' && statement.await === true;

        if (isForIn) {
            VMCompiler.emit(context, VMOpcode.EnumKeys);
        } else {
            VMCompiler.emit(
                context,
                isAsync ? VMOpcode.AsyncIterOpen : VMOpcode.IterOpen,
                isAsync ? 1 : 0
            );
        }

        const iteratorSlot: number = VMCompiler.allocateTemporary(context, 'iterator');
        const resultSlot: number = VMCompiler.allocateTemporary(context, 'iteratorResult');
        VMCompiler.emit(context, VMOpcode.InitLocal, iteratorSlot);
        const loopAddress: number = context.instructions.length;
        VMCompiler.emit(context, VMOpcode.GetLocal, iteratorSlot);
        VMCompiler.emit(
            context,
            isAsync ? VMOpcode.AsyncIterNext : VMOpcode.IterNext,
            isAsync ? 1 : 0
        );
        if (isAsync) {
            VMCompiler.emit(context, VMOpcode.Await);
        }
        VMCompiler.emit(context, VMOpcode.SetLocal, resultSlot);
        VMCompiler.emit(context, VMOpcode.Pop);
        VMCompiler.emit(context, VMOpcode.SetLocal, iteratorSlot);
        VMCompiler.emit(context, VMOpcode.Pop);
        VMCompiler.emit(context, VMOpcode.GetLocal, resultSlot);
        VMCompiler.emitConstant(context, [VMConstantTag.String, 'done']);
        VMCompiler.emit(context, VMOpcode.GetProperty);
        const exitJump: MutableVMInstruction = VMCompiler.emit(
            context,
            VMOpcode.JumpIfTrue,
            -1
        );
        VMCompiler.emit(context, VMOpcode.GetLocal, resultSlot);
        VMCompiler.emitConstant(context, [VMConstantTag.String, 'value']);
        VMCompiler.emit(context, VMOpcode.GetProperty);
        VMCompiler.compileForBinding(statement.left, context);

        const breakJumps: number[] = [];
        const continueJumps: number[] = [];
        context.breakTargets.push(breakJumps);
        context.continueTargets.push(continueJumps);
        context.iteratorSlots.push({ slot: iteratorSlot, async: isAsync });
        VMCompiler.compileStatement(statement.body, context, selectionByNode);
        VMCompiler.patchJumps(context, continueJumps, loopAddress);
        VMCompiler.emit(context, VMOpcode.Jump, loopAddress);
        const endAddress: number = context.instructions.length;
        exitJump.operands[0] = endAddress;
        VMCompiler.patchJumps(context, breakJumps, endAddress);
        context.breakTargets.pop();
        context.iteratorSlots.pop();
        context.continueTargets.pop();
    }

    private static compileForBinding(
        left: ESTree.VariableDeclaration | ESTree.Pattern,
        context: IVMCompileContext
    ): void {
        const pattern: ESTree.Pattern =
            left.type === 'VariableDeclaration' ? left.declarations[0].id : left;

        if (pattern.type !== 'Identifier') {
            VMCompiler.throwUnsupported(pattern);
        }

        VMCompiler.storeIdentifier(context, pattern.name, false);
    }

    private static allocateTemporary(context: IVMCompileContext, purpose: string): number {
        const name: string = `#vm:${purpose}:${context.locals.size}`;
        const slot: number = context.locals.size;
        context.locals.set(name, slot);

        return slot;
    }
    private static allocateNamedLocal(context: IVMCompileContext, name: string): number {
        const slot: number = context.locals.size;
        context.locals.set(name, slot);
        context.lexicalLocals.add(name);

        return slot;
    }


    private static patchJumps(
        context: IVMCompileContext,
        jumpIndexes: readonly number[],
        target: number
    ): void {
        jumpIndexes.forEach((index: number) => {
            context.instructions[index].operands[0] = target;
        });
    }

    private static compileVariableDeclarator(
        declaration: ESTree.VariableDeclarator,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (declaration.init) {
            VMCompiler.compileExpression(declaration.init, context, selectionByNode);
        } else {
            VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
        }

        VMCompiler.compilePattern(
            declaration.id,
            context,
            selectionByNode,
            false
        );
    }

    private static compilePattern(
        pattern: ESTree.Pattern,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>,
        preserve: boolean
    ): void {
        if (pattern.type === 'Identifier') {
            VMCompiler.storeIdentifier(context, pattern.name, preserve);

            return;
        }

        if (pattern.type === 'AssignmentPattern') {
            VMCompiler.emit(context, VMOpcode.Dup);
            VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
            VMCompiler.emit(context, VMOpcode.Binary, VMBinaryOperator.StrictEqual);
            const keepValueJump: MutableVMInstruction = VMCompiler.emit(
                context,
                VMOpcode.JumpIfFalse,
                -1
            );
            VMCompiler.emit(context, VMOpcode.Pop);
            VMCompiler.compileExpression(pattern.right, context, selectionByNode);
            keepValueJump.operands[0] = context.instructions.length;
            VMCompiler.compilePattern(
                pattern.left,
                context,
                selectionByNode,
                preserve
            );

            return;
        }

        if (pattern.type === 'RestElement') {
            VMCompiler.compilePattern(
                pattern.argument,
                context,
                selectionByNode,
                preserve
            );

            return;
        }

        const sourceSlot: number = VMCompiler.allocateTemporary(context, 'pattern');
        if (pattern.type === 'ArrayPattern') {
            const source: ESTree.Identifier = {
                type: 'Identifier',
                name: '__source'
            };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [source],
                    {
                        type: 'ArrayExpression',
                        elements: [
                            {
                                type: 'SpreadElement',
                                argument: source
                            }
                        ]
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.EvalThunk, operationIndex);
        }
        VMCompiler.emit(context, VMOpcode.InitLocal, sourceSlot);

        if (pattern.type === 'ArrayPattern') {
            pattern.elements.forEach((element, index: number) => {
                if (!element) {
                    return;
                }
                VMCompiler.emit(context, VMOpcode.GetLocal, sourceSlot);
                if (element.type === 'RestElement') {
                    const source: ESTree.Identifier = {
                        type: 'Identifier',
                        name: '__source'
                    };
                    const operationIndex: number = context.operations.length;
                    context.operations.push(
                        VMCompiler.createOperation(
                            [source],
                            {
                                type: 'CallExpression',
                                optional: false,

                                callee: {
                                    type: 'MemberExpression',
                                    computed: false,
                                    optional: false,
                                    object: source,
                                    property: { type: 'Identifier', name: 'slice' }
                                },
                                arguments: [
                                    { type: 'Literal', value: index, raw: String(index) }
                                ]
                            }
                        )
                    );
                    VMCompiler.emit(context, VMOpcode.EvalThunk, operationIndex);
                } else {
                    VMCompiler.emitConstant(context, [VMConstantTag.Number, index]);
                    VMCompiler.emit(context, VMOpcode.GetProperty);
                }
                VMCompiler.compilePattern(
                    element,
                    context,
                    selectionByNode,
                    preserve
                );
            });

            return;
        }

        if (pattern.type === 'ObjectPattern') {
            pattern.properties.forEach((property) => {
                if (property.type === 'RestElement') {
                    VMCompiler.throwUnsupported(property);
                }
                VMCompiler.emit(context, VMOpcode.GetLocal, sourceSlot);
                if (property.computed) {
                    if (property.key.type === 'PrivateIdentifier') {
                        VMCompiler.throwUnsupported(property.key);
                    }
                    VMCompiler.compileExpression(property.key, context, selectionByNode);
                } else if (property.key.type === 'Identifier') {
                    VMCompiler.emitConstant(context, [
                        VMConstantTag.String,
                        property.key.name
                    ]);
                } else if (property.key.type === 'Literal') {
                    VMCompiler.compileLiteral(property.key, context);
                } else {
                    VMCompiler.throwUnsupported(property.key);
                }
                VMCompiler.emit(context, VMOpcode.GetProperty);
                VMCompiler.compilePattern(
                    property.value,
                    context,
                    selectionByNode,
                    preserve
                );
            });

            return;
        }

        VMCompiler.throwUnsupported(pattern);
    }

    private static compileExpression(
        expression: ESTree.Expression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        switch (expression.type) {
            case 'Literal':
                VMCompiler.compileLiteral(expression, context);

                return;

            case 'Identifier':
                if (
                    expression.name === 'arguments' &&
                    context.node.type !== 'ArrowFunctionExpression'
                ) {
                    VMCompiler.emit(context, VMOpcode.Arguments);
                } else {
                    VMCompiler.loadIdentifier(context, expression.name);
                }

                return;

            case 'ThisExpression':
                VMCompiler.emit(context, VMOpcode.This);

                return;
            case 'MetaProperty':
                if (
                    expression.meta.name === 'new' &&
                    expression.property.name === 'target'
                ) {
                    VMCompiler.emit(context, VMOpcode.NewTarget);

                    return;
                }
                if (
                    expression.meta.name === 'import' &&
                    expression.property.name === 'meta'
                ) {
                    const operationIndex: number = context.operations.length;
                    context.operations.push(VMCompiler.createOperation([], expression));
                    VMCompiler.emit(context, VMOpcode.ImportMeta, operationIndex);

                    return;
                }
                VMCompiler.throwUnsupported(expression);
            case 'ClassExpression': {
                const operationIndex: number = context.operations.length;
                context.operations.push(
                    VMCompiler.createClassOperation(expression, context)
                );
                VMCompiler.emit(
                    context,
                    VMOpcode.MakeClass,
                    operationIndex,
                    0,
                    0,
                    0,
                    0
                );

                return;
            }


            case 'ImportExpression':
                VMCompiler.compileExpression(expression.source, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.DynamicImport);

                return;

            case 'ArrayExpression':
                VMCompiler.compileArrayExpression(expression, context, selectionByNode);

                return;

            case 'ObjectExpression':
                VMCompiler.compileObjectExpression(expression, context, selectionByNode);

                return;

            case 'TemplateLiteral':
                VMCompiler.compileTemplateLiteral(expression, context, selectionByNode);

                return;

            case 'TaggedTemplateExpression':
                VMCompiler.compileTaggedTemplateExpression(expression, context, selectionByNode);

                return;

            case 'UnaryExpression':
                VMCompiler.compileUnaryExpression(expression, context, selectionByNode);

                return;

            case 'BinaryExpression':
                VMCompiler.compileExpression(expression.left, context, selectionByNode);
                VMCompiler.compileExpression(expression.right, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.Binary,
                    VMCompiler.getBinaryOperator(expression.operator)
                );

                return;

            case 'UpdateExpression':
                VMCompiler.compileUpdateExpression(expression, context, selectionByNode);

                return;

            case 'LogicalExpression':
                VMCompiler.compileLogicalExpression(expression, context, selectionByNode);

                return;

            case 'AssignmentExpression':
                VMCompiler.compileAssignmentExpression(expression, context, selectionByNode);

                return;

            case 'ChainExpression':
                VMCompiler.compileChainExpression(expression, context, selectionByNode);

                return;

            case 'MemberExpression':
                VMCompiler.compileMemberExpression(expression, context, selectionByNode);

                return;

            case 'CallExpression':
                VMCompiler.compileCallExpression(expression, context, selectionByNode);

                return;

            case 'NewExpression':
                if (expression.callee.type === 'Super') {
                    VMCompiler.throwUnsupported(expression);
                }
                VMCompiler.compileExpression(expression.callee, context, selectionByNode);
                VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.Construct,
                    expression.arguments.length,
                    VMCompiler.addSpreadMask(expression.arguments, context)
                );

                return;

            case 'ConditionalExpression': {
                VMCompiler.compileExpression(expression.test, context, selectionByNode);
                const alternateJump: MutableVMInstruction = VMCompiler.emit(
                    context,
                    VMOpcode.JumpIfFalse,
                    -1
                );
                VMCompiler.compileExpression(expression.consequent, context, selectionByNode);
                const endJump: MutableVMInstruction = VMCompiler.emit(context, VMOpcode.Jump, -1);
                alternateJump.operands[0] = context.instructions.length;
                VMCompiler.compileExpression(expression.alternate, context, selectionByNode);
                endJump.operands[0] = context.instructions.length;

                return;
            }

            case 'SequenceExpression':
                expression.expressions.forEach((item: ESTree.Expression, index: number) => {
                    VMCompiler.compileExpression(item, context, selectionByNode);
                    if (index < expression.expressions.length - 1) {
                        VMCompiler.emit(context, VMOpcode.Pop);
                    }
                });

                return;
            case 'FunctionExpression':
            case 'ArrowFunctionExpression': {
                const selected: IVMSelectedFunction | undefined = selectionByNode.get(expression);
                if (!selected) {
                    VMCompiler.throwUnsupported(expression);
                }
                VMCompiler.emitClosure(context, selected);

                return;
            }

            case 'AwaitExpression':
                VMCompiler.compileExpression(expression.argument, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.Await);

                return;

            case 'YieldExpression':
                if (expression.delegate) {
                    if (!expression.argument) {
                        VMCompiler.throwUnsupported(expression);
                    }
                    VMCompiler.compileExpression(expression.argument, context, selectionByNode);
                    VMCompiler.emit(context, VMOpcode.YieldStar, 0);
                } else {
                    if (expression.argument) {
                        VMCompiler.compileExpression(expression.argument, context, selectionByNode);
                    } else {
                        VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                    }
                    VMCompiler.emit(context, VMOpcode.Yield);
                }

                return;

            default:
                VMCompiler.throwUnsupported(expression);
        }
    }

    private static compileLiteral(literal: ESTree.Literal, context: IVMCompileContext): void {
        if ('regex' in literal && literal.regex) {
            VMCompiler.emitConstant(context, [
                VMConstantTag.RegExp,
                literal.regex.pattern,
                literal.regex.flags
            ]);

            return;
        }

        if ('bigint' in literal && literal.bigint !== undefined) {
            VMCompiler.emitConstant(context, [VMConstantTag.BigInt, BigInt(literal.bigint)]);

            return;
        }

        switch (typeof literal.value) {
            case 'boolean':
                VMCompiler.emitConstant(context, [literal.value ? VMConstantTag.True : VMConstantTag.False]);

                return;
            case 'number':
                VMCompiler.emitConstant(context, [VMConstantTag.Number, literal.value]);

                return;
            case 'string':
                VMCompiler.emitConstant(context, [VMConstantTag.String, literal.value]);

                return;
            case 'object':
                if (literal.value === null) {
                    VMCompiler.emitConstant(context, [VMConstantTag.Null]);

                    return;
                }
        }

        VMCompiler.throwUnsupported(literal);
    }

    private static compileTemplateLiteral(
        expression: ESTree.TemplateLiteral,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.emitConstant(context, [
            VMConstantTag.String,
            expression.quasis[0].value.cooked ?? expression.quasis[0].value.raw
        ]);

        expression.expressions.forEach((item: ESTree.Expression, index: number) => {
            VMCompiler.compileExpression(item, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Binary, VMBinaryOperator.Add);
            VMCompiler.emitConstant(context, [
                VMConstantTag.String,
                expression.quasis[index + 1].value.cooked ??
                    expression.quasis[index + 1].value.raw
            ]);
            VMCompiler.emit(context, VMOpcode.Binary, VMBinaryOperator.Add);
        });
    }

    private static compileTaggedTemplateExpression(
        expression: ESTree.TaggedTemplateExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const isMethod: boolean =
            expression.tag.type === 'MemberExpression' &&
            expression.tag.object.type !== 'Super' &&
            expression.tag.property.type !== 'PrivateIdentifier';

        if (isMethod) {
            const member = expression.tag as ESTree.MemberExpression;
            VMCompiler.compileExpression(member.object as ESTree.Expression, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Dup);
            if (member.computed) {
                VMCompiler.compileExpression(
                    member.property as ESTree.Expression,
                    context,
                    selectionByNode
                );
            } else {
                VMCompiler.emitConstant(context, [
                    VMConstantTag.String,
                    (member.property as ESTree.Identifier).name
                ]);
            }
            VMCompiler.emit(context, VMOpcode.GetProperty);
        } else {
            VMCompiler.compileExpression(expression.tag, context, selectionByNode);
        }

        VMCompiler.emit(context, VMOpcode.MakeArray, expression.quasi.quasis.length);
        expression.quasi.quasis.forEach((quasi: ESTree.TemplateElement) => {
            VMCompiler.emitConstant(context, [
                VMConstantTag.String,
                quasi.value.cooked ?? quasi.value.raw
            ]);
            VMCompiler.emit(context, VMOpcode.ArrayAppend);
        });
        VMCompiler.emitConstant(context, [VMConstantTag.String, 'raw']);
        VMCompiler.emit(context, VMOpcode.MakeArray, expression.quasi.quasis.length);
        expression.quasi.quasis.forEach((quasi: ESTree.TemplateElement) => {
            VMCompiler.emitConstant(context, [VMConstantTag.String, quasi.value.raw]);
            VMCompiler.emit(context, VMOpcode.ArrayAppend);
        });
        VMCompiler.emit(context, VMOpcode.DefineProperty, 0, 0);
        expression.quasi.expressions.forEach((item: ESTree.Expression) => {
            VMCompiler.compileExpression(item, context, selectionByNode);
        });
        VMCompiler.emit(
            context,
            isMethod ? VMOpcode.CallMethod : VMOpcode.Call,
            expression.quasi.expressions.length + 1,
            -1
        );
    }

    private static compileArrayExpression(
        expression: ESTree.ArrayExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.emit(context, VMOpcode.MakeArray, expression.elements.length);

        for (const element of expression.elements) {
            if (!element) {
                VMCompiler.emitConstant(context, [VMConstantTag.ArrayHole]);
                VMCompiler.emit(context, VMOpcode.ArrayAppend);
            } else if (element.type === 'SpreadElement') {
                VMCompiler.compileExpression(element.argument, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.ArraySpread);
            } else {
                VMCompiler.compileExpression(element, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.ArrayAppend);
            }
        }
    }

    private static compileObjectExpression(
        expression: ESTree.ObjectExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.emit(context, VMOpcode.MakeObject);

        for (const property of expression.properties) {
            if (property.type === 'SpreadElement') {
                VMCompiler.compileExpression(property.argument, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.ObjectSpread);
                continue;
            }

            const propertyKind: VMPropertyKind =
                property.kind === 'get'
                    ? VMPropertyKind.Get
                    : property.kind === 'set'
                      ? VMPropertyKind.Set
                      : property.method
                        ? VMPropertyKind.Method
                        : VMPropertyKind.Data;

            VMCompiler.compilePropertyKey(property, context, selectionByNode);
            if (
                property.value.type === 'ArrayPattern' ||
                property.value.type === 'ObjectPattern' ||
                property.value.type === 'AssignmentPattern' ||
                property.value.type === 'RestElement'
            ) {
                VMCompiler.throwUnsupported(property.value);
            }
            VMCompiler.compileExpression(property.value, context, selectionByNode);
            VMCompiler.emit(
                context,
                VMOpcode.DefineProperty,
                propertyKind,
                propertyKind === VMPropertyKind.Data ||
                    propertyKind === VMPropertyKind.Method
                    ? 7
                    : 3
            );
        }
    }

    private static compilePropertyKey(
        property: ESTree.Property,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (property.computed) {
            if (property.key.type === 'PrivateIdentifier') {
                VMCompiler.throwUnsupported(property.key);
            }
            VMCompiler.compileExpression(property.key, context, selectionByNode);
        } else if (property.key.type === 'Identifier') {
            VMCompiler.emitConstant(context, [VMConstantTag.String, property.key.name]);
        } else if (
            property.key.type === 'Literal' &&
            (typeof property.key.value === 'string' ||
                typeof property.key.value === 'number')
        ) {
            VMCompiler.emitConstant(context, [
                VMConstantTag.String,
                String(property.key.value)
            ]);
        } else {
            VMCompiler.throwUnsupported(property.key);
        }
    }

    private static compileUnaryExpression(
        expression: ESTree.UnaryExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (expression.operator === 'typeof' && expression.argument.type === 'Identifier') {
            const name: string = expression.argument.name;
            if (!context.locals.has(name) && !context.captures.has(name)) {
                VMCompiler.emit(
                    context,
                    VMOpcode.TypeofGlobal,
                    context.constants.add([VMConstantTag.String, name])
                );

                return;
            }
        }
        if (expression.operator === 'delete' && expression.argument.type === 'Identifier') {
            const name: string = expression.argument.name;
            if (context.locals.has(name) || context.captures.has(name)) {
                VMCompiler.emitConstant(context, [VMConstantTag.False]);
            } else {
                VMCompiler.emit(
                    context,
                    VMOpcode.DeleteGlobal,
                    context.constants.add([VMConstantTag.String, name])
                );
            }

            return;
        }


        if (expression.operator === 'delete' && expression.argument.type === 'MemberExpression') {
            VMCompiler.compileMemberReference(expression.argument, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.DeleteProperty);

            return;
        }

        VMCompiler.compileExpression(expression.argument, context, selectionByNode);
        VMCompiler.emit(context, VMOpcode.Unary, VMCompiler.getUnaryOperator(expression.operator));
    }

    private static compileUpdateExpression(
        expression: ESTree.UpdateExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const updateOperator: VMUpdateOperator =
            expression.operator === '++'
                ? expression.prefix
                    ? VMUpdateOperator.PreIncrement
                    : VMUpdateOperator.PostIncrement
                : expression.prefix
                  ? VMUpdateOperator.PreDecrement
                  : VMUpdateOperator.PostDecrement;

        if (expression.argument.type === 'Identifier') {
            const localSlot: number | undefined = context.locals.get(expression.argument.name);
            if (localSlot !== undefined) {
                VMCompiler.emit(
                    context,
                    VMOpcode.UpdateReference,
                    VMReferenceKind.Local,
                    localSlot,
                    updateOperator
                );

                return;
            }

            const captureSlot: number | undefined = context.captures.get(expression.argument.name);
            if (captureSlot !== undefined) {
                VMCompiler.emit(
                    context,
                    VMOpcode.UpdateReference,
                    VMReferenceKind.Capture,
                    captureSlot,
                    updateOperator
                );

                return;
            }

            VMCompiler.emit(
                context,
                VMOpcode.UpdateReference,
                VMReferenceKind.Global,
                context.constants.add([VMConstantTag.String, expression.argument.name]),
                updateOperator
            );

            return;
        }

        if (
            expression.argument.type === 'MemberExpression' &&
            expression.argument.object.type !== 'Super' &&
            expression.argument.property.type !== 'PrivateIdentifier'
        ) {
            VMCompiler.compileMemberReference(expression.argument, context, selectionByNode);
            VMCompiler.emit(
                context,
                VMOpcode.UpdateReference,
                VMReferenceKind.Property,
                -1,
                updateOperator
            );

            return;
        }

        VMCompiler.throwUnsupported(expression);
    }

    private static compileLogicalExpression(
        expression: ESTree.LogicalExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        VMCompiler.compileExpression(expression.left, context, selectionByNode);
        VMCompiler.emit(context, VMOpcode.Dup);

        if (expression.operator === '??') {
            const rightJump: MutableVMInstruction = VMCompiler.emit(
                context,
                VMOpcode.JumpIfNullish,
                -1
            );
            const endJump: MutableVMInstruction = VMCompiler.emit(
                context,
                VMOpcode.Jump,
                -1
            );
            rightJump.operands[0] = context.instructions.length;
            VMCompiler.emit(context, VMOpcode.Pop);
            VMCompiler.compileExpression(expression.right, context, selectionByNode);
            endJump.operands[0] = context.instructions.length;

            return;
        }

        const endJump: MutableVMInstruction = VMCompiler.emit(
            context,
            expression.operator === '&&'
                ? VMOpcode.JumpIfFalse
                : VMOpcode.JumpIfTrue,
            -1
        );
        VMCompiler.emit(context, VMOpcode.Pop);
        VMCompiler.compileExpression(expression.right, context, selectionByNode);
        endJump.operands[0] = context.instructions.length;
    }

    private static compileAssignmentExpression(
        expression: ESTree.AssignmentExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (expression.left.type === 'Identifier') {
            if (expression.operator === '=') {
                VMCompiler.compileExpression(expression.right, context, selectionByNode);
            } else {
                VMCompiler.loadIdentifier(context, expression.left.name);
                VMCompiler.compileExpression(expression.right, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.Binary,
                    VMCompiler.getBinaryOperator(expression.operator.slice(0, -1))
                );
            }
            VMCompiler.storeIdentifier(context, expression.left.name, true);

            return;
        }

        if (expression.left.type === 'MemberExpression' && expression.operator === '=') {
            VMCompiler.compileMemberAssignment(
                expression.left,
                expression.right,
                context,
                selectionByNode
            );

            return;
        }

        if (
            expression.operator === '=' &&
            (expression.left.type === 'ArrayPattern' ||
                expression.left.type === 'ObjectPattern' ||
                expression.left.type === 'AssignmentPattern' ||
                expression.left.type === 'RestElement')
        ) {
            VMCompiler.compileExpression(expression.right, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Dup);
            VMCompiler.compilePattern(
                expression.left,
                context,
                selectionByNode,
                true
            );

            return;
        }

        VMCompiler.throwUnsupported(expression);
    }

    private static compileChainExpression(
        chain: ESTree.ChainExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        const expression = chain.expression;

        if (
            expression.type === 'MemberExpression' &&
            (<ESTree.MemberExpression & { optional?: boolean }>expression).optional
        ) {
            if (
                expression.object.type === 'Super' ||
                expression.property.type === 'PrivateIdentifier'
            ) {
                VMCompiler.throwUnsupported(expression);
            }
            VMCompiler.compileExpression(expression.object, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Dup);
            const nullJump: MutableVMInstruction = VMCompiler.emit(
                context,
                VMOpcode.JumpIfNullish,
                -1
            );
            if (expression.computed) {
                VMCompiler.compileExpression(expression.property, context, selectionByNode);
            } else {
                VMCompiler.emitConstant(context, [
                    VMConstantTag.String,
                    (expression.property as ESTree.Identifier).name
                ]);
            }
            VMCompiler.emit(context, VMOpcode.GetProperty);
            const endJump: MutableVMInstruction = VMCompiler.emit(
                context,
                VMOpcode.Jump,
                -1
            );
            nullJump.operands[0] = context.instructions.length;
            VMCompiler.emit(context, VMOpcode.Pop);
            VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
            endJump.operands[0] = context.instructions.length;

            return;
        }

        if (expression.type === 'CallExpression') {
            const optionalCall: boolean = (
                expression as ESTree.CallExpression & { optional?: boolean }
            ).optional === true;
            if (expression.callee.type === 'MemberExpression') {
                const optionalObject: boolean = (
                    expression.callee as ESTree.MemberExpression & {
                        optional?: boolean;
                    }
                ).optional === true;
                if (
                    expression.callee.object.type === 'Super' ||
                    expression.callee.property.type === 'PrivateIdentifier'
                ) {
                    VMCompiler.throwUnsupported(expression);
                }
                VMCompiler.compileExpression(
                    expression.callee.object,
                    context,
                    selectionByNode
                );
                let objectNullJump: MutableVMInstruction | null = null;
                let callNullJump: MutableVMInstruction | null = null;
                if (optionalObject) {
                    VMCompiler.emit(context, VMOpcode.Dup);
                    objectNullJump = VMCompiler.emit(
                        context,
                        VMOpcode.JumpIfNullish,
                        -1
                    );
                }
                VMCompiler.emit(context, VMOpcode.Dup);
                if (expression.callee.computed) {
                    VMCompiler.compileExpression(
                        expression.callee.property,
                        context,
                        selectionByNode
                    );
                } else {
                    VMCompiler.emitConstant(context, [
                        VMConstantTag.String,
                        (expression.callee.property as ESTree.Identifier).name
                    ]);
                }
                VMCompiler.emit(context, VMOpcode.GetProperty);
                if (optionalCall) {
                    VMCompiler.emit(context, VMOpcode.Dup);
                    callNullJump = VMCompiler.emit(
                        context,
                        VMOpcode.JumpIfNullish,
                        -1
                    );
                }
                VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.CallMethod,
                    expression.arguments.length,
                    VMCompiler.addSpreadMask(expression.arguments, context)
                );
                if (objectNullJump || callNullJump) {
                    const successEndJump: MutableVMInstruction = VMCompiler.emit(
                        context,
                        VMOpcode.Jump,
                        -1
                    );
                    let callNullEndJump: MutableVMInstruction | null = null;
                    if (callNullJump) {
                        callNullJump.operands[0] = context.instructions.length;
                        VMCompiler.emit(context, VMOpcode.Pop);
                        VMCompiler.emit(context, VMOpcode.Pop);
                        VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                        callNullEndJump = VMCompiler.emit(
                            context,
                            VMOpcode.Jump,
                            -1
                        );
                    }
                    if (objectNullJump) {
                        objectNullJump.operands[0] = context.instructions.length;
                        VMCompiler.emit(context, VMOpcode.Pop);
                        VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                    }
                    const endAddress: number = context.instructions.length;
                    successEndJump.operands[0] = endAddress;
                    if (callNullEndJump) {
                        callNullEndJump.operands[0] = endAddress;
                    }
                }

                return;
            }

            if (optionalCall) {
                if (expression.callee.type === 'Super') {
                    VMCompiler.throwUnsupported(expression);
                }
                VMCompiler.compileExpression(expression.callee, context, selectionByNode);
                VMCompiler.emit(context, VMOpcode.Dup);
                const nullJump: MutableVMInstruction = VMCompiler.emit(
                    context,
                    VMOpcode.JumpIfNullish,
                    -1
                );
                VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.Call,
                    expression.arguments.length,
                    VMCompiler.addSpreadMask(expression.arguments, context)
                );
                const endJump: MutableVMInstruction = VMCompiler.emit(
                    context,
                    VMOpcode.Jump,
                    -1
                );
                nullJump.operands[0] = context.instructions.length;
                VMCompiler.emit(context, VMOpcode.Pop);
                VMCompiler.emitConstant(context, [VMConstantTag.Undefined]);
                endJump.operands[0] = context.instructions.length;

                return;
            }
        }

        VMCompiler.compileExpression(expression, context, selectionByNode);
    }

    private static compileMemberAssignment(
        member: ESTree.MemberExpression,
        value: ESTree.Expression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (member.object.type === 'Super') {
            if (member.property.type === 'PrivateIdentifier') {
                VMCompiler.throwUnsupported(member);
            }
            if (member.computed) {
                VMCompiler.compileExpression(member.property, context, selectionByNode);
            } else {
                VMCompiler.emitConstant(context, [
                    VMConstantTag.String,
                    (member.property as ESTree.Identifier).name
                ]);
            }
            VMCompiler.compileExpression(value, context, selectionByNode);
            const key: ESTree.Identifier = { type: 'Identifier', name: '__k' };
            const assignedValue: ESTree.Identifier = { type: 'Identifier', name: '__v' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [key, assignedValue],
                    {
                        type: 'AssignmentExpression',
                        operator: '=',
                        left: {
                            type: 'MemberExpression',
                            computed: true,
                            optional: false,
                            object: { type: 'Super' },
                            property: key
                        },
                        right: assignedValue
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.SuperSet, operationIndex);

            return;
        }


        if (member.property.type === 'PrivateIdentifier') {
            VMCompiler.compileExpression(member.object, context, selectionByNode);
            VMCompiler.compileExpression(value, context, selectionByNode);
            const receiver: ESTree.Identifier = { type: 'Identifier', name: '__r' };
            const assignedValue: ESTree.Identifier = { type: 'Identifier', name: '__v' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [receiver, assignedValue],
                    {
                        type: 'AssignmentExpression',
                        operator: '=',
                        left: {
                            type: 'MemberExpression',
                            computed: false,
                            optional: false,
                            object: receiver,
                            property: member.property
                        },
                        right: assignedValue
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.SetPrivate, operationIndex);

            return;
        }

        VMCompiler.compileMemberReference(member, context, selectionByNode);
        VMCompiler.compileExpression(value, context, selectionByNode);
        VMCompiler.emit(context, VMOpcode.SetProperty);
    }

    private static compileMemberExpression(
        expression: ESTree.MemberExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (expression.object.type === 'Super') {
            if (expression.property.type === 'PrivateIdentifier') {
                VMCompiler.throwUnsupported(expression);
            }

            if (expression.computed) {
                VMCompiler.compileExpression(expression.property, context, selectionByNode);
            } else {
                VMCompiler.emitConstant(context, [
                    VMConstantTag.String,
                    (expression.property as ESTree.Identifier).name
                ]);
            }
            const key: ESTree.Identifier = { type: 'Identifier', name: '__k' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [key],
                    {
                        type: 'MemberExpression',
                        computed: true,
                        optional: false,
                        object: { type: 'Super' },
                        property: key
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.SuperGet, operationIndex);

            return;
        }

        if (expression.property.type === 'PrivateIdentifier') {
            VMCompiler.compileExpression(expression.object, context, selectionByNode);
            const receiver: ESTree.Identifier = { type: 'Identifier', name: '__r' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [receiver],
                    {
                        type: 'MemberExpression',
                        computed: false,
                        optional: false,
                        object: receiver,
                        property: expression.property
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.GetPrivate, operationIndex);

            return;
        }

        VMCompiler.compileMemberReference(expression, context, selectionByNode);
        VMCompiler.emit(context, VMOpcode.GetProperty);
    }

    private static compileMemberReference(
        expression: ESTree.MemberExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if (expression.object.type === 'Super' || expression.property.type === 'PrivateIdentifier') {
            VMCompiler.throwUnsupported(expression);
        }

        VMCompiler.compileExpression(expression.object, context, selectionByNode);
        if (expression.computed) {
            VMCompiler.compileExpression(expression.property, context, selectionByNode);
        } else {
            VMCompiler.emitConstant(context, [VMConstantTag.String, (<ESTree.Identifier>expression.property).name]);
        }
    }

    private static compileCallExpression(
        expression: ESTree.CallExpression,
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        if ((<ESTree.CallExpression & { optional?: boolean }>expression).optional) {
            VMCompiler.throwUnsupported(expression);
        }
        const contextFunctionId = NodeMetadata.get<
            ESTree.CallExpressionNodeMetadata,
            'vmCallContextFunctionId'
        >(expression, 'vmCallContextFunctionId');
        if (contextFunctionId !== undefined) {
            let receiverPresent = 0;
            if (
                expression.callee.type === 'MemberExpression' &&
                expression.callee.property.type === 'PrivateIdentifier'
            ) {
                VMCompiler.compileExpression(
                    <ESTree.Expression>expression.callee.object,
                    context,
                    selectionByNode
                );
                VMCompiler.emit(context, VMOpcode.Dup);
                const receiver: ESTree.Identifier = {
                    type: 'Identifier',
                    name: '__r'
                };
                const operationIndex: number = context.operations.length;
                context.operations.push(
                    VMCompiler.createOperation(
                        [receiver],
                        {
                            type: 'MemberExpression',
                            computed: false,
                            optional: false,
                            object: receiver,
                            property: expression.callee.property
                        }
                    )
                );
                VMCompiler.emit(
                    context,
                    VMOpcode.GetPrivate,
                    operationIndex
                );
                receiverPresent = 1;
            } else {
                if (expression.callee.type === 'Super') {
                    VMCompiler.throwUnsupported(expression);
                }
                VMCompiler.compileExpression(
                    expression.callee,
                    context,
                    selectionByNode
                );
            }
            VMCompiler.compileArguments(
                expression.arguments,
                context,
                selectionByNode
            );
            VMCompiler.emit(
                context,
                VMOpcode.CallContext,
                contextFunctionId,
                expression.arguments.length,
                VMCompiler.addSpreadMask(expression.arguments, context),
                receiverPresent
            );

            return;
        }

        if (
            expression.callee.type === 'Identifier' &&
            expression.callee.name === 'eval' &&
            expression.arguments.length === 1 &&
            expression.arguments[0].type !== 'SpreadElement'
        ) {
            VMCompiler.compileExpression(
                expression.arguments[0],
                context,
                selectionByNode
            );
            const source: ESTree.Identifier = { type: 'Identifier', name: '__source' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [source],
                    {
                        type: 'CallExpression',
                        optional: false,
                        callee: { type: 'Identifier', name: 'eval' },
                        arguments: [source]
                    }
                )
            );
            VMCompiler.emit(context, VMOpcode.EvalThunk, operationIndex);

            return;
        }


        if (expression.callee.type === 'Super') {
            VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
            const args: ESTree.Identifier = { type: 'Identifier', name: '__a' };
            const operationIndex: number = context.operations.length;
            context.operations.push(
                VMCompiler.createOperation(
                    [{ type: 'RestElement', argument: args }],
                    {
                        type: 'CallExpression',
                        optional: false,
                        callee: { type: 'Super' },
                        arguments: [{ type: 'SpreadElement', argument: args }]
                    }
                )
            );
            VMCompiler.emit(
                context,
                VMOpcode.SuperCall,
                operationIndex,
                expression.arguments.length,
                VMCompiler.addSpreadMask(expression.arguments, context)
            );

            return;
        }

        if (expression.callee.type === 'MemberExpression') {
            if (expression.callee.object.type === 'Super') {
                VMCompiler.emit(context, VMOpcode.This);
                VMCompiler.compileMemberExpression(
                    expression.callee,
                    context,
                    selectionByNode
                );
                VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
                VMCompiler.emit(
                    context,
                    VMOpcode.CallMethod,
                    expression.arguments.length,
                    VMCompiler.addSpreadMask(expression.arguments, context)
                );

                return;
            }

            if (expression.callee.property.type === 'PrivateIdentifier') {
                VMCompiler.compileExpression(
                    expression.callee.object,
                    context,
                    selectionByNode
                );
                VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
                const receiver: ESTree.Identifier = { type: 'Identifier', name: '__r' };
                const args: ESTree.Identifier = { type: 'Identifier', name: '__a' };
                const operationIndex: number = context.operations.length;
                context.operations.push(
                    VMCompiler.createOperation(
                        [receiver, { type: 'RestElement', argument: args }],
                        {
                            type: 'CallExpression',
                            optional: false,
                            callee: {
                                type: 'MemberExpression',
                                computed: false,
                                optional: false,
                                object: receiver,
                                property: expression.callee.property
                            },
                            arguments: [{ type: 'SpreadElement', argument: args }]
                        }
                    )
                );
                VMCompiler.emit(
                    context,
                    VMOpcode.PrivateOp,
                    VMPrivateOperation.Call,
                    operationIndex,
                    expression.arguments.length,
                    VMCompiler.addSpreadMask(expression.arguments, context)
                );

                return;
            }

            VMCompiler.compileExpression(expression.callee.object, context, selectionByNode);
            VMCompiler.emit(context, VMOpcode.Dup);
            if (expression.callee.computed) {
                VMCompiler.compileExpression(
                    expression.callee.property,
                    context,
                    selectionByNode
                );
            } else {
                VMCompiler.emitConstant(context, [
                    VMConstantTag.String,
                    (<ESTree.Identifier>expression.callee.property).name
                ]);
            }
            VMCompiler.emit(context, VMOpcode.GetProperty);
            VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
            VMCompiler.emit(
                context,
                VMOpcode.CallMethod,
                expression.arguments.length,
                VMCompiler.addSpreadMask(expression.arguments, context)
            );

            return;
        }

        VMCompiler.compileExpression(expression.callee, context, selectionByNode);
        VMCompiler.compileArguments(expression.arguments, context, selectionByNode);
        VMCompiler.emit(
            context,
            VMOpcode.Call,
            expression.arguments.length,
            VMCompiler.addSpreadMask(expression.arguments, context)
        );
    }

    private static compileArguments(
        args: readonly (ESTree.Expression | ESTree.SpreadElement)[],
        context: IVMCompileContext,
        selectionByNode: Map<TVMFunctionNode, IVMSelectedFunction>
    ): void {
        args.forEach((argument: ESTree.Expression | ESTree.SpreadElement) => {
            VMCompiler.compileExpression(
                argument.type === 'SpreadElement' ? argument.argument : argument,
                context,
                selectionByNode
            );
        });
    }

    private static addSpreadMask(
        args: readonly (ESTree.Expression | ESTree.SpreadElement)[],
        context: IVMCompileContext
    ): number {
        const spreadIndexes: number[] = [];
        args.forEach((argument: ESTree.Expression | ESTree.SpreadElement, index: number) => {
            if (argument.type === 'SpreadElement') {
                spreadIndexes.push(index);
            }
        });

        return spreadIndexes.length > 0
            ? context.constants.add([VMConstantTag.SignedIntArray, spreadIndexes])
            : -1;
    }

    private static emitClosure(
        context: IVMCompileContext,
        selected: IVMSelectedFunction
    ): void {
        const captureNames: readonly string[] =
            context.captureNamesByNode.get(selected.node) ?? [];
        const parameterCount: number = VMCompiler.collectParameterBindings(
            selected.node.params
        ).length;
        const externalCaptureNames: readonly string[] = captureNames.slice(parameterCount);
        const operands: number[] = [selected.id, externalCaptureNames.length];

        externalCaptureNames.forEach((name: string) => {
            const localSlot: number | undefined = context.locals.get(name);
            if (localSlot !== undefined) {
                operands.push(VMCaptureSource.Local, localSlot);

                return;
            }

            const captureSlot: number | undefined = context.captures.get(name);
            if (captureSlot !== undefined) {
                operands.push(VMCaptureSource.Capture, captureSlot);

                return;
            }

            throw new Error(`Cannot resolve VM closure capture: ${name}`);
        });
        const parameterAdapterOperationIndex: number =
            context.operations.length;
        const parameterBindings: readonly string[] =
            VMCompiler.collectParameterBindings(selected.node.params);
        context.operations.push({
            type: 'ArrowFunctionExpression',
            async: false,
            expression: true,
            generator: false,
            params: selected.node.params.map((parameter: ESTree.Pattern) =>
                NodeUtils.clone(parameter)
            ),
            body: {
                type: 'ArrayExpression',
                elements: parameterBindings.map((name: string) =>
                    VMCompiler.createCaptureAdapter(name)
                )
            }
        });
        operands.push(parameterAdapterOperationIndex);
        const nestedOperationsIndex: number = context.operations.length;
        const nestedOperations: readonly ESTree.ArrowFunctionExpression[] =
            context.operationsByNode.get(selected.node) ?? [];
        context.operations.push(
            VMCompiler.createOperation([], {
                type: 'ArrayExpression',
                elements: nestedOperations.map(
                    (operation: ESTree.ArrowFunctionExpression) =>
                        NodeUtils.clone(operation)
                )
            })
        );
        operands.push(nestedOperationsIndex);


        VMCompiler.emit(context, VMOpcode.MakeClosure, ...operands);
    }

    private static loadIdentifier(context: IVMCompileContext, name: string): void {
        const localSlot: number | undefined = context.locals.get(name);
        if (localSlot !== undefined) {
            VMCompiler.emit(context, VMOpcode.GetLocal, localSlot);

            return;
        }
        const captureSlot: number | undefined = context.captures.get(name);
        if (captureSlot !== undefined) {
            VMCompiler.emit(context, VMOpcode.GetCapture, captureSlot);

            return;
        }
        if (context.withDepth > 0) {
            VMCompiler.emit(
                context,
                VMOpcode.ResolveName,
                context.constants.add([VMConstantTag.String, name])
            );

            return;
        }
        VMCompiler.emit(
            context,
            VMOpcode.GetGlobal,
            context.constants.add([VMConstantTag.String, name])
        );
    }

    private static collectLexicalBindings(node: TVMFunctionNode): Set<string> {
        const names: Set<string> = new Set();
        const visitStatement = (statement: ESTree.Statement): void => {
            switch (statement.type) {
                case 'BlockStatement':
                    statement.body.forEach(visitStatement);
                    break;
                case 'VariableDeclaration':
                    if (statement.kind !== 'var') {
                        statement.declarations.forEach((declaration: ESTree.VariableDeclarator) => {
                            const declaredNames: string[] = [];
                            VMCompiler.collectPatternNames(declaration.id, declaredNames);
                            declaredNames.forEach((name: string) => names.add(name));
                        });
                    }
                    break;
                case 'IfStatement':
                    visitStatement(statement.consequent);
                    if (statement.alternate) {visitStatement(statement.alternate);}
                    break;
                case 'WhileStatement':
                case 'DoWhileStatement':
                case 'ForStatement':
                    visitStatement(statement.body);
                    break;
            }
        };

        if (node.body.type === 'BlockStatement') {
            node.body.body.forEach(visitStatement);
        }

        return names;
    }

    private static storeIdentifier(context: IVMCompileContext, name: string, preserve: boolean): void {
        const localSlot: number | undefined = context.locals.get(name);
        if (localSlot !== undefined) {
            VMCompiler.emit(context, preserve ? VMOpcode.SetLocal : VMOpcode.InitLocal, localSlot);

            return;
        }
        const captureSlot: number | undefined = context.captures.get(name);
        if (captureSlot !== undefined) {
            VMCompiler.emit(context, VMOpcode.SetCapture, captureSlot);
            if (!preserve) {
                VMCompiler.emit(context, VMOpcode.Pop);
            }

            return;
        }
        if (context.withDepth > 0) {
            VMCompiler.emit(
                context,
                VMOpcode.SetName,
                context.constants.add([VMConstantTag.String, name])
            );
            if (!preserve) {
                VMCompiler.emit(context, VMOpcode.Pop);
            }

            return;
        }
        VMCompiler.emit(
            context,
            VMOpcode.SetGlobal,
            context.constants.add([VMConstantTag.String, name])
        );
        if (!preserve) {
            VMCompiler.emit(context, VMOpcode.Pop);
        }
    }

    private static collectLocalBindings(node: TVMFunctionNode): Map<string, number> {
        const names: string[] = [];
        const visitStatement = (statement: ESTree.Statement): void => {
            switch (statement.type) {
                case 'BlockStatement':
                    statement.body.forEach(visitStatement);
                    break;
                case 'VariableDeclaration':
                    statement.declarations.forEach((declaration: ESTree.VariableDeclarator) => {
                        VMCompiler.collectPatternNames(declaration.id, names);
                    });
                    break;
                case 'FunctionDeclaration':
                    if (statement.id && !names.includes(statement.id.name)) {
                        names.push(statement.id.name);
                    }
                    break;
                case 'IfStatement':
                    visitStatement(statement.consequent);
                    if (statement.alternate) {visitStatement(statement.alternate);}
                    break;
                case 'WhileStatement':
                case 'DoWhileStatement':
                case 'ForStatement':
                    visitStatement(statement.body);
                    break;
            }
        };

        if (node.body.type === 'BlockStatement') {
            node.body.body.forEach(visitStatement);
        }

        return new Map(names.map((name: string, index: number) => [name, index]));
    }

    private static collectCaptureNames(
        node: TVMFunctionNode,
        scopeAnalyzer: ScopeAnalyzer
    ): string[] {
        const names: string[] = VMCompiler.collectParameterBindings(node.params);
        const scope = scopeAnalyzer.acquireScope(node);

        for (const reference of scope.through) {
            if (
                reference.resolved &&
                !names.includes(reference.identifier.name)
            ) {
                names.push(reference.identifier.name);
            }
        }

        return names;
    }

    private static collectParameterBindings(params: readonly ESTree.Pattern[]): string[] {
        const names: string[] = [];
        params.forEach((parameter: ESTree.Pattern) => VMCompiler.collectPatternNames(parameter, names));

        return names;
    }

    private static collectPatternNames(pattern: ESTree.Pattern, names: string[]): void {
        switch (pattern.type) {
            case 'Identifier':
                if (!names.includes(pattern.name)) {names.push(pattern.name);}

                return;
            case 'AssignmentPattern':
                VMCompiler.collectPatternNames(pattern.left, names);

                return;
            case 'RestElement':
                VMCompiler.collectPatternNames(pattern.argument, names);

                return;
            case 'ArrayPattern':
                pattern.elements.forEach((element) => {
                    if (element) {VMCompiler.collectPatternNames(element, names);}
                });

                return;
            case 'ObjectPattern':
                pattern.properties.forEach((property) => {
                    if (property.type === 'RestElement') {
                        VMCompiler.collectPatternNames(property.argument, names);
                    } else {
                        VMCompiler.collectPatternNames(property.value, names);
                    }
                });

                return;
            default:
                VMCompiler.throwUnsupported(pattern);
        }
    }

    private static createClassOperation(
        expression: ESTree.ClassExpression,
        context: IVMCompileContext
    ): ESTree.ArrowFunctionExpression {
        const clonedExpression: ESTree.ClassExpression =
            NodeUtils.clone(expression);
        const classProgram: ESTree.Program = NodeUtils.parentizeAst({
            type: 'Program',
            sourceType: 'script',
            body: [
                {
                    type: 'ExpressionStatement',
                    expression: clonedExpression
                }
            ]
        });
        const scopeAnalyzer = new ScopeAnalyzer();
        scopeAnalyzer.analyze(classProgram);
        const rootScope = scopeAnalyzer.acquireScope(classProgram);
        const cellByIdentifier: WeakMap<ESTree.Identifier, number> =
            new WeakMap();

        rootScope.through.forEach((reference: eslintScope.Reference) => {
            const identifier = reference.identifier;
            const localSlot = context.locals.get(identifier.name);
            if (localSlot !== undefined) {
                cellByIdentifier.set(identifier, localSlot);

                return;
            }
            const captureSlot = context.captures.get(identifier.name);
            if (captureSlot !== undefined) {
                cellByIdentifier.set(
                    identifier,
                    context.locals.size + captureSlot
                );
            }
        });

        const transformedExpression = estraverse.replace(clonedExpression, {
            leave: (
                node: ESTree.Node,
                parent: ESTree.Node | null
            ): ESTree.Node => {
                if (
                    node.type === 'Property' &&
                    node.shorthand &&
                    node.value.type === 'Identifier'
                ) {
                    const cell = cellByIdentifier.get(node.value);
                    if (cell !== undefined) {
                        return {
                            ...node,
                            shorthand: false,
                            value: VMCompiler.createClassCellCall(cell, 0)
                        };
                    }

                    return node;
                }
                if (
                    node.type === 'AssignmentExpression' &&
                    node.left.type === 'Identifier'
                ) {
                    const cell = cellByIdentifier.get(node.left);
                    if (cell === undefined) {
                        return node;
                    }
                    const assignmentOperator: string = node.operator;
                    if (assignmentOperator === '=') {
                        return VMCompiler.createClassCellCall(
                            cell,
                            1,
                            node.right
                        );
                    }
                    if (
                        assignmentOperator === '&&=' ||
                        assignmentOperator === '||=' ||
                        assignmentOperator === '??='
                    ) {
                        return {
                            type: 'LogicalExpression',
                            operator: assignmentOperator.slice(
                                0,
                                -1
                            ) as ESTree.LogicalOperator,
                            left: VMCompiler.createClassCellCall(cell, 0),
                            right: VMCompiler.createClassCellCall(
                                cell,
                                1,
                                node.right
                            )
                        };
                    }

                    return VMCompiler.createClassCellCall(cell, 1, {
                        type: 'BinaryExpression',
                        operator: assignmentOperator.slice(
                            0,
                            -1
                        ) as ESTree.BinaryOperator,
                        left: VMCompiler.createClassCellCall(cell, 0),
                        right: node.right
                    });
                }
                if (
                    node.type === 'UpdateExpression' &&
                    node.argument.type === 'Identifier'
                ) {
                    const cell = cellByIdentifier.get(node.argument);
                    if (cell === undefined) {
                        return node;
                    }
                    const oldValue: ESTree.Identifier = {
                        type: 'Identifier',
                        name: '__old'
                    };
                    const updatedValue: ESTree.BinaryExpression = {
                        type: 'BinaryExpression',
                        operator: node.operator === '++' ? '+' : '-',
                        left: node.prefix
                            ? VMCompiler.createClassCellCall(cell, 0)
                            : oldValue,
                        right: {
                            type: 'Literal',
                            value: 1,
                            raw: '1'
                        }
                    };
                    const updateCall = VMCompiler.createClassCellCall(
                        cell,
                        1,
                        updatedValue
                    );
                    if (node.prefix) {
                        return updateCall;
                    }

                    return {
                        type: 'CallExpression',
                        optional: false,
                        callee: {
                            type: 'ArrowFunctionExpression',
                            async: false,
                            expression: true,
                            generator: false,
                            params: [oldValue],
                            body: {
                                type: 'SequenceExpression',
                                expressions: [updateCall, oldValue]
                            }
                        },
                        arguments: [
                            VMCompiler.createClassCellCall(cell, 0)
                        ]
                    };
                }
                if (node.type !== 'Identifier') {
                    return node;
                }
                const cell = cellByIdentifier.get(node);
                if (cell === undefined) {
                    return node;
                }
                if (
                    (parent?.type === 'AssignmentExpression' &&
                        parent.left === node) ||
                    (parent?.type === 'UpdateExpression' &&
                        parent.argument === node) ||
                    (parent?.type === 'Property' &&
                        parent.shorthand) ||
                    (parent?.type === 'Property' &&
                        parent.key === node &&
                        !parent.computed) ||
                    (parent?.type === 'MethodDefinition' &&
                        parent.key === node &&
                        !parent.computed)
                ) {
                    return node;
                }

                return VMCompiler.createClassCellCall(cell, 0);
            }
        }) as ESTree.ClassExpression;

        const superClass: ESTree.Identifier = {
            type: 'Identifier',
            name: '__superClass'
        };
        const computedKeys: ESTree.Identifier = {
            type: 'Identifier',
            name: '__computedKeys'
        };
        const closures: ESTree.Identifier = {
            type: 'Identifier',
            name: '__closures'
        };
        const cells: ESTree.Identifier = {
            type: 'Identifier',
            name: '__cells'
        };

        return VMCompiler.createOperation(
            [superClass, computedKeys, closures, cells],
            transformedExpression
        );
    }

    private static createClassCellCall(
        cell: number,
        operation: 0 | 1,
        value?: ESTree.Expression
    ): ESTree.CallExpression {
        return {
            type: 'CallExpression',
            optional: false,
            callee: {
                type: 'MemberExpression',
                computed: true,
                optional: false,
                object: {
                    type: 'MemberExpression',
                    computed: true,
                    optional: false,
                    object: {
                        type: 'Identifier',
                        name: '__cells'
                    },
                    property: {
                        type: 'Literal',
                        value: cell,
                        raw: String(cell)
                    }
                },
                property: {
                    type: 'Literal',
                    value: operation,
                    raw: String(operation)
                }
            },
            arguments: value ? [value] : []
        };
    }

    private static createOperation(
        params: ESTree.Pattern[],
        body: ESTree.Expression
    ): ESTree.ArrowFunctionExpression {
        return {
            type: 'ArrowFunctionExpression',
            async: false,
            expression: true,
            generator: false,
            params,
            body
        };
    }

    private static replaceFunctionBody(
        node: TVMFunctionNode,
        functionId: number,
        captureNames: readonly string[],
        flags: number,
        operations: readonly ESTree.ArrowFunctionExpression[]
    ): void {
        const method: string =
            (flags & VMFunctionFlag.Async) !== 0
                ? (flags & VMFunctionFlag.Generator) !== 0
                    ? 'invokeAsyncGenerator'
                    : 'invokeAsync'
                : (flags & VMFunctionFlag.Generator) !== 0
                  ? 'invokeGenerator'
                  : 'invokeSync';
        const captures: ESTree.ArrayExpression = {
            type: 'ArrayExpression',
            elements: captureNames.map((name: string) => VMCompiler.createCaptureAdapter(name))
        };
        const isArrow: boolean = node.type === 'ArrowFunctionExpression';
        const isDerivedConstructor: boolean =
            (flags & VMFunctionFlag.DerivedConstructor) !== 0;
        const call: ESTree.CallExpression = {
            type: 'CallExpression',
            optional: false,
            callee: {
                type: 'MemberExpression',
                computed: false,
                optional: false,
                object: { type: 'Identifier', name: VMCompiler.runtimeIdentifier },
                property: { type: 'Identifier', name: method }
            },
            arguments: [
                { type: 'Literal', value: functionId, raw: String(functionId) },
                isDerivedConstructor
                    ? {
                          type: 'MemberExpression',
                          computed: false,
                          optional: false,
                          object: {
                              type: 'Identifier',
                              name: VMCompiler.runtimeIdentifier
                          },
                          property: {
                              type: 'Identifier',
                              name: 'UNINITIALIZED_THIS'
                          }
                      }
                    : { type: 'ThisExpression' },
                isArrow ? { type: 'Literal', value: null, raw: 'null' } : { type: 'Identifier', name: 'arguments' },
                isArrow
                    ? { type: 'Literal', value: null, raw: 'null' }
                    : {
                          type: 'MetaProperty',
                          meta: { type: 'Identifier', name: 'new' },
                          property: { type: 'Identifier', name: 'target' }
                      },
                captures,
                {
                    type: 'ArrayExpression',
                    elements: [...operations]
                }
            ]
        };
        const callContextToken = NodeMetadata.get<
            ESTree.BaseNodeMetadata,
            'vmCallContextToken'
        >(node, 'vmCallContextToken');
        if (callContextToken !== undefined) {
            call.arguments.push({
                type: 'Literal',
                value: callContextToken,
                raw: String(callContextToken)
            });
        }


        if ((flags & VMFunctionFlag.Generator) !== 0) {
            node.body = {
                type: 'BlockStatement',
                body: [
                    {
                        type: 'ReturnStatement',
                        argument: {
                            type: 'YieldExpression',
                            argument: call,
                            delegate: true
                        }
                    }
                ]
            };
        } else if (node.type === 'ArrowFunctionExpression' && node.expression) {
            node.body = call;
            node.expression = true;
        } else {
            node.body = {
                type: 'BlockStatement',
                body: [{ type: 'ReturnStatement', argument: call }]
            };
            if (node.type === 'ArrowFunctionExpression') {node.expression = false;}
        }
    }

    private static createCaptureAdapter(name: string): ESTree.ArrayExpression {
        const getter: ESTree.ArrowFunctionExpression = {
            type: 'ArrowFunctionExpression',
            async: false,
            expression: true,
            generator: false,
            params: [],
            body: { type: 'Identifier', name }
        };
        const valueIdentifier: ESTree.Identifier = { type: 'Identifier', name: '__v' };
        const setter: ESTree.ArrowFunctionExpression = {
            type: 'ArrowFunctionExpression',
            async: false,
            expression: true,
            generator: false,
            params: [valueIdentifier],
            body: {
                type: 'AssignmentExpression',
                operator: '=',
                left: { type: 'Identifier', name },
                right: valueIdentifier
            }
        };

        return { type: 'ArrayExpression', elements: [getter, setter] };
    }

    private static getFunctionFlags(node: TVMFunctionNode): number {
        let flags: number = 0;
        const parent: ESTree.Node | undefined = node.parentNode;
        const isMethod: boolean =
            parent?.type === 'MethodDefinition' ||
            (parent?.type === 'Property' && parent.method === true);
        const isDerivedConstructor: boolean =
            parent?.type === 'MethodDefinition' &&
            parent.kind === 'constructor' &&
            (parent.parentNode?.parentNode?.type === 'ClassDeclaration' ||
                parent.parentNode?.parentNode?.type === 'ClassExpression') &&
            parent.parentNode.parentNode.superClass !== null;

        if (node.async) {flags |= VMFunctionFlag.Async;}
        if (node.generator) {flags |= VMFunctionFlag.Generator;}
        if (node.type === 'ArrowFunctionExpression') {flags |= VMFunctionFlag.Arrow;}
        if (isMethod) {flags |= VMFunctionFlag.Method;}
        if (isDerivedConstructor) {flags |= VMFunctionFlag.DerivedConstructor;}
        if (
            node.type !== 'ArrowFunctionExpression' &&
            !node.async &&
            !node.generator &&
            !isMethod
        ) {
            flags |= VMFunctionFlag.Constructable;
        }
        if (
            isMethod ||
            (node.body.type === 'BlockStatement' &&
                node.body.body.some(
                    (statement: ESTree.Statement) =>
                        statement.type === 'ExpressionStatement' &&
                        (<ESTree.ExpressionStatement & { directive?: string }>statement)
                            .directive === 'use strict'
                ))
        ) {
            flags |= VMFunctionFlag.Strict;
        }

        return flags;
    }

    private static getArity(params: readonly ESTree.Pattern[]): number {
        const firstDefaultOrRest: number = params.findIndex(
            (parameter: ESTree.Pattern) =>
                parameter.type === 'AssignmentPattern' || parameter.type === 'RestElement'
        );

        return firstDefaultOrRest === -1 ? params.length : firstDefaultOrRest;
    }

    private static getBinaryOperator(operator: string): VMBinaryOperator {
        const operators: Record<string, VMBinaryOperator> = {
            '==': VMBinaryOperator.Equal,
            '!=': VMBinaryOperator.NotEqual,
            '===': VMBinaryOperator.StrictEqual,
            '!==': VMBinaryOperator.StrictNotEqual,
            '<': VMBinaryOperator.LessThan,
            '<=': VMBinaryOperator.LessThanOrEqual,
            '>': VMBinaryOperator.GreaterThan,
            '>=': VMBinaryOperator.GreaterThanOrEqual,
            '<<': VMBinaryOperator.ShiftLeft,
            '>>': VMBinaryOperator.ShiftRight,
            '>>>': VMBinaryOperator.ShiftRightUnsigned,
            '+': VMBinaryOperator.Add,
            '-': VMBinaryOperator.Subtract,
            '*': VMBinaryOperator.Multiply,
            '/': VMBinaryOperator.Divide,
            '%': VMBinaryOperator.Modulo,
            '**': VMBinaryOperator.Power,
            '|': VMBinaryOperator.BitOr,
            '^': VMBinaryOperator.BitXor,
            '&': VMBinaryOperator.BitAnd,
            in: VMBinaryOperator.In,
            instanceof: VMBinaryOperator.Instanceof
        };
        const value: VMBinaryOperator | undefined = operators[operator];
        if (value === undefined) {throw new Error(`Unsupported VM binary operator: ${operator}`);}

        return value;
    }

    private static getUnaryOperator(operator: string): VMUnaryOperator {
        const operators: Record<string, VMUnaryOperator> = {
            void: VMUnaryOperator.Void,
            typeof: VMUnaryOperator.Typeof,
            '+': VMUnaryOperator.Plus,
            '-': VMUnaryOperator.Minus,
            '~': VMUnaryOperator.BitNot,
            '!': VMUnaryOperator.Not
        };
        const value: VMUnaryOperator | undefined = operators[operator];
        if (value === undefined) {throw new Error(`Unsupported VM unary operator: ${operator}`);}

        return value;
    }

    private static emitConstant(context: IVMCompileContext, constant: TVMConstant): void {
        VMCompiler.emit(context, VMOpcode.Const, context.constants.add(constant));
    }

    private static emit(
        context: IVMCompileContext,
        opcode: number,
        ...operands: number[]
    ): MutableVMInstruction {
        const instruction: MutableVMInstruction = {
            address: context.instructions.length,
            nextAddress: -1,
            opcode,
            operands
        };
        context.instructions.push(instruction);

        return instruction;
    }

    private static finalizeInstructions(instructions: MutableVMInstruction[]): void {
        instructions.forEach((instruction: MutableVMInstruction, index: number) => {
            instruction.address = index;
            instruction.nextAddress = index + 1 < instructions.length ? index + 1 : -1;
        });
    }

    private static throwUnsupported(node: ESTree.Node): never {
        throw new VMUnsupportedSyntaxError(
            node.type,
            node.loc?.start.line ?? 0,
            node.loc?.start.column ?? 0
        );
    }
}
