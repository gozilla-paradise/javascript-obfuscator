export enum VMConstantTag {
    Undefined = 0,
    Null = 1,
    False = 2,
    True = 3,
    Number = 4,
    BigInt = 5,
    String = 6,
    RegExp = 7,
    ArrayHole = 8,
    SignedIntArray = 9
}

export type TVMConstant =
    | readonly [VMConstantTag.Undefined]
    | readonly [VMConstantTag.Null]
    | readonly [VMConstantTag.False]
    | readonly [VMConstantTag.True]
    | readonly [VMConstantTag.Number, number]
    | readonly [VMConstantTag.BigInt, bigint]
    | readonly [VMConstantTag.String, string]
    | readonly [VMConstantTag.RegExp, string, string]
    | readonly [VMConstantTag.ArrayHole]
    | readonly [VMConstantTag.SignedIntArray, readonly number[]];

export interface IVMInstruction {
    readonly address: number;
    readonly nextAddress: number;
    readonly opcode: number;
    readonly operands: readonly number[];
}

export interface IVMExceptionRow {
    readonly startAddress: number;
    readonly endAddress: number;
    readonly catchAddress: number;
    readonly finallyAddress: number;
    readonly catchSlot: number;
}

export interface IVMFunction {
    readonly id: number;
    readonly flags: number;
    readonly arity: number;
    readonly localCount: number;
    readonly captureCount: number;
    readonly instructions: readonly IVMInstruction[];
    readonly exceptionTable: readonly IVMExceptionRow[];
}

export interface IVMProgram {
    readonly version: 1;
    readonly flags: number;
    readonly constants: readonly TVMConstant[];
    readonly functions: readonly IVMFunction[];
}

export interface IVMProtectionMetadata {
    readonly decodedOpcodes: Readonly<Record<string, number>>;
    readonly jumpKeys: Readonly<Record<string, number>>;
    readonly decoyOpcodes: readonly number[];
    readonly programId: readonly number[];
}

export interface IVMProtectedProgram extends IVMProgram {
    readonly protection: IVMProtectionMetadata;
}
