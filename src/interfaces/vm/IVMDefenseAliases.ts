import { TTypeFromEnum } from '../../types/utils/TTypeFromEnum';

import { VMDefenseCategory } from '../../enums/vm/VMDefenseCategory';

export type TVMDefenseSource =
    | 'headless'
    | 'agent'
    | 'node'
    | 'debugger'
    | 'timing'
    | 'sandbox'
    | 'domain'
    | 'nativeHook'
    | 'integrity';

export interface IVMDefenseValueAlias<TValue extends string> {
    readonly key?: string;
    readonly values?: Partial<Record<TValue, string>>;
}

export interface IVMDefenseNumberAlias {
    readonly key?: string;
}

export interface IVMDefenseAliases {
    readonly source?: IVMDefenseValueAlias<TVMDefenseSource>;
    readonly category?: IVMDefenseValueAlias<TTypeFromEnum<typeof VMDefenseCategory>>;
    readonly score?: IVMDefenseNumberAlias;
    readonly threshold?: IVMDefenseNumberAlias;
}
