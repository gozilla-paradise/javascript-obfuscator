/* eslint-disable @typescript-eslint/member-ordering */
import { injectable } from 'inversify';

import { IObfuscationWarning } from '../interfaces/source-code/IObfuscationWarning';
import { IObfuscationWarningsStorage } from '../interfaces/storages/IObfuscationWarningsStorage';

@injectable()
export class ObfuscationWarningsStorage implements IObfuscationWarningsStorage {
    private readonly warnings: IObfuscationWarning[] = [];

    public addWarning(warning: IObfuscationWarning): void {
        this.warnings.push(ObfuscationWarningsStorage.cloneWarning(warning));
    }

    public getWarnings(): readonly IObfuscationWarning[] {
        return Object.freeze(
            this.warnings.map((warning: IObfuscationWarning) =>
                ObfuscationWarningsStorage.cloneWarning(warning)
            )
        );
    }

    private static cloneWarning(warning: IObfuscationWarning): IObfuscationWarning {
        const location = warning.location
            ? Object.freeze({
                  line: warning.location.line,
                  column: warning.location.column
              })
            : null;
        const clone: IObfuscationWarning = {
            code: warning.code,
            message: warning.message,
            functionName: warning.functionName,
            location,
            ...(warning.scriptIndex !== undefined && { scriptIndex: warning.scriptIndex })
        };

        return Object.freeze(clone);
    }
}
