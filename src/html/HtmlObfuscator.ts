/* eslint-disable complexity, @typescript-eslint/member-ordering */
import { injectable } from 'inversify';
import { DefaultTreeAdapterTypes, parse, parseFragment } from 'parse5';

import { IHtmlObfuscationOutput, IHtmlObfuscator } from '../interfaces/html/IHtmlObfuscator';
import { IOptions } from '../interfaces/options/IOptions';
import { IObfuscationResult } from '../interfaces/source-code/IObfuscationResult';
import { IObfuscationWarning } from '../interfaces/source-code/IObfuscationWarning';

import { JavaScriptParsingError } from '../errors/JavaScriptParsingError';

interface IHtmlReplacement {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly code: string;
}

@injectable()
export class HtmlObfuscator implements IHtmlObfuscator {
    private static readonly htmlSourceMarkerRegExp: RegExp =
        /<!doctype\s+html\b|<(?:html|head|body|script)\b/i;

    private static readonly fullDocumentMarkerRegExp: RegExp =
        /<!doctype\s+html\b|<(?:html|head|body)\b/i;

    public static isHtmlSource(sourceCode: string): boolean {
        return HtmlObfuscator.htmlSourceMarkerRegExp.test(sourceCode);
    }

    public obfuscate(
        sourceCode: string,
        options: IOptions,
        obfuscateScript: (code: string, scriptIndex: number) => IObfuscationResult
    ): IHtmlObfuscationOutput {
        if (options.parseHtml !== true) {
            return {
                code: sourceCode,
                warnings: Object.freeze([])
            };
        }

        const root: DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment =
            HtmlObfuscator.fullDocumentMarkerRegExp.test(sourceCode)
                ? parse(sourceCode, { sourceCodeLocationInfo: true })
                : parseFragment(sourceCode, { sourceCodeLocationInfo: true });
        const scripts: DefaultTreeAdapterTypes.Element[] = HtmlObfuscator.collectScripts(root);
        const replacements: IHtmlReplacement[] = [];
        const warnings: IObfuscationWarning[] = [];

        scripts.forEach((script: DefaultTreeAdapterTypes.Element, index: number) => {
            const scriptIndex: number = index + 1;
            const attributes: Map<string, string> = new Map(
                script.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value])
            );
            const type: string = (attributes.get('type') ?? '').trim().toLowerCase();
            const location = script.sourceCodeLocation;

            if (
                !attributes.has('data-javascript-obfuscator') ||
                attributes.has('src') ||
                type === 'module' ||
                !location?.startTag ||
                !location.endTag
            ) {
                return;
            }

            const startOffset: number = location.startTag.endOffset;
            const endOffset: number = location.endTag.startOffset;

            if (startOffset > endOffset) {
                return;
            }

            const scriptCode: string = sourceCode.slice(startOffset, endOffset);

            if (scriptCode.trim().length === 0) {
                return;
            }

            let result: IObfuscationResult;

            try {
                result = obfuscateScript(scriptCode, scriptIndex);
            } catch (error) {
                if (!(error instanceof JavaScriptParsingError)) {
                    throw error;
                }

                const htmlError: SyntaxError = new SyntaxError(
                    `HTML script ${scriptIndex}: ${error.message}`
                );

                Object.defineProperty(htmlError, 'cause', {
                    configurable: false,
                    enumerable: false,
                    value: error,
                    writable: false
                });

                throw htmlError;
            }

            replacements.push({
                startOffset,
                endOffset,
                code: result.getObfuscatedCode()
            });

            for (const warning of result.getWarnings()) {
                warnings.push(
                    Object.freeze({
                        code: warning.code,
                        message: warning.message,
                        functionName: warning.functionName,
                        location: warning.location
                            ? Object.freeze({
                                  line: warning.location.line,
                                  column: warning.location.column
                              })
                            : null,
                        scriptIndex
                    })
                );
            }
        });

        let code: string = sourceCode;

        replacements
            .sort((left: IHtmlReplacement, right: IHtmlReplacement) => right.startOffset - left.startOffset)
            .forEach((replacement: IHtmlReplacement) => {
                code =
                    code.slice(0, replacement.startOffset) +
                    replacement.code +
                    code.slice(replacement.endOffset);
            });

        return {
            code,
            warnings: Object.freeze([...warnings])
        };
    }

    private static collectScripts(
        root: DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment
    ): DefaultTreeAdapterTypes.Element[] {
        const scripts: DefaultTreeAdapterTypes.Element[] = [];
        const stack: DefaultTreeAdapterTypes.Node[] = [...root.childNodes].reverse();

        while (stack.length > 0) {
            const node: DefaultTreeAdapterTypes.Node = <DefaultTreeAdapterTypes.Node>stack.pop();

            if ('tagName' in node && node.tagName.toLowerCase() === 'script') {
                scripts.push(node);
            }

            const childNodes: DefaultTreeAdapterTypes.ChildNode[] =
                'content' in node
                    ? node.content.childNodes
                    : 'childNodes' in node
                      ? node.childNodes
                      : [];

            for (let index: number = childNodes.length - 1; index >= 0; index--) {
                stack.push(childNodes[index]);
            }
        }

        return scripts;
    }
}
