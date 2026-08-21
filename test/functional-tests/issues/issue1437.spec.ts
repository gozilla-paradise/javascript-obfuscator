import { assert } from 'chai';
import { RawSourceMap, SourceMapConsumer } from 'source-map';

import { NO_ADDITIONAL_NODES_PRESET } from '../../../src/options/presets/NoCustomNodes';

import { ISourceMap } from '../../../src/interfaces/source-code/ISourceMap';

import { SourceMapMode } from '../../../src/enums/source-map/SourceMapMode';
import { SourceMapSourcesMode } from '../../../src/enums/source-map/SourceMapSourcesMode';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';

//
// https://github.com/javascript-obfuscator/javascript-obfuscator/issues/1437
//
describe('Issue #1437', () => {
    interface IPosition {
        line: number;
        column: number;
    }

    /**
     * @param {string} code
     * @param {string} token
     * @returns {IPosition}
     */
    const positionOf = (code: string, token: string): IPosition => {
        const linesBeforeToken: string[] = code.slice(0, code.indexOf(token)).split('\n');

        return {
            line: linesBeforeToken.length,
            column: linesBeforeToken[linesBeforeToken.length - 1].length
        };
    };

    describe('Source map of the code with a leading whitespace', () => {
        describe('Variant #1: leading new line', () => {
            const code: string = '\nthrow new Error("boom");\n';

            let obfuscatedCode: string, sourceMap: ISourceMap;

            before(() => {
                const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
                    ...NO_ADDITIONAL_NODES_PRESET,
                    compact: false,
                    sourceMap: true,
                    sourceMapMode: SourceMapMode.Separate,
                    sourceMapSourcesMode: SourceMapSourcesMode.SourcesContent,
                    seed: 1
                });

                obfuscatedCode = obfuscationResult.getObfuscatedCode();
                sourceMap = JSON.parse(obfuscationResult.getSourceMap());
            });

            it('should keep the original source code inside the `sourcesContent` field', () => {
                assert.deepEqual(sourceMap.sourcesContent, [code]);
            });

            it('should map generated token to its position inside the original source code', () => {
                const consumer: SourceMapConsumer = new SourceMapConsumer(<RawSourceMap>(<unknown>sourceMap));
                const originalPosition = consumer.originalPositionFor(positionOf(obfuscatedCode, 'Error'));

                assert.deepEqual(
                    { line: originalPosition.line, column: originalPosition.column },
                    positionOf(code, 'Error')
                );
            });
        });

        describe('Variant #2: leading and trailing whitespaces', () => {
            const code: string = '\n\n  var foo = 1;\n\n';

            let obfuscatedCode: string, sourceMap: ISourceMap;

            before(() => {
                const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
                    ...NO_ADDITIONAL_NODES_PRESET,
                    compact: false,
                    renameGlobals: true,
                    sourceMap: true,
                    sourceMapMode: SourceMapMode.Separate,
                    sourceMapSourcesMode: SourceMapSourcesMode.SourcesContent,
                    seed: 1
                });

                obfuscatedCode = obfuscationResult.getObfuscatedCode();
                sourceMap = JSON.parse(obfuscationResult.getSourceMap());
            });

            it('should keep the original source code inside the `sourcesContent` field', () => {
                assert.deepEqual(sourceMap.sourcesContent, [code]);
            });

            it('should map generated token to its position inside the original source code', () => {
                const consumer: SourceMapConsumer = new SourceMapConsumer(<RawSourceMap>(<unknown>sourceMap));
                const originalPosition = consumer.originalPositionFor(positionOf(obfuscatedCode, 'var'));

                assert.deepEqual(
                    { line: originalPosition.line, column: originalPosition.column },
                    positionOf(code, 'var')
                );
            });
        });
    });
});
