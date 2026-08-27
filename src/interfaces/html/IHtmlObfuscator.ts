import { IOptions } from '../options/IOptions';
import { IObfuscationResult } from '../source-code/IObfuscationResult';
import { IObfuscationWarning } from '../source-code/IObfuscationWarning';

export interface IHtmlObfuscationOutput {
    readonly code: string;
    readonly warnings: readonly IObfuscationWarning[];
}

export interface IHtmlObfuscator {
    obfuscate(
        sourceCode: string,
        options: IOptions,
        obfuscateScript: (code: string, scriptIndex: number) => IObfuscationResult
    ): IHtmlObfuscationOutput;
}
