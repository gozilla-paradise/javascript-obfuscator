/* eslint-disable */
import { inject, injectable, injectFromBase } from 'inversify';
import * as ESTree from 'estree';
import * as estraverse from '@javascript-obfuscator/estraverse';


import { ServiceIdentifiers } from '../../container/ServiceIdentifiers';

import { NodeTransformationStage } from '../../enums/node-transformers/NodeTransformationStage';
import { NodeTransformer } from '../../enums/node-transformers/NodeTransformer';

import type { IVisitor } from '../../interfaces/node-transformers/IVisitor';
import type { IOptions } from '../../interfaces/options/IOptions';
import type { IRandomGenerator } from '../../interfaces/utils/IRandomGenerator';
import type { IVMBytecodeProtector } from '../../interfaces/vm/IVMBytecodeProtector';
import type { IVMCompiler } from '../../interfaces/vm/IVMCompiler';
import type { IVMFunctionSelector } from '../../interfaces/vm/IVMFunctionSelector';
import type { IVMProgram } from '../../interfaces/vm/IVMProgram';
import type { IVMRuntimeBuild, IVMRuntimeBuilder } from '../../interfaces/vm/IVMRuntimeBuilder';
import type { IVMSelectedFunction } from '../../interfaces/vm/IVMSelectedFunction';
import type { IVMSerializedProgram, IVMSerializer } from '../../interfaces/vm/IVMSerializer';

import { AbstractNodeTransformer } from '../AbstractNodeTransformer';
import { NodeUtils } from '../../node/NodeUtils';
import { NodeMetadata } from '../../node/NodeMetadata';

@injectFromBase()
@injectable()
export class VMObfuscationTransformer extends AbstractNodeTransformer {
    public override readonly runAfter: NodeTransformer[] = [
        NodeTransformer.ParentificationTransformer,
        NodeTransformer.VariablePreserveTransformer
    ];

    public override readonly runOnProgramNodeOnly: boolean = true;

    public constructor(
        @inject(ServiceIdentifiers.IVMFunctionSelector)
        private readonly functionSelector: IVMFunctionSelector,
        @inject(ServiceIdentifiers.IVMCompiler) private readonly compiler: IVMCompiler,
        @inject(ServiceIdentifiers.IVMBytecodeProtector)
        private readonly bytecodeProtector: IVMBytecodeProtector,
        @inject(ServiceIdentifiers.IVMSerializer) private readonly serializer: IVMSerializer,
        @inject(ServiceIdentifiers.IVMRuntimeBuilder)
        private readonly runtimeBuilder: IVMRuntimeBuilder,
        @inject(ServiceIdentifiers.IRandomGenerator) randomGenerator: IRandomGenerator,
        @inject(ServiceIdentifiers.IOptions) options: IOptions
    ) {
        super(randomGenerator, options);
    }

    public getVisitor(nodeTransformationStage: NodeTransformationStage): IVisitor | null {
        if (
            nodeTransformationStage !== NodeTransformationStage.Preparing ||
            !this.options.vmObfuscation
        ) {
            return null;
        }

        return {
            enter: (node: ESTree.Node): ESTree.Node | undefined => {
                if (node.type === 'Program') {
                    return this.transformNode(node);
                }
            }
        };
    }

    public transformNode(programNode: ESTree.Program): ESTree.Node {
        if (this.options.vmWrapTopLevelInitializers) {
            VMObfuscationTransformer.wrapTopLevelInitializers(programNode);
            NodeUtils.parentizeAst(programNode);
        }

        const selection: readonly IVMSelectedFunction[] = this.functionSelector.select(programNode);

        if (selection.length === 0) {
            return programNode;
        }

        const compiledProgram: IVMProgram = this.compiler.compile(selection, programNode);
        const protectedProgram: IVMProgram = this.bytecodeProtector.protect(compiledProgram);
        const serializedProgram: IVMSerializedProgram = this.serializer.serialize(
            protectedProgram,
            this.options.vmBytecodeFormat
        );
        const runtime: IVMRuntimeBuild = this.runtimeBuilder.build(serializedProgram);
        const runtimeStatements: ESTree.Statement[] = NodeUtils.convertCodeToStructure(runtime.code);
        if (this.options.vmSelfDefending) {
            VMObfuscationTransformer.decorateRuntimeIntegrity(runtimeStatements);
        }
        VMObfuscationTransformer.markBytecodeLiterals(
            runtimeStatements,
            runtime.runtimeIdentifier,
            runtime.bytecodeLiteralMode
        );
        const insertionIndex: number = programNode.body.findIndex(
            (statement) =>
                statement.type !== 'ExpressionStatement' ||
                !(<ESTree.ExpressionStatement & { directive?: string }>statement).directive
        );
        const normalizedInsertionIndex: number =
            insertionIndex === -1 ? programNode.body.length : insertionIndex;

        programNode.body.splice(normalizedInsertionIndex, 0, ...runtimeStatements);
        NodeUtils.parentizeAst(programNode);

        return programNode;
    }
    private static decorateRuntimeIntegrity(
        statements: readonly ESTree.Statement[]
    ): void {
        const factory: ESTree.FunctionDeclaration | undefined =
            statements.find(
                (statement: ESTree.Statement): statement is ESTree.FunctionDeclaration =>
                    statement.type === 'FunctionDeclaration' &&
                    statement.id?.name === 'runtimeFactory'
            );
        if (!factory) {
            throw new Error('Invalid VM runtime factory declaration');
        }

        factory.leadingComments = [
            <ESTree.Comment>(<unknown>{
                type: 'Block',
                value: ' @preserve __JOVM_RUNTIME_START__ ',
                start: 0,
                end: 0,
                range: [0, 0]
            })
        ];
        factory.trailingComments = [
            <ESTree.Comment>(<unknown>{
                type: 'Block',
                value: ' @preserve __JOVM_RUNTIME_END__ ',
                start: 0,
                end: 0,
                range: [0, 0]
            })
        ];

        let sentinelCount = 0;
        estraverse.traverse(factory, {
            enter: (node: ESTree.Node): void => {
                if (
                    node.type === 'Literal' &&
                    node.value ===
                        '0000000000000000000000000000000000000000000000000000000000000000'
                ) {
                    NodeMetadata.set(node, { vmIntegritySentinel: true });
                    sentinelCount++;
                }
            }
        });
        if (sentinelCount !== 1) {
            throw new Error('Invalid VM runtime integrity sentinel');
        }
    }

    private static markBytecodeLiterals(
        statements: readonly ESTree.Statement[],
        runtimeIdentifier: string,
        mode: IVMRuntimeBuild['bytecodeLiteralMode']
    ): void {
        const declaration: ESTree.VariableDeclaration | undefined =
            statements.find(
                (statement: ESTree.Statement): statement is ESTree.VariableDeclaration =>
                    statement.type === 'VariableDeclaration'
            );
        const declarator: ESTree.VariableDeclarator | undefined =
            declaration?.declarations.find(
                (candidate: ESTree.VariableDeclarator): boolean =>
                    candidate.id.type === 'Identifier' &&
                    candidate.id.name === runtimeIdentifier
            );
        const initializer: ESTree.Expression | null | undefined =
            declarator?.init;

        if (
            !initializer ||
            initializer.type !== 'CallExpression' ||
            initializer.arguments.length === 0
        ) {
            throw new Error('Invalid VM runtime payload declaration');
        }

        const payload: ESTree.Expression | ESTree.SpreadElement =
            initializer.arguments[0];
        if (mode === 'payload') {
            if (payload.type !== 'Literal' || typeof payload.value !== 'string') {
                throw new Error('Invalid encoded VM runtime payload');
            }
            NodeMetadata.set(payload, { vmBytecodeLiteral: true });

            return;
        }

        if (payload.type !== 'ArrayExpression') {
            throw new Error('Invalid JSON VM runtime payload');
        }
        const constants: ESTree.Expression | ESTree.SpreadElement | null =
            payload.elements[2] ?? null;
        if (!constants || constants.type !== 'ArrayExpression') {
            throw new Error('Invalid JSON VM constant pool');
        }

        estraverse.traverse(constants, {
            enter: (node: ESTree.Node): void => {
                if (node.type === 'Literal' && typeof node.value === 'string') {
                    NodeMetadata.set(node, { vmBytecodeLiteral: true });
                }
            }
        });
    }

    private static wrapTopLevelInitializers(programNode: ESTree.Program): void {
        programNode.body.forEach((statement) => {
            if (statement.type !== 'VariableDeclaration') {
                return;
            }

            statement.declarations.forEach((declaration: ESTree.VariableDeclarator) => {
                const initializer: ESTree.Expression | null | undefined = declaration.init;
                if (
                    declaration.id.type !== 'Identifier' ||
                    !initializer ||
                    initializer.type === 'FunctionExpression' ||
                    initializer.type === 'ArrowFunctionExpression' ||
                    !VMObfuscationTransformer.canWrapInitializer(initializer)
                ) {
                    return;
                }

                declaration.init = {
                    type: 'CallExpression',
                    optional: false,
                    callee: {
                        type: 'ArrowFunctionExpression',
                        async: false,
                        expression: true,
                        generator: false,
                        params: [],
                        body: initializer
                    },
                    arguments: []
                };
            });
        });
    }

    private static canWrapInitializer(initializer: ESTree.Expression): boolean {
        let canWrap: boolean = true;
        estraverse.traverse(initializer, {
            enter: (node: ESTree.Node): estraverse.VisitorOption | void => {
                if (
                    node.type === 'AwaitExpression' ||
                    node.type === 'YieldExpression' ||
                    node.type === 'Super' ||
                    (node.type === 'MetaProperty' &&
                        node.meta.name === 'import' &&
                        node.property.name === 'meta')
                ) {
                    canWrap = false;

                    return estraverse.VisitorOption.Break;
                }
            }
        });

        return canWrap;
    }

}
