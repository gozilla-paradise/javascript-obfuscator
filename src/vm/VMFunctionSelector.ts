/* eslint-disable */
import { inject, injectable } from 'inversify';
import * as estraverse from '@javascript-obfuscator/estraverse';
import * as ESTree from 'estree';
import { ScopeAnalyzer } from '../analyzers/scope-analyzer/ScopeAnalyzer';


import { ServiceIdentifiers } from '../container/ServiceIdentifiers';
import { VM_COMMENT_MARKER } from '../constants/VMCommentMarker';


import { VMTargetFunctionsMode } from '../enums/vm/VMTargetFunctionsMode';
import { ObfuscationTarget } from '../enums/ObfuscationTarget';


import { VMDynamicCodeTargetError } from '../errors/VMDynamicCodeTargetError';

import type { IOptions } from '../interfaces/options/IOptions';
import type { ISourceCode } from '../interfaces/source-code/ISourceCode';
import type { IObfuscationWarningsStorage } from '../interfaces/storages/IObfuscationWarningsStorage';
import type { IRandomGenerator } from '../interfaces/utils/IRandomGenerator';
import type { IVMFunctionSelector } from '../interfaces/vm/IVMFunctionSelector';
import type { IVMSelectedFunction, TVMFunctionNode } from '../interfaces/vm/IVMSelectedFunction';

interface IVMFunctionCandidate extends IVMSelectedFunction {
    readonly parentCandidate: IVMFunctionCandidate | null;
    readonly marked: boolean;
}

@injectable()
export class VMFunctionSelector implements IVMFunctionSelector {
    public constructor(
        @inject(ServiceIdentifiers.IOptions) private readonly options: IOptions,
        @inject(ServiceIdentifiers.IRandomGenerator)
        private readonly randomGenerator: IRandomGenerator,
        @inject(ServiceIdentifiers.IObfuscationWarningsStorage)
        private readonly warningsStorage: IObfuscationWarningsStorage,
        @inject(ServiceIdentifiers.ISourceCode) private readonly sourceCode: ISourceCode
    ) {}

    public select(program: ESTree.Program): readonly IVMSelectedFunction[] {
        const candidates: IVMFunctionCandidate[] = this.collectCandidates(program);
        const dynamicIdentifiers: readonly ESTree.Identifier[] =
            this.collectDynamicIdentifiers(program);
        if (
            dynamicIdentifiers.length > 0 &&
            (this.options.target === ObfuscationTarget.BrowserNoEval ||
                this.options.target === ObfuscationTarget.ServiceWorker)
        ) {
            throw new VMDynamicCodeTargetError(this.options.target);
        }


        if (this.options.vmAsyncExecutor) {
            return this.applyDynamicSelection(
                this.selectAsyncCandidates(candidates),
                dynamicIdentifiers
            );
        }

        if (this.options.vmTargetFunctionsMode === VMTargetFunctionsMode.Comment) {
            return this.applyDynamicSelection(
                this.applyThreshold(
                    candidates.filter(
                        (candidate: IVMFunctionCandidate) =>
                            candidate.marked && !this.isExcluded(candidate)
                    )
                ),
                dynamicIdentifiers
            );
        }

        const selectedCandidates: Set<IVMFunctionCandidate> = new Set();

        for (const candidate of candidates) {
            const explicitlyTargeted: boolean =
                !candidate.automatic &&
                this.options.vmTargetFunctions.includes(candidate.canonicalName);
            const inheritedSelection: boolean =
                candidate.parentCandidate !== null && selectedCandidates.has(candidate.parentCandidate);
            const rootSelection: boolean =
                candidate.root &&
                (this.options.vmTargetFunctions.length === 0 || explicitlyTargeted);

            if (
                !this.isExcluded(candidate) &&
                (rootSelection || explicitlyTargeted || inheritedSelection)
            ) {
                selectedCandidates.add(candidate);
            }
        }

        return this.applyDynamicSelection(
            this.applyThreshold([...selectedCandidates]),
            dynamicIdentifiers
        );
    }

    private collectDynamicIdentifiers(program: ESTree.Program): readonly ESTree.Identifier[] {
        const scopeAnalyzer: ScopeAnalyzer = new ScopeAnalyzer();
        scopeAnalyzer.analyze(program);
        const scope = scopeAnalyzer.acquireScope(program);

        return scope.through
            .map((reference) => reference.identifier)
            .filter(
                (identifier: ESTree.Identifier) =>
                    identifier.name === 'eval' || identifier.name === 'Function'
            );
    }

    private applyDynamicSelection(
        selection: readonly IVMSelectedFunction[],
        dynamicIdentifiers: readonly ESTree.Identifier[]
    ): readonly IVMSelectedFunction[] {
        if (dynamicIdentifiers.length === 0) {
            return selection;
        }

        return selection.filter((candidate: IVMSelectedFunction) => {
            const dynamicIdentifier: ESTree.Identifier | undefined =
                dynamicIdentifiers.find(
                    (identifier: ESTree.Identifier) =>
                        (identifier.range?.[0] ?? -1) >= candidate.sourceStart &&
                        (identifier.range?.[1] ?? -1) <= candidate.sourceEnd
                );

            if (!dynamicIdentifier) {
                return true;
            }

            const location = dynamicIdentifier.loc
                ? {
                      line: dynamicIdentifier.loc.start.line,
                      column: dynamicIdentifier.loc.start.column
                  }
                : null;
            this.warningsStorage.addWarning({
                code: 'DynamicCodeRenameRisk',
                message: 'Dynamic code can observe names that are changed by obfuscation',
                functionName: candidate.canonicalName,
                location
            });

            if (this.options.vmForceCompileDynamicCode) {
                return true;
            }

            this.warningsStorage.addWarning({
                code: 'VMDynamicCodeSkipped',
                message: 'VM compilation skipped a function containing dynamic code',
                functionName: candidate.canonicalName,
                location
            });

            return false;
        });
    }

    private collectCandidates(program: ESTree.Program): IVMFunctionCandidate[] {
        const candidates: IVMFunctionCandidate[] = [];
        const functionStack: IVMFunctionCandidate[] = [];

        estraverse.traverse(program, {
            enter: (node: ESTree.Node): estraverse.VisitorOption | void => {
                if (!VMFunctionSelector.isFunctionNode(node)) {
                    return;
                }

                const parentCandidate: IVMFunctionCandidate | null =
                    functionStack[functionStack.length - 1] ?? null;
                const nameData = VMFunctionSelector.getCandidateName(node, parentCandidate);

                if (!nameData) {
                    return estraverse.VisitorOption.Skip;
                }

                const sourceStart: number = node.range?.[0] ?? 0;
                const sourceEnd: number = node.range?.[1] ?? sourceStart;
                const candidate: IVMFunctionCandidate = {
                    id: candidates.length,
                    canonicalName: nameData.name,
                    automatic: nameData.automatic,
                    root: parentCandidate === null,
                    node,
                    sourceStart,
                    sourceEnd,
                    parentCandidate,
                    marked: this.hasImmediateMarker(node)
                };

                candidates.push(candidate);
                functionStack.push(candidate);
            },
            leave: (node: ESTree.Node): void => {
                if (
                    VMFunctionSelector.isFunctionNode(node) &&
                    functionStack[functionStack.length - 1]?.node === node
                ) {
                    functionStack.pop();
                }
            }
        });

        candidates.sort(
            (left: IVMFunctionCandidate, right: IVMFunctionCandidate) =>
                left.sourceStart - right.sourceStart
        );
        candidates.forEach((candidate: IVMFunctionCandidate, index: number) => {
            (<{ id: number }>candidate).id = index;
        });

        return candidates;
    }

    private selectAsyncCandidates(
        candidates: readonly IVMFunctionCandidate[]
    ): readonly IVMSelectedFunction[] {
        const selected: IVMFunctionCandidate[] = [];

        for (const candidate of candidates) {
            const hasAsyncAncestor: boolean = candidates.some(
                (possibleAncestor: IVMFunctionCandidate) =>
                    possibleAncestor !== candidate &&
                    possibleAncestor.node.async &&
                    possibleAncestor.sourceStart <= candidate.sourceStart &&
                    possibleAncestor.sourceEnd >= candidate.sourceEnd
            );
            const compatible: boolean = candidate.node.async === true && candidate.node.generator !== true;

            if (candidate.marked && !compatible) {
                this.warningsStorage.addWarning({
                    code: 'VMExplicitSelectionSkipped',
                    message: 'Explicit VM selection is incompatible with vmAsyncExecutor',
                    functionName: candidate.canonicalName,
                    location: candidate.node.loc
                        ? {
                              line: candidate.node.loc.start.line,
                              column: candidate.node.loc.start.column
                          }
                        : null
                });
            }

            if (compatible && !hasAsyncAncestor && !this.isExcluded(candidate)) {
                selected.push(candidate);
            }
        }

        return selected;
    }

    private applyThreshold(
        candidates: readonly IVMFunctionCandidate[]
    ): readonly IVMSelectedFunction[] {
        if (this.options.vmObfuscationThreshold === 0) {
            return [];
        }

        if (this.options.vmObfuscationThreshold === 1) {
            return candidates;
        }

        return candidates.filter(
            () => this.randomGenerator.getMathRandom() < this.options.vmObfuscationThreshold
        );
    }

    private isExcluded(candidate: IVMFunctionCandidate): boolean {
        return (
            !candidate.automatic &&
            this.options.vmExcludeFunctions.includes(candidate.canonicalName)
        );
    }

    private hasImmediateMarker(node: TVMFunctionNode): boolean {
        const comments: ESTree.Comment[] = node.leadingComments ?? [];
        const marker: ESTree.Comment | undefined = [...comments]
            .reverse()
            .find(
                (comment: ESTree.Comment) =>
                    comment.type === 'Block' &&
                    comment.value.trim() === VM_COMMENT_MARKER
            );

        if (!marker?.range || !node.range) {
            return false;
        }

        return /^\s*$/.test(
            this.sourceCode.getSourceCode().slice(marker.range[1], node.range[0])
        );
    }

    private static isFunctionNode(node: ESTree.Node): node is TVMFunctionNode {
        return (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression'
        );
    }

    private static getCandidateName(
        node: TVMFunctionNode,
        parentCandidate: IVMFunctionCandidate | null
    ): { readonly name: string; readonly automatic: boolean } | null {
        const parent: ESTree.Node | undefined = node.parentNode;
        let baseName: string | null = null;
        let automatic: boolean = false;

        if (node.type === 'FunctionDeclaration' && node.id) {
            baseName = node.id.name;
        } else if (parent?.type === 'ExportDefaultDeclaration') {
            baseName = node.type !== 'ArrowFunctionExpression' && node.id ? node.id.name : 'default';
        } else if (
            parent?.type === 'VariableDeclarator' &&
            parent.init === node &&
            parent.id.type === 'Identifier'
        ) {
            baseName = parent.id.name;
        } else if (parent?.type === 'CallExpression' && parent.callee === node) {
            const variableParent: ESTree.Node | undefined = parent.parentNode;
            if (
                variableParent?.type === 'VariableDeclarator' &&
                variableParent.init === parent &&
                variableParent.id.type === 'Identifier'
            ) {
                baseName = variableParent.id.name;
            } else {
                baseName = VMFunctionSelector.getAnonymousName(node);
                automatic = true;
            }
        } else if (parent?.type === 'Property' && parent.value === node) {
            const ownerName: string | null = VMFunctionSelector.getOwnerName(parent.parentNode);
            const keyName = VMFunctionSelector.getPropertyName(parent.key, parent.computed);

            if (ownerName && keyName) {
                baseName = `${ownerName}.${keyName.name}`;
                automatic = keyName.automatic;
            }
        } else if (parent?.type === 'MethodDefinition' && parent.value === node) {
            const ownerName: string | null = VMFunctionSelector.getOwnerName(
                parent.parentNode?.parentNode
            );
            const keyName = VMFunctionSelector.getPropertyName(parent.key, parent.computed);

            if (ownerName && keyName) {
                baseName = `${ownerName}.${keyName.name}`;
                automatic = keyName.automatic;
            }
        } else if (node.type === 'FunctionExpression' && node.id) {
            baseName = node.id.name;
        }

        if (!baseName) {
            if (!parentCandidate) {
                return null;
            }
            baseName = VMFunctionSelector.getAnonymousName(node);
            automatic = true;
        }

        if (parentCandidate && !baseName.startsWith(`${parentCandidate.canonicalName}.`)) {
            baseName = `${parentCandidate.canonicalName}.${baseName}`;
        }

        return { name: baseName, automatic };
    }

    private static getOwnerName(node: ESTree.Node | undefined): string | null {
        if (!node) {
            return null;
        }

        if (node.type === 'ClassDeclaration' && node.id) {
            return node.id.name;
        }

        if (
            (node.type === 'ClassExpression' || node.type === 'ObjectExpression') &&
            node.parentNode?.type === 'VariableDeclarator' &&
            node.parentNode.id.type === 'Identifier'
        ) {
            return node.parentNode.id.name;
        }

        return null;
    }

    private static getPropertyName(
        key: ESTree.Expression | ESTree.PrivateIdentifier,
        computed: boolean
    ): { readonly name: string; readonly automatic: boolean } | null {
        if (key.type === 'PrivateIdentifier') {
            return { name: `#${key.name}`, automatic: false };
        }

        if (!computed && key.type === 'Identifier') {
            return { name: key.name, automatic: false };
        }

        if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) {
            return { name: String(key.value), automatic: false };
        }

        const location: ESTree.Position | undefined = key.loc?.start;

        return location
            ? { name: `<anonymous@${location.line}:${location.column}>`, automatic: true }
            : null;
    }

    private static getAnonymousName(node: TVMFunctionNode): string {
        return `<anonymous@${node.loc?.start.line ?? 0}:${node.loc?.start.column ?? 0}>`;
    }
}
