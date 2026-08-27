export type TVMCapture = readonly [
    get: () => unknown,
    set: (value: unknown) => unknown
];

export type TVMLexicalThunk = (...args: unknown[]) => unknown;

export type TVMCompletion = readonly [
    tag: VMCompletionTag,
    value: unknown,
    resumeAddress: number
];

export enum VMCompletionTag {
    Normal = 0,
    Return = 1,
    Throw = 2,
    Yield = 3,
    Await = 4
}

export interface IVMExecutorRuntime {
    invokeSync(
        id: number,
        receiver: unknown,
        argsObject: IArguments,
        newTarget: unknown,
        captures: readonly TVMCapture[],
        ops: readonly TVMLexicalThunk[]
    ): unknown;
    invokeAsync(
        id: number,
        receiver: unknown,
        argsObject: IArguments,
        newTarget: unknown,
        captures: readonly TVMCapture[],
        ops: readonly TVMLexicalThunk[]
    ): Promise<unknown>;
    invokeGenerator(
        id: number,
        receiver: unknown,
        argsObject: IArguments,
        newTarget: unknown,
        captures: readonly TVMCapture[],
        ops: readonly TVMLexicalThunk[]
    ): IterableIterator<unknown>;
    invokeAsyncGenerator(
        id: number,
        receiver: unknown,
        argsObject: IArguments,
        newTarget: unknown,
        captures: readonly TVMCapture[],
        ops: readonly TVMLexicalThunk[]
    ): AsyncIterableIterator<unknown>;
}
