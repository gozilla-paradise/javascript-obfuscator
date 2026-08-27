import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';
import { VM_SYNTAX_MATRIX } from '../../fixtures/vm/VMSyntaxMatrix';

function execute(source: string, argument: string): unknown {
    return Function(`${source}; return matrix(${argument});`)();
}

describe('VM syntax matrix', () => {
    for (const fixture of VM_SYNTAX_MATRIX) {
        it(`should preserve ${fixture.name}`, () => {
            const source: string = `function matrix (input) {${fixture.body}}`;
            const expected: unknown = execute(source, fixture.argument);
            const output: string = JavaScriptObfuscator.obfuscate(source, {
                vmObfuscation: true,
                vmTargetFunctions: ['matrix'],
                stringArray: false,
                compact: true,
                seed: 101
            }).getObfuscatedCode();

            assert.deepEqual(execute(output, fixture.argument), expected);
        });
    }
});
