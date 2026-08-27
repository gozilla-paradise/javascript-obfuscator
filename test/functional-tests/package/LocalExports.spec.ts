import * as fs from 'fs';
import * as path from 'path';

import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';

interface ILocalFacadeShape {
    readonly obfuscatePro?: unknown;
    readonly ApiError?: unknown;
}

describe('Local package exports', () => {
    it('should expose VM value enums and omit removed cloud APIs', () => {
        const facade = JavaScriptObfuscator as unknown as ILocalFacadeShape &
            typeof JavaScriptObfuscator;

        assert.isUndefined(facade.obfuscatePro);
        assert.isUndefined(facade.ApiError);
        assert.equal(JavaScriptObfuscator.VMTargetFunctionsMode.Root, 'root');
        assert.equal(JavaScriptObfuscator.VMBytecodeFormat.Binary, 'binary');
        assert.equal(JavaScriptObfuscator.VMDefenseReaction.None, 'none');
    });

    it('should not retain cloud dependencies or transport identifiers', () => {
        const packageJson: string = fs.readFileSync(
            path.join(process.cwd(), 'package.json'),
            'utf8'
        );
        const lockfile: string = fs.readFileSync(
            path.join(process.cwd(), 'yarn.lock'),
            'utf8'
        );
        const forbidden: string[] = [
            '@vercel/blob',
            'env-paths',
            'ProApiClient',
            'pro-api-token',
            'obfuscator.io/api'
        ];

        forbidden.forEach((value: string) => {
            assert.notInclude(packageJson, value);
            assert.notInclude(lockfile, value);
        });
    });
});
