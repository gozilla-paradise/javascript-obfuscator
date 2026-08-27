import { TInputOptions } from '../../types/options/TInputOptions';

import { IdentifierNamesGenerator } from '../../enums/generators/identifier-names-generators/IdentifierNamesGenerator';
import { ObfuscationTarget } from '../../enums/ObfuscationTarget';
import { OptionsPreset } from '../../enums/options/presets/OptionsPreset';
import { RenamePropertiesMode } from '../../enums/node-transformers/rename-properties-transformers/RenamePropertiesMode';
import { SourceMapMode } from '../../enums/source-map/SourceMapMode';
import { SourceMapSourcesMode } from '../../enums/source-map/SourceMapSourcesMode';
import { StringArrayIndexesType } from '../../enums/node-transformers/string-array-transformers/StringArrayIndexesType';
import { StringArrayEncoding } from '../../enums/node-transformers/string-array-transformers/StringArrayEncoding';
import { StringArrayWrappersType } from '../../enums/node-transformers/string-array-transformers/StringArrayWrappersType';
import { VMBytecodeFormat } from '../../enums/vm/VMBytecodeFormat';
import { VMDefenseReaction } from '../../enums/vm/VMDefenseReaction';
import { VMTargetFunctionsMode } from '../../enums/vm/VMTargetFunctionsMode';


export const DEFAULT_PRESET: TInputOptions = Object.freeze({
    browserEnvironment: {},

    compact: true,
    config: '',
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    domainLock: [],
    domainLockRedirectUrl: 'about:blank',
    exclude: [],
    forceTransformStrings: [],
    identifierNamesCache: null,
    identifierNamesGenerator: IdentifierNamesGenerator.HexadecimalIdentifierNamesGenerator,
    identifiersPrefix: '',
    randomIdentifiersPrefix: false,

    identifiersDictionary: [],
    ignoreImports: false,
    inputFileName: '',
    log: false,
    numbersToExpressions: false,
    optionsPreset: OptionsPreset.Default,
    parseHtml: false,

    renameGlobals: false,
    renameProperties: false,
    renamePropertiesMode: RenamePropertiesMode.Safe,
    reservedNames: [],
    reservedStrings: [],
    stringArrayRotate: true,
    seed: 0,
    selfDefending: false,
    stringArrayShuffle: true,
    simplify: true,
    sourceMap: false,
    sourceMapBaseUrl: '',
    sourceMapFileName: '',
    sourceMapMode: SourceMapMode.Separate,
    sourceMapSourcesMode: SourceMapSourcesMode.SourcesContent,
    splitStrings: false,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: [StringArrayEncoding.None],
    stringArrayIndexesType: [StringArrayIndexesType.HexadecimalNumber],
    stringArrayIndexShift: true,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: StringArrayWrappersType.Variable,
    stringArrayThreshold: 0.75,
    strictMode: null,

    target: ObfuscationTarget.Browser,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    vmAsyncExecutor: false,
    vmBytecodeArrayEncoding: false,
    vmBytecodeArrayEncodingKey: '',
    vmBytecodeArrayEncodingKeyGetter: '',
    vmBytecodeEncoding: false,
    vmBytecodeFormat: VMBytecodeFormat.Binary,
    vmCallContextOpcodes: false,
    vmCompactDispatcher: false,
    vmDeadCodeInjection: false,
    vmDebugProtection: false,
    vmDecoyOpcodes: false,
    vmDefenseHook: null,
    vmDefenseReaction: {
        automation: VMDefenseReaction.Break,
        debugger: VMDefenseReaction.Decoy,
        sandbox: VMDefenseReaction.Decoy,
        domain: VMDefenseReaction.Break,
        tamper: VMDefenseReaction.Break,
        integrity: VMDefenseReaction.Break
    },
    vmDomainLock: [],
    vmDomainLockRedirectUrl: 'about:blank',
    vmDynamicOpcodes: false,
    vmExcludeFunctions: [],
    vmForceCompileDynamicCode: false,
    vmIndirectDispatch: false,
    vmInstructionShuffle: false,
    vmJumpsEncoding: false,
    vmMacroOps: false,
    vmObfuscation: false,
    vmObfuscationThreshold: 1,
    vmOpcodeShuffle: false,
    vmPreprocessIdentifiers: false,
    vmRandomizeKeys: false,
    vmRegisterBased: false,
    vmRuntimeOpcodeDerivation: false,
    vmSelfDefending: false,
    vmSplitDispatcher: false,
    vmStackEncoding: false,
    vmStatefulOpcodes: false,
    vmStringArrayBytecodeOnly: false,
    vmTargetFunctions: [],
    vmTargetFunctionsMode: VMTargetFunctionsMode.Root,
    vmWrapTopLevelInitializers: false
});
