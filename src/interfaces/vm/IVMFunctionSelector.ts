import * as ESTree from 'estree';

import { IVMSelectedFunction } from './IVMSelectedFunction';

export interface IVMFunctionSelector {
    select(program: ESTree.Program): readonly IVMSelectedFunction[];
}
