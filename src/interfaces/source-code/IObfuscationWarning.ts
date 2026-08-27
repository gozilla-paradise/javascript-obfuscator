export type TObfuscationWarningCode =
    | 'VMDynamicCodeSkipped'
    | 'DynamicCodeRenameRisk'
    | 'VMExplicitSelectionSkipped';

export interface IObfuscationWarningLocation {
    readonly line: number;
    readonly column: number;
}

export interface IObfuscationWarning {
    readonly code: TObfuscationWarningCode;
    readonly message: string;
    readonly functionName: string | null;
    readonly location: Readonly<IObfuscationWarningLocation> | null;
    readonly scriptIndex?: number;
}
