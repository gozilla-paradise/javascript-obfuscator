import * as ESTree from 'estree';

export type TVMFunctionNode =
    | ESTree.FunctionDeclaration
    | ESTree.FunctionExpression
    | ESTree.ArrowFunctionExpression;

export interface IVMSelectedFunction {
    readonly id: number;
    readonly canonicalName: string;
    readonly automatic: boolean;
    readonly root: boolean;
    readonly node: TVMFunctionNode;
    readonly sourceStart: number;
    readonly sourceEnd: number;
}
