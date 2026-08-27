import { IVMDefenseAliases } from './IVMDefenseAliases';

export interface IVMDefenseHook {
    readonly name: string;
    readonly aliases?: IVMDefenseAliases;
}
