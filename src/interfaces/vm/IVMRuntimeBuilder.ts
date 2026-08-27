import { IVMSerializedProgram } from './IVMSerializer';

export interface IVMRuntimeBuild {
    readonly code: string;
    readonly runtimeIdentifier: string;
    readonly bytecodeLiteralMode: 'payload' | 'jsonConstants';
}

export interface IVMRuntimeBuilder {
    build(program: IVMSerializedProgram): IVMRuntimeBuild;
}
