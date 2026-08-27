import * as ESTree from 'estree';

import { IVMProgram } from './IVMProgram';
import { IVMSelectedFunction } from './IVMSelectedFunction';

export interface IVMCompiler {
    compile(selection: readonly IVMSelectedFunction[], program: ESTree.Program): IVMProgram;
}
