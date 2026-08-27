import { TIdentifierNamesCache } from '../../types/TIdentifierNamesCache';
import { TOptionsPreset } from '../../types/options/TOptionsPreset';
import { TStringArrayIndexesType } from '../../types/options/TStringArrayIndexesType';
import { TStringArrayEncoding } from '../../types/options/TStringArrayEncoding';
import { TStringArrayWrappersType } from '../../types/options/TStringArrayWrappersType';
import { TRenamePropertiesMode } from '../../types/options/TRenamePropertiesMode';
import { TTypeFromEnum } from '../../types/utils/TTypeFromEnum';
import { IBrowserEnvironment } from '../vm/IBrowserEnvironment';
import { IVMDefenseHook } from '../vm/IVMDefenseHook';

import { VMBytecodeFormat } from '../../enums/vm/VMBytecodeFormat';
import { VMDefenseCategory } from '../../enums/vm/VMDefenseCategory';
import { VMDefenseReaction } from '../../enums/vm/VMDefenseReaction';
import { VMTargetFunctionsMode } from '../../enums/vm/VMTargetFunctionsMode';


import { IdentifierNamesGenerator } from '../../enums/generators/identifier-names-generators/IdentifierNamesGenerator';
import { ObfuscationTarget } from '../../enums/ObfuscationTarget';
import { SourceMapMode } from '../../enums/source-map/SourceMapMode';
import { SourceMapSourcesMode } from '../../enums/source-map/SourceMapSourcesMode';

export type TVMDefenseReactionMap = Partial<
    Record<
        TTypeFromEnum<typeof VMDefenseCategory> | 'default',
        TTypeFromEnum<typeof VMDefenseReaction>
    >
>;

export interface IOptions {
    readonly browserEnvironment: IBrowserEnvironment;

    readonly compact: boolean;
    readonly controlFlowFlattening: boolean;
    readonly controlFlowFlatteningThreshold: number;
    readonly deadCodeInjection: boolean;
    readonly deadCodeInjectionThreshold: number;
    readonly debugProtection: boolean;
    readonly debugProtectionInterval: number;
    readonly disableConsoleOutput: boolean;
    readonly domainLock: string[];
    readonly domainLockRedirectUrl: string;
    readonly forceTransformStrings: string[];
    readonly identifierNamesCache: TIdentifierNamesCache;
    readonly identifierNamesGenerator: TTypeFromEnum<typeof IdentifierNamesGenerator>;
    readonly identifiersDictionary: string[];
    readonly identifiersPrefix: string;
    readonly randomIdentifiersPrefix: boolean;

    readonly ignoreImports: boolean;
    readonly inputFileName: string;
    readonly log: boolean;
    readonly numbersToExpressions: boolean;
    readonly optionsPreset: TOptionsPreset;
    readonly renameGlobals: boolean;
    readonly renameProperties: boolean;
    readonly renamePropertiesMode: TRenamePropertiesMode;
    readonly reservedNames: string[];
    readonly reservedStrings: string[];
    readonly seed: string | number;
    readonly selfDefending: boolean;
    readonly simplify: boolean;
    readonly parseHtml: boolean;

    readonly sourceMap: boolean;
    readonly sourceMapBaseUrl: string;
    readonly sourceMapFileName: string;
    readonly sourceMapMode: TTypeFromEnum<typeof SourceMapMode>;
    readonly sourceMapSourcesMode: TTypeFromEnum<typeof SourceMapSourcesMode>;
    readonly splitStrings: boolean;
    readonly splitStringsChunkLength: number;
    readonly stringArray: boolean;
    readonly stringArrayCallsTransform: boolean;
    readonly stringArrayCallsTransformThreshold: number;
    readonly stringArrayEncoding: TStringArrayEncoding[];
    readonly stringArrayIndexesType: TStringArrayIndexesType[];
    readonly stringArrayIndexShift: boolean;
    readonly stringArrayRotate: boolean;
    readonly stringArrayShuffle: boolean;
    readonly stringArrayWrappersChainedCalls: boolean;
    readonly stringArrayWrappersCount: number;
    readonly stringArrayWrappersParametersMaxCount: number;
    readonly stringArrayWrappersType: TStringArrayWrappersType;
    readonly stringArrayThreshold: number;
    readonly target: TTypeFromEnum<typeof ObfuscationTarget>;
    readonly strictMode: boolean | null;

    readonly transformObjectKeys: boolean;
    readonly unicodeEscapeSequence: boolean;
    readonly vmAsyncExecutor: boolean;
    readonly vmBytecodeArrayEncoding: boolean;
    readonly vmBytecodeArrayEncodingKey: string;
    readonly vmBytecodeArrayEncodingKeyGetter: string;
    readonly vmBytecodeEncoding: boolean;
    readonly vmBytecodeFormat: TTypeFromEnum<typeof VMBytecodeFormat>;
    readonly vmCallContextOpcodes: boolean;
    readonly vmCompactDispatcher: boolean;
    readonly vmDeadCodeInjection: boolean;
    readonly vmDebugProtection: boolean;
    readonly vmDecoyOpcodes: boolean;
    readonly vmDefenseHook: IVMDefenseHook | null;
    readonly vmDefenseReaction: TVMDefenseReactionMap;
    readonly vmDomainLock: string[];
    readonly vmDomainLockRedirectUrl: string;
    readonly vmDynamicOpcodes: boolean;
    readonly vmExcludeFunctions: string[];
    readonly vmForceCompileDynamicCode: boolean;
    readonly vmIndirectDispatch: boolean;
    readonly vmInstructionShuffle: boolean;
    readonly vmJumpsEncoding: boolean;
    readonly vmMacroOps: boolean;
    readonly vmObfuscation: boolean;
    readonly vmObfuscationThreshold: number;
    readonly vmOpcodeShuffle: boolean;
    readonly vmPreprocessIdentifiers: boolean;
    readonly vmRandomizeKeys: boolean;
    readonly vmRegisterBased: boolean;
    readonly vmRuntimeOpcodeDerivation: boolean;
    readonly vmSelfDefending: boolean;
    readonly vmSplitDispatcher: boolean;
    readonly vmStackEncoding: boolean;
    readonly vmStatefulOpcodes: boolean;
    readonly vmStringArrayBytecodeOnly: boolean;
    readonly vmTargetFunctions: string[];
    readonly vmTargetFunctionsMode: TTypeFromEnum<typeof VMTargetFunctionsMode>;
    readonly vmWrapTopLevelInitializers: boolean;
}
