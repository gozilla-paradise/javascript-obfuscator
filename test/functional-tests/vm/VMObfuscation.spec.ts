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
    });


    it('should access userscript storage APIs supplied by the enclosing host scope', () => {
        const source: string = `
            function getLicenseState() {
                function read() {
                    if (typeof GM_getValue !== 'function') return 'unavailable';
                    GM_setValue('license', 'active');
                    const value = GM_getValue('license', 'missing');
                    GM_deleteValue('license');
                    return [value, GM_getValue('license', 'missing')];
                }
                return read();
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['getLicenseState'],
            vmRegisterBased: true,
            vmStackEncoding: true,
            seed: 1
        }).getObfuscatedCode();
        const values = new Map<string, string>();
        const run = Function('GM_getValue', 'GM_setValue', 'GM_deleteValue',
            `${output};return getLicenseState();`);

        assert.deepEqual(run(
            (key: string, fallback: string) => values.get(key) ?? fallback,
            (key: string, value: string) => values.set(key, value),
            (key: string) => values.delete(key)
        ), ['active', 'missing']);
        assert.equal(run(), 'unavailable');
    });

    it('should preserve host binding writes, typeof, deletion, and reference errors', () => {
        const source: string = `
            function probe() {
                const before = counter++;
                counter += 2;
                let missingRead = false;
                let earlyType = false;
                try { absentHostBinding; } catch (error) {
                    missingRead = error instanceof ReferenceError;
                }
                try { typeof laterHostBinding; } catch (error) {
                    earlyType = error instanceof ReferenceError;
                }
                return [before, counter, typeof absentHostBinding,
                    delete counter, missingRead, earlyType];
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['probe'],
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(Function('counter', `
            ${output}
            const result = probe();
            let laterHostBinding;
            return [result, counter];
        `)(4), [[4, 7, 'undefined', false, true, true], 7]);
    });

    it('should resolve host bindings only after checking with objects', () => {
        const output: string = JavaScriptObfuscator.obfuscate(`
            function probe(object) {
                let before;
                with (object) {
                    before = hostCounter;
                    hostCounter = before + 1;
                }
                return before;
            }
        `, {
            vmObfuscation: true,
            vmTargetFunctions: ['probe'],
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(Function('hostCounter', `
            ${output}
            const object = { hostCounter: 8 };
            return [probe(object), object.hostCounter, probe({}), hostCounter];
        `)(4), [8, 9, 4, 5]);
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

    it('should capture locals inside async try blocks and preserve their TDZ', async () => {
        const source: string = `
            async function download(chapters) {
                const results = [];
                try {
                    for (let index = 0; index < chapters.length; index++) {
                        try { results.push(chapter); } catch (error) {
                            results.push(error instanceof ReferenceError);
                        }
                        const chapter = chapters[index];
                        const options = {
                            onRetry: ({ attempt }) => chapter + ':' + attempt
                        };
                        results.push(await Promise.resolve(options.onRetry({ attempt: index })));
                    }
                } finally {
                    const status = 'done';
                    const finish = () => status;
                    results.push(finish());
                }
                return results;
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['download'],
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(await execute(output, 'download(["first"])'), [true, 'first:0', 'done']);
    });

    it('should read fulfilled values after register-based await suspensions', async () => {
        const source: string = `
            async function download(fetchContent) {
                const files = {};
                for (const name of ['first', 'second']) {
                    const scraped = await fetchContent(name);
                    files[name] = scraped.content;
                }
                return files;
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['download'],
            vmRegisterBased: true,
            vmStackEncoding: true,
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(
            await execute(output, 'download(async name => ({ content: name + " body" }))'),
            { first: 'first body', second: 'second body' }
        );
    });

    it('should pass resume values into register-based yield expressions', () => {
        const output: string = JavaScriptObfuscator.obfuscate(`
            function* chapter() {
                const first = yield 'first';
                const second = yield* [first];
                return [first, second];
            }
        `, {
            vmObfuscation: true,
            vmTargetFunctions: ['chapter'],
            vmRegisterBased: true,
            vmStackEncoding: true,
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();
        const iterator = execute(output, 'chapter()') as Generator<unknown, unknown, unknown>;

        assert.deepEqual(iterator.next(), { value: 'first', done: false });
        assert.deepEqual(iterator.next('body'), { value: 'body', done: false });
        assert.deepEqual(iterator.next(), { value: ['body', undefined], done: true });
    });

    it('should preserve named function expression identity and recursion inside VM closures', () => {
        const source: string = `
            function factory() {
                const r = 'outer';
                const loader = function r(count) {
                    if (count > 0) return r(count - 1);
                    return [r, () => r];
                };
                const result = loader(2);
                return [result[0] === loader, result[1]() === loader, r];
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmTargetFunctions: ['factory'],
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(execute(output, 'factory()'), [true, true, 'outer']);
    });

    it('should keep named function bindings immutable without changing parameter shadowing', () => {
        const source: string = `
            function factory() {
                const sloppy = function self() { self = 0; return self; };
                const strict = function self() { 'use strict'; self = 0; };
                const shadowed = function self(self) { self++; return self; };
                let rejected = false;
                try { strict(); } catch (error) { rejected = error instanceof TypeError; }
                return [sloppy() === sloppy, rejected, shadowed(6)];
            }
            const rootStrict = function self() { 'use strict'; self = 0; };
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(execute(output, 'factory()'), [true, true, 7]);
        assert.throws(() => execute(output, 'rootStrict()'), TypeError);
    });

    it('should evaluate parameter defaults against live VM closure bindings', () => {
        const source: string = `
            function factory() {
                let count = 0;
                const getState = () => ++count;
                const render = (state = getState(), next = state + 1) => [state, next];
                const first = render();
                const explicit = render(8);
                const second = render();
                return [first, explicit, second, count];
            }
        `;
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmRegisterBased: true,
            vmJumpsEncoding: true,
            stringArray: false,
            seed: 1
        }).getObfuscatedCode();

        assert.deepEqual(execute(output, 'factory()'), [[1, 2], [8, 9], [2, 3], 2]);
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

        assert.equal(execute(first, 'f(false)'), 3);
        assert.equal(execute(first, 'f(true)'), 6);
        assert.equal(first, second);
    });
});
