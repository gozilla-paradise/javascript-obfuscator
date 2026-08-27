import * as acorn from 'acorn';
import * as ESTree from 'estree';
import chalk, { Chalk } from 'chalk';
import { importAttributesOrAssertions } from 'acorn-import-attributes';
import { JavaScriptParsingError } from './errors/JavaScriptParsingError';


const AcornParser = acorn.Parser.extend(importAttributesOrAssertions);

/**
 * Facade over AST parser `acorn`
 */
export class ASTParserFacade {
    /**
     * @type {Chalk}
     */
    private static readonly colorError: Chalk = chalk.red;

    /**
     * @type {number}
     */
    private static readonly nearestSymbolsCount: number = 15;

    /**
     * @type {acorn.Options['sourceType'][]}
     */
    private static readonly sourceTypes: acorn.Options['sourceType'][] = ['script', 'module'];

    /**
     * @param {string} sourceCode
     * @param {Options} config
     * @returns {Program}
     */
    public static parse(
        sourceCode: string,
        config: acorn.Options,
        strictMode: boolean | null = null
    ): ESTree.Program | never {
        if (strictMode !== true) {
            return ASTParserFacade.parseWithSourceTypes(sourceCode, config, 0, sourceCode);
        }

        ASTParserFacade.parseWithSourceTypes(`"use strict";\n${sourceCode}`, config, -1, sourceCode);

        const program: ESTree.Program = ASTParserFacade.parseWithSourceTypes(
            sourceCode,
            config,
            0,
            sourceCode
        );
        const strictDirective: ESTree.Directive = {
            type: 'ExpressionStatement',
            expression: {
                type: 'Literal',
                value: 'use strict',
                raw: '"use strict"'
            },
            directive: 'use strict'
        };

        program.body.unshift(strictDirective);

        return program;
    }

    private static parseWithSourceTypes(
        sourceCode: string,
        config: acorn.Options,
        lineOffset: number,
        diagnosticSourceCode: string
    ): ESTree.Program | never {
        const sourceTypeLength: number = ASTParserFacade.sourceTypes.length;

        for (let i: number = 0; i < sourceTypeLength; i++) {
            try {
                return ASTParserFacade.parseType(
                    sourceCode,
                    config,
                    ASTParserFacade.sourceTypes[i]
                );
            } catch (error) {
                if (!ASTParserFacade.isAcornSyntaxError(error)) {
                    throw error;
                }

                if (i < sourceTypeLength - 1) {
                    continue;
                }

                const position: ESTree.Position = {
                    line: Math.max(1, error.loc.line + lineOffset),
                    column: error.loc.column
                };
                const errorMessage: string = error.message.replace(
                    /\(\d+:\d+\)$/,
                    `(${position.line}:${position.column})`
                );

                throw new JavaScriptParsingError(
                    ASTParserFacade.formatParsingError(diagnosticSourceCode, errorMessage, position),
                    position,
                    error
                );
            }
        }

        throw new Error('Acorn parsing error');
    }

    private static isAcornSyntaxError(
        error: unknown
    ): error is SyntaxError & { readonly loc: ESTree.Position } {
        if (!(error instanceof SyntaxError)) {
            return false;
        }

        const location: unknown = (<SyntaxError & { readonly loc?: unknown }>error).loc;

        return (
            typeof location === 'object' &&
            location !== null &&
            typeof (<ESTree.Position>location).line === 'number' &&
            typeof (<ESTree.Position>location).column === 'number'
        );
    }


    /**
     * @param {string} sourceCode
     * @param {acorn.Options} inputConfig
     * @param {acorn.Options["sourceType"]} sourceType
     * @returns {Program}
     */
    private static parseType(
        sourceCode: string,
        inputConfig: acorn.Options,
        sourceType: acorn.Options['sourceType']
    ): ESTree.Program {
        const comments: ESTree.Comment[] = [];
        const config: acorn.Options = {
            ...inputConfig,
            allowAwaitOutsideFunction: false,
            allowReserved: true,
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            allowSuperOutsideMethod: true,
            onComment: comments,
            sourceType
        };

        const program: acorn.Node & ESTree.Program = <acorn.Node & ESTree.Program>AcornParser.parse(sourceCode, config);

        if (comments.length) {
            program.comments = comments;
        }

        return program;
    }

    /**
     * @param {string} sourceCode
     * @param {string} errorMessage
     * @param {Position | null} position
     * @returns {never}
     */
    private static formatParsingError(
        sourceCode: string,
        errorMessage: string,
        position: ESTree.Position
    ): string {
        const sourceCodeLines: string[] = sourceCode.split(/\r?\n/);
        const errorLine: string | undefined = sourceCodeLines[position.line - 1];

        if (errorLine === undefined) {
            return errorMessage;
        }

        const startErrorIndex: number = Math.max(
            0,
            position.column - ASTParserFacade.nearestSymbolsCount
        );
        const endErrorIndex: number = Math.min(
            errorLine.length,
            position.column + ASTParserFacade.nearestSymbolsCount
        );
        const formattedPointer: string = ASTParserFacade.colorError('>');
        const formattedCodeSlice: string = `...${errorLine
            .slice(startErrorIndex, endErrorIndex)
            .replace(/^\s+/, '')}...`;

        return `ERROR at line ${position.line}: ${errorMessage}\n${formattedPointer} ${formattedCodeSlice}`;
    }
}
