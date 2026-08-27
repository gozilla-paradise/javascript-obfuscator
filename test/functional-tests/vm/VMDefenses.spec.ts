import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';

function execute(code: string, suffix: string = 'undefined'): unknown {
    return Function(`${code}; return (${suffix});`)();
}

describe('VM defenses', () => {
    it('should authenticate encrypted binary and JSON payloads', () => {
        const globals = globalThis as unknown as {
            __vmKey?: () => string;
        };
        globals.__vmKey = () => 'correct-key';

        try {
            for (const format of ['binary', 'json'] as const) {
                const output: string = JavaScriptObfuscator.obfuscate(
                    'function value (input) { return input * 7 + 14; }',
                    {
                        vmObfuscation: true,
                        vmTargetFunctions: ['value'],
                        vmBytecodeFormat: format,
                        vmBytecodeEncoding: true,
                        vmBytecodeArrayEncoding: true,
                        vmBytecodeArrayEncodingKey: 'correct-key',
                        vmBytecodeArrayEncodingKeyGetter:
                            'globalThis.__vmKey()',
                        stringArray: false,
                        compact: true,
                        seed: 91
                    }
                ).getObfuscatedCode();

                assert.equal(execute(output, 'value(4)'), 42);
                globals.__vmKey = () => 'wrong-key';
                assert.throws(
                    () => execute(output),
                    'VM bytecode authentication failed'
                );
                globals.__vmKey = () => 'correct-key';
            }
        } finally {
            delete globals.__vmKey;
        }
    });

    it('should bind direct-call context and leave escaped functions unbound', () => {
        const bound: string = JavaScriptObfuscator.obfuscate(
            'function factorial(n){return n<=1?1:n*factorial(n-1)}const result=factorial(5)',
            {
                vmObfuscation: true,
                vmCallContextOpcodes: true,
                stringArray: false,
                compact: true,
                seed: 8
            }
        ).getObfuscatedCode();

        assert.deepEqual(execute(bound, '[result, factorial(2)]'), [
            120,
            undefined
        ]);

        const escaped: string = JavaScriptObfuscator.obfuscate(
            'function add(value){return value+1}const alias=add;const result=alias(2)',
            {
                vmObfuscation: true,
                vmCallContextOpcodes: true,
                stringArray: false,
                compact: true,
                seed: 8
            }
        ).getObfuscatedCode();
        assert.deepEqual(execute(escaped, '[result, add(3)]'), [3, 4]);
    });


    it('should preserve receiver and brand checks for private call contexts', () => {
        const source: string =
            'class Counter{constructor(){this.base=40}#value(x){return this.base+x}call(x){return this.#value(x)}}globalThis.privateAnswer=new Counter().call(2)';
        const output: string = JavaScriptObfuscator.obfuscate(source, {
            vmObfuscation: true,
            vmCallContextOpcodes: true,
            stringArray: false,
            compact: true,
            seed: 61
        }).getObfuscatedCode();
        const globals = globalThis as unknown as {
            privateAnswer?: number;
        };

        try {
            execute(output);
            assert.equal(globals.privateAnswer, 42);
            assert.include(output, 'callWithContext');
        } finally {
            delete globals.privateAnswer;
        }
    });
    it('should emit aliased telemetry before decoy and break reactions', () => {
        const globals = globalThis as unknown as {
            __OPENAI_CODEX__?: boolean;
            __vmHook?: (payload: Record<string, unknown>) => void;
        };
        const events: Array<Record<string, unknown>> = [];
        globals.__OPENAI_CODEX__ = true;
        globals.__vmHook = (payload: Record<string, unknown>): void => {
            events.push(payload);
        };
        const build = (reaction: 'break' | 'decoy'): string =>
            JavaScriptObfuscator.obfuscate('function value(){return 42}', {
                vmObfuscation: true,
                vmTargetFunctions: ['value'],
                vmDebugProtection: true,
                vmDefenseReaction: {
                    default: 'none',
                    automation: reaction
                },
                vmDefenseHook: {
                    name: '__vmHook',
                    aliases: {
                        source: { key: 's', values: { agent: 'a' } },
                        category: {
                            key: 'c',
                            values: { automation: 'x' }
                        },
                        score: { key: 'n' },
                        threshold: { key: 't' }
                    }
                },
                target: 'node',
                stringArray: false,
                compact: true,
                seed: 3
            }).getObfuscatedCode();

        try {
            assert.isUndefined(execute(build('decoy'), 'value()'));
            assert.includeDeepMembers(events, [
                { s: 'a', c: 'x', n: 1, t: 1 }
            ]);
            assert.throws(
                () => execute(build('break')),
                'VM protection violation'
            );
        } finally {
            delete globals.__OPENAI_CODEX__;
            delete globals.__vmHook;
        }
    });

    it('should finalize and enforce the fixed-width runtime integrity hash', () => {
        const output: string = JavaScriptObfuscator.obfuscate(
            'function value(){return 42}',
            {
                vmObfuscation: true,
                vmTargetFunctions: ['value'],
                vmSelfDefending: true,
                vmDefenseReaction: { default: 'none', integrity: 'break' },
                target: 'node',
                splitStrings: true,
                splitStringsChunkLength: 5,
                stringArray: true,
                stringArrayThreshold: 1,
                unicodeEscapeSequence: true,
                compact: true,
                seed: 12
            }
        ).getObfuscatedCode();

        assert.equal(
            (output.match(/__JOVM_RUNTIME_START__/g) ?? []).length,
            1
        );
        assert.equal((output.match(/__JOVM_RUNTIME_END__/g) ?? []).length, 1);
        assert.notInclude(output, '0'.repeat(64));
        assert.equal(execute(output, 'value()'), 42);

        const start: number = output.indexOf('__JOVM_RUNTIME_START__');
        const functionIndex: number = output.indexOf('function ', start);
        const tampered: string =
            output.slice(0, functionIndex) +
            'function  ' +
            output.slice(functionIndex + 'function '.length);
        assert.throws(
            () => execute(tampered),
            'VM protection violation'
        );
    });
});
