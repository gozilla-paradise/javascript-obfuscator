"use strict";

import { TDictionary } from './src/types/TDictionary';
import { TInputOptions } from './src/types/options/TInputOptions';
import { TObfuscationResultsObject } from './src/types/TObfuscationResultsObject';
import { TOptionsPreset } from './src/types/options/TOptionsPreset';

import { IObfuscationResult } from './src/interfaces/source-code/IObfuscationResult';
import { JavaScriptObfuscator } from './src/JavaScriptObfuscatorFacade';
export { JavaScriptParsingError } from './src/errors/JavaScriptParsingError';
export { VMBytecodeFormat } from './src/enums/vm/VMBytecodeFormat';
export { VMDefenseCategory } from './src/enums/vm/VMDefenseCategory';
export { VMDefenseReaction } from './src/enums/vm/VMDefenseReaction';
export { VMTargetFunctionsMode } from './src/enums/vm/VMTargetFunctionsMode';
export type { IBrowserEnvironment } from './src/interfaces/vm/IBrowserEnvironment';
export type { IVMDefenseAliases } from './src/interfaces/vm/IVMDefenseAliases';
export type {
    IObfuscationWarning,
    TObfuscationWarningCode
} from './src/interfaces/source-code/IObfuscationWarning';
export type { IVMDefenseHook } from './src/interfaces/vm/IVMDefenseHook';


export type ObfuscatorOptions = TInputOptions;

export interface ObfuscationResult extends IObfuscationResult {}


/**
 * @param {string} sourceCode
 * @param {ObfuscatorOptions} inputOptions
 * @returns {ObfuscatedCode}
 */
export declare function obfuscate (sourceCode: string, inputOptions?: ObfuscatorOptions): ObfuscationResult;

/**
 * @param {TSourceCodesObject} sourceCodesObject
 * @param {TInputOptions} inputOptions
 * @returns {TObfuscationResultsObject<TSourceCodesObject>}
 */
export declare function obfuscateMultiple <TSourceCodesObject extends TDictionary<string>> (
    sourceCodesObject: TSourceCodesObject,
    inputOptions?: TInputOptions
): TObfuscationResultsObject<TSourceCodesObject>;


/**
 * @param {TOptionsPreset} optionsPreset
 * @returns {TInputOptions}
 */
export declare function getOptionsByPreset (optionsPreset: TOptionsPreset): TInputOptions;

/**
 * @type {string}
 */
export declare const version: string;

module.exports = JavaScriptObfuscator;
