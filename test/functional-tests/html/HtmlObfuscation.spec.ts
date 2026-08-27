import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';
import { JavaScriptParsingError } from '../../../src/errors/JavaScriptParsingError';

function obfuscateHtml(source: string): string {
    return JavaScriptObfuscator.obfuscate(source, {
        parseHtml: true,
        compact: true,
        stringArray: false,
        seed: 1
    }).getObfuscatedCode();
}

describe('HtmlObfuscation', () => {
    it('should change only marked inline script bodies', () => {
        const source: string =
            '<!doctype html><!--keep--><script>skip()</script>' +
            '<script DATA-JAVASCRIPT-OBFUSCATOR type="Text/JavaScript">globalThis.value = 2;</script>' +
            '<script data-javascript-obfuscator type="module">skipModule()</script>' +
            '<script data-javascript-obfuscator src="x.js">skipExternal()</script>';
        const output: string = obfuscateHtml(source);

        assert.include(output, '<!doctype html><!--keep--><script>skip()</script>');
        assert.include(
            output,
            '<script data-javascript-obfuscator type="module">skipModule()</script>'
        );
        assert.include(
            output,
            '<script data-javascript-obfuscator src="x.js">skipExternal()</script>'
        );
        assert.notInclude(output, 'globalThis.value = 2;');
    });

    it('should preserve byte-identical markup when no script is eligible', () => {
        const source: string =
            '<div a="1"> x </div><script data-javascript-obfuscator>   </script>';

        assert.equal(obfuscateHtml(source), source);
    });

    it('should support independent script fragments and forced HTML result options', () => {
        const source: string =
            '<script data-javascript-obfuscator>globalThis.a=1</script>' +
            '<script>globalThis.skip=1</script>' +
            '<script data-javascript-obfuscator>globalThis.b=2</script>';
        const result = JavaScriptObfuscator.obfuscate(source, {
            parseHtml: true,
            sourceMap: true,
            identifierNamesCache: {
                globalIdentifiers: {},
                propertyIdentifiers: {}
            },
            stringArray: false
        });

        assert.equal(result.getSourceMap(), '');
        assert.isNull(result.getIdentifierNamesCache());
        assert.include(result.getObfuscatedCode(), '<script>globalThis.skip=1</script>');
    });

    it('should prefix script parse errors and retain their cause', () => {
        let thrown: unknown;
        try {
            JavaScriptObfuscator.obfuscate(
                '<script></script><script data-javascript-obfuscator>let = ;</script>',
                { parseHtml: true }
            );
        } catch (error) {
            thrown = error;
        }

        assert.instanceOf(thrown, SyntaxError);
        assert.isTrue((thrown as SyntaxError).message.startsWith('HTML script 2:'));
        assert.instanceOf(
            (thrown as SyntaxError & { cause?: unknown }).cause,
            JavaScriptParsingError
        );
    });

    it('should fall back to ordinary JavaScript when no HTML marker exists', () => {
        const output: string = JavaScriptObfuscator.obfuscate('const value = 1;', {
            parseHtml: true,
            compact: true,
            stringArray: false
        }).getObfuscatedCode();

        assert.notInclude(output, '<script');
    });
});
