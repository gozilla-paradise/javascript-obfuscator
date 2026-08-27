/* eslint-disable @typescript-eslint/member-ordering */
import 'reflect-metadata';

import { ServiceIdentifiers } from './container/ServiceIdentifiers';

import { TDictionary } from './types/TDictionary';
import { TInputOptions } from './types/options/TInputOptions';
import { TObfuscationResultsObject } from './types/TObfuscationResultsObject';
import { TOptionsPreset } from './types/options/TOptionsPreset';
import { TObfuscationResultFactory } from './types/container/source-code/TObfuscationResultFactory';


import { IInversifyContainerFacade } from './interfaces/container/IInversifyContainerFacade';
import { IHtmlObfuscationOutput, IHtmlObfuscator } from './interfaces/html/IHtmlObfuscator';

import { IJavaScriptObfuscator } from './interfaces/IJavaScriptObfsucator';
import { IObfuscationResult } from './interfaces/source-code/IObfuscationResult';
import { IObfuscationWarningsStorage } from './interfaces/storages/IObfuscationWarningsStorage';
import { IOptions } from './interfaces/options/IOptions';


import { InversifyContainerFacade } from './container/InversifyContainerFacade';
import { HtmlObfuscator } from './html/HtmlObfuscator';
import { OptionsPreset } from './enums/options/presets/OptionsPreset';
import { VMBytecodeFormat } from './enums/vm/VMBytecodeFormat';
import { VMDefenseCategory } from './enums/vm/VMDefenseCategory';
import { VMDefenseReaction } from './enums/vm/VMDefenseReaction';
import { VMTargetFunctionsMode } from './enums/vm/VMTargetFunctionsMode';


import { Options } from './options/Options';
import { Utils } from './utils/Utils';

class JavaScriptObfuscatorFacade {
    /**
     * @type {string | undefined}
     */
    public static version: string = process.env.VERSION ?? 'unknown';
    public static readonly VMBytecodeFormat = VMBytecodeFormat;
    public static readonly VMDefenseCategory = VMDefenseCategory;
    public static readonly VMDefenseReaction = VMDefenseReaction;
    public static readonly VMTargetFunctionsMode = VMTargetFunctionsMode;


    /**
     * @param {string} sourceCode
     * @param {TInputOptions} inputOptions
     * @returns {IObfuscationResult}
     */
    public static obfuscate(sourceCode: string, inputOptions: TInputOptions = {}): IObfuscationResult {
        const normalizedSourceCode: string = typeof sourceCode === 'string' ? sourceCode : '';
        const outerContainer: IInversifyContainerFacade = new InversifyContainerFacade();
        let outerContainerLoaded: boolean = true;

        outerContainer.load('', '', inputOptions);

        try {
            const options: IOptions = outerContainer.get<IOptions>(ServiceIdentifiers.IOptions);
            const isHtml: boolean =
                options.parseHtml === true && HtmlObfuscator.isHtmlSource(normalizedSourceCode);

            if (!isHtml) {
                outerContainer.unload();
                outerContainerLoaded = false;

                return JavaScriptObfuscatorFacade.obfuscateJavaScriptUnit(
                    normalizedSourceCode,
                    inputOptions
                );
            }

            const htmlObfuscator: IHtmlObfuscator = outerContainer.get<IHtmlObfuscator>(
                ServiceIdentifiers.IHtmlObfuscator
            );
            const output: IHtmlObfuscationOutput = htmlObfuscator.obfuscate(
                normalizedSourceCode,
                options,
                (scriptCode: string): IObfuscationResult =>
                    JavaScriptObfuscatorFacade.obfuscateJavaScriptUnit(scriptCode, {
                        ...inputOptions,
                        parseHtml: false,
                        sourceMap: false,
                        identifierNamesCache: null
                    })
            );
            const warningsStorage: IObfuscationWarningsStorage =
                outerContainer.get<IObfuscationWarningsStorage>(
                    ServiceIdentifiers.IObfuscationWarningsStorage
                );

            for (const warning of output.warnings) {
                warningsStorage.addWarning(warning);
            }

            const resultFactory: TObfuscationResultFactory =
                outerContainer.get<TObfuscationResultFactory>(
                    ServiceIdentifiers.Factory__IObfuscationResult
                );

            return resultFactory(output.code, '');
        } finally {
            if (outerContainerLoaded) {
                outerContainer.unload();
            }
        }
    }

    private static obfuscateJavaScriptUnit(
        sourceCode: string,
        inputOptions: TInputOptions
    ): IObfuscationResult {
        const container: IInversifyContainerFacade = new InversifyContainerFacade();
        const presetOptions: TInputOptions = Options.getOptionsByPreset(
            inputOptions.optionsPreset ?? OptionsPreset.Default
        );
        const randomIdentifiersPrefix: boolean =
            inputOptions.randomIdentifiersPrefix ??
            presetOptions.randomIdentifiersPrefix ??
            false;
        const effectiveOptions: TInputOptions = randomIdentifiersPrefix
            ? {
                  ...inputOptions,
                  identifiersPrefix: Utils.buildRandomIdentifiersPrefix(
                      inputOptions.seed ?? presetOptions.seed ?? 0,
                      sourceCode,
                      inputOptions.identifiersPrefix ??
                          presetOptions.identifiersPrefix ??
                          ''
                  )
              }
            : inputOptions;

        container.load(sourceCode, '', effectiveOptions);

        try {
            const javaScriptObfuscator: IJavaScriptObfuscator =
                container.get<IJavaScriptObfuscator>(
                    ServiceIdentifiers.IJavaScriptObfuscator
                );

            return javaScriptObfuscator.obfuscate(sourceCode);
        } finally {
            container.unload();
        }
    }

    /**
     * @param {TSourceCodesObject} sourceCodesObject
     * @param {TInputOptions} inputOptions
     * @returns {TObfuscationResultsObject<TSourceCodesObject>}
     */
    public static obfuscateMultiple<TSourceCodesObject extends TDictionary<string>>(
        sourceCodesObject: TSourceCodesObject,
        inputOptions: TInputOptions = {}
    ): TObfuscationResultsObject<TSourceCodesObject> {
        if (typeof sourceCodesObject !== 'object') {
            throw new Error('Source codes object should be a plain object');
        }

        return Object.keys(sourceCodesObject).reduce(
            (
                acc: TObfuscationResultsObject<TSourceCodesObject>,
                sourceCodeIdentifier: keyof TSourceCodesObject,
                index: number
            ) => {
                const identifiersPrefix: string = Utils.getIdentifiersPrefixForMultipleSources(
                    inputOptions.identifiersPrefix,
                    index
                );

                const sourceCode: string = sourceCodesObject[sourceCodeIdentifier];
                const sourceCodeOptions: TInputOptions = {
                    ...inputOptions,
                    identifiersPrefix
                };

                return {
                    ...acc,
                    [sourceCodeIdentifier]: JavaScriptObfuscatorFacade.obfuscate(sourceCode, sourceCodeOptions)
                };
            },
            <TObfuscationResultsObject<TSourceCodesObject>>{}
        );
    }

    /**
     * @param {TOptionsPreset} optionsPreset
     * @returns {TInputOptions}
     */
    public static getOptionsByPreset(optionsPreset: TOptionsPreset): TInputOptions {
        return Options.getOptionsByPreset(optionsPreset);
    }

}

export { JavaScriptObfuscatorFacade as JavaScriptObfuscator };
