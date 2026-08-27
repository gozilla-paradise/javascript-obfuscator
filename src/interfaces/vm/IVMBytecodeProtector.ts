import { IVMProgram, IVMProtectedProgram } from './IVMProgram';

export interface IVMBytecodeProtector {
    protect(program: IVMProgram): IVMProtectedProgram;
}
