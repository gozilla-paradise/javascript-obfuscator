import { assert } from 'chai';

import { HtmlObfuscator } from '../../../src/html/HtmlObfuscator';
import type { IObfuscationResult } from '../../../src/interfaces/source-code/IObfuscationResult';
import type { IOptions } from '../../../src/interfaces/options/IOptions';

function result(code: string): IObfuscationResult {
    return {
        initialize: (): void => {},
        getIdentifierNamesCache: () => null,
        getObfuscatedCode: () => code,
        getOptions: () => ({ parseHtml: true } as IOptions),
        getSourceMap: () => '',
        getWarnings: () => Object.freeze([])
    };
}

describe('HtmlObfuscator', () => {
    it('should preserve surrounding bytes and count skipped scripts', () => {
        const source: string =
            '<!--before--><script>skip()</script><script DATA-JAVASCRIPT-OBFUSCATOR>keep()</script><!--after-->';
        const seen: Array<[string, number]> = [];
        const output = new HtmlObfuscator().obfuscate(
            source,
            { parseHtml: true } as IOptions,
            (code: string, scriptIndex: number): IObfuscationResult => {
                seen.push([code, scriptIndex]);
                return result('changed()');
            }
        );

        assert.equal(
            output.code,
            '<!--before--><script>skip()</script><script DATA-JAVASCRIPT-OBFUSCATOR>changed()</script><!--after-->'
        );
        assert.deepEqual(seen, [['keep()', 2]]);
    });

    it('should return byte-identical source when no script is eligible', () => {
        const source: string = '<script type="module">module()</script>';
        const output = new HtmlObfuscator().obfuscate(
            source,
            { parseHtml: true } as IOptions,
            (): IObfuscationResult => result('changed()')
        );

        assert.equal(output.code, source);
        assert.isTrue(Object.isFrozen(output.warnings));
    });
});
