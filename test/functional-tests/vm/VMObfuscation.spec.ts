import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';
import type { IObfuscationResult } from '../../../src/interfaces/source-code/IObfuscationResult';
import type { TInputOptions } from '../../../src/types/options/TInputOptions';


function execute(code: string, suffix: string): unknown {
    return Function(`${code};return (${suffix})`)();
}

describe('VMObfuscation', () => {
    it('should compile a selected root into executable local bytecode', () => {
        const result: IObfuscationResult = JavaScriptObfuscator.obfuscate(
            'function price(q,p){return q*p}',
            {
                vmObfuscation: true,
                vmTargetFunctions: ['price'],
                seed: 1,
                stringArray: false,
                compact: true
            }
        );
        const output: string = result.getObfuscatedCode();

        assert.equal(execute(output, 'price(6,7)'), 42);
        assert.notInclude(output, 'return q*p');
        assert.include(output, 'Sk9WTQ');
    });

    it('should preserve closures, TDZ, patterns, iterators, and finally completions', () => {
        const source: string = `
            function outer(x, values) {
                let y = 1;
                function inner(z) { y++; return x + y + z; }
                let [a = 4, ...rest] = values;
                try {
                    for (const value of rest) { a += value; }
                    return [inner(2), inner(3), a];
                } finally {
                    globalThis.finalized = (globalThis.finalized || 0) + 1;
                }
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['outer'],
            stringArray: false,
            compact: true
        }).getObfuscatedCode();

        const globals = globalThis as unknown as {
            finalized?: number;
        };
        globals.finalized = 0;
        assert.deepEqual(execute(output, 'outer(1,[undefined,2,3])'), [5, 7, 9]);
        assert.equal(globals.finalized, 1);
        delete globals.finalized;
    });

    it('should preserve sync, generator, async, and async-generator ABIs', async () => {
        const source: string = `
            function sync(x) { return x + 1; }
            function* generator(x) { yield x; return x + 1; }
            async function asyncFn(x) { return (await Promise.resolve(x)) + 1; }
            async function* asyncGenerator(x) { yield await Promise.resolve(x); return x + 1; }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            stringArray: false,
            compact: true
        }).getObfuscatedCode();
        const exports = execute(output, '({sync,generator,asyncFn,asyncGenerator})') as {
            sync(value: number): number;
            generator(value: number): Generator<number, number>;
            asyncFn(value: number): Promise<number>;
            asyncGenerator(value: number): AsyncGenerator<number, number>;
        };

        assert.equal(exports.sync(2), 3);
        assert.deepEqual([...exports.generator(2)], [2]);
        assert.equal(await exports.asyncFn(2), 3);
        const iterator = exports.asyncGenerator(2);
        assert.deepEqual(await iterator.next(), { value: 2, done: false });
        assert.deepEqual(await iterator.next(), { value: 3, done: true });
    });

    it('should enforce dynamic-code target and warning policies', () => {
        assert.throws(
            () =>
                JavaScriptObfuscator.obfuscate(
                    'function f(){return 1} Function("return 2")',
                    {
                        vmObfuscation: true,
                        target: 'browser-no-eval',
                        stringArray: false
                    }
                ),
            "Dynamic code is not allowed for target 'browser-no-eval'"
        );

        const skipped: IObfuscationResult = JavaScriptObfuscator.obfuscate(
            'function f(){return eval("1+2")}',
            {
                vmObfuscation: true,
                vmTargetFunctions: ['f'],
                stringArray: false
            }
        );
        assert.deepEqual(
            skipped.getWarnings().map((warning) => warning.code),
            ['DynamicCodeRenameRisk', 'VMDynamicCodeSkipped']
        );
    });

    it('should compose structural protection toggles deterministically', () => {
        const options: TInputOptions = {
            vmObfuscation: true,
            vmTargetFunctions: ['f'],
            vmMacroOps: true,
            vmDeadCodeInjection: true,
            vmInstructionShuffle: true,
            vmJumpsEncoding: true,
            vmOpcodeShuffle: true,
            vmRuntimeOpcodeDerivation: true,
            vmStatefulOpcodes: true,
            vmDecoyOpcodes: true,
            vmRegisterBased: true,
            vmStackEncoding: true,
            stringArray: false,
            compact: true,
            seed: 7
        };
        const source: string = 'function f(x){let y=1;y=y+2;if(x)y=y+3;return y}';
        const first: string = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
        const second: string = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();

        assert.equal(execute(first, 'f(true)'), 6);
        assert.equal(first, second);
    });
});
