import { IObfuscationWarning } from '../source-code/IObfuscationWarning';

export interface IObfuscationWarningsStorage {
    addWarning(warning: IObfuscationWarning): void;
    getWarnings(): readonly IObfuscationWarning[];
}
