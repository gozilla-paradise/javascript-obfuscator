import { IOptions } from '../../src/interfaces/options/IOptions';

export type TControlKind = 'boolean' | 'select' | 'number' | 'text' | 'textarea' | 'checkbox-group';
export type TOptionGroup =
    | 'General'
    | 'Identifiers'
    | 'Transformations'
    | 'String array'
    | 'Protections'
    | 'Source maps'
    | 'VM';

export interface IOptionControlDescriptor {
    readonly key: keyof IOptions;
    readonly label: string;
    readonly group: TOptionGroup;
    readonly kind: TControlKind;
    readonly values?: readonly string[];
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly dependsOn?: keyof IOptions | readonly (keyof IOptions)[];
}

const threshold: Pick<IOptionControlDescriptor, 'min' | 'max' | 'step'> = {
    min: 0,
    max: 1,
    step: 0.01
};

export const optionControls: readonly IOptionControlDescriptor[] = [
    { key: 'optionsPreset', label: 'Preset', group: 'General', kind: 'select', values: ['default', 'low-obfuscation', 'medium-obfuscation', 'high-obfuscation'] },
    { key: 'target', label: 'Target', group: 'General', kind: 'select', values: ['browser', 'browser-no-eval', 'node', 'service-worker'] },
    { key: 'compact', label: 'Compact output', group: 'General', kind: 'boolean' },
    { key: 'simplify', label: 'Simplify', group: 'General', kind: 'boolean' },
    { key: 'seed', label: 'Seed', group: 'General', kind: 'text' },
    { key: 'ignoreImports', label: 'Ignore imports', group: 'General', kind: 'boolean' },
    { key: 'log', label: 'Log transformations', group: 'General', kind: 'boolean' },
    { key: 'parseHtml', label: 'Parse HTML', group: 'General', kind: 'boolean' },
    { key: 'strictMode', label: 'Strict mode', group: 'General', kind: 'select', values: ['null', 'true', 'false'] },

    { key: 'identifierNamesGenerator', label: 'Identifier generator', group: 'Identifiers', kind: 'select', values: ['dictionary', 'hexadecimal', 'mangled', 'mangled-shuffled'] },
    { key: 'identifiersPrefix', label: 'Identifiers prefix', group: 'Identifiers', kind: 'text' },
    { key: 'randomIdentifiersPrefix', label: 'Random identifiers prefix', group: 'Identifiers', kind: 'boolean' },
    { key: 'renameGlobals', label: 'Rename globals', group: 'Identifiers', kind: 'boolean' },
    { key: 'renameProperties', label: 'Rename properties', group: 'Identifiers', kind: 'boolean' },
    { key: 'renamePropertiesMode', label: 'Rename properties mode', group: 'Identifiers', kind: 'select', values: ['safe', 'unsafe'], dependsOn: 'renameProperties' },
    { key: 'identifiersDictionary', label: 'Identifiers dictionary', group: 'Identifiers', kind: 'textarea' },
    { key: 'reservedNames', label: 'Reserved names', group: 'Identifiers', kind: 'textarea' },
    { key: 'reservedStrings', label: 'Reserved strings', group: 'Identifiers', kind: 'textarea' },

    { key: 'controlFlowFlattening', label: 'Control flow flattening', group: 'Transformations', kind: 'boolean' },
    { key: 'controlFlowFlatteningThreshold', label: 'Control flow threshold', group: 'Transformations', kind: 'number', ...threshold, dependsOn: 'controlFlowFlattening' },
    { key: 'deadCodeInjection', label: 'Dead code injection', group: 'Transformations', kind: 'boolean' },
    { key: 'deadCodeInjectionThreshold', label: 'Dead code threshold', group: 'Transformations', kind: 'number', ...threshold, dependsOn: 'deadCodeInjection' },
    { key: 'numbersToExpressions', label: 'Numbers to expressions', group: 'Transformations', kind: 'boolean' },
    { key: 'splitStrings', label: 'Split strings', group: 'Transformations', kind: 'boolean' },
    { key: 'splitStringsChunkLength', label: 'Split string chunk length', group: 'Transformations', kind: 'number', min: 1, step: 1, dependsOn: 'splitStrings' },
    { key: 'transformObjectKeys', label: 'Transform object keys', group: 'Transformations', kind: 'boolean' },
    { key: 'unicodeEscapeSequence', label: 'Unicode escape sequence', group: 'Transformations', kind: 'boolean' },

    { key: 'stringArray', label: 'String array', group: 'String array', kind: 'boolean' },
    { key: 'stringArrayEncoding', label: 'String array encoding', group: 'String array', kind: 'checkbox-group', values: ['none', 'base64', 'rc4'], dependsOn: 'stringArray' },
    { key: 'stringArrayThreshold', label: 'String array threshold', group: 'String array', kind: 'number', ...threshold, dependsOn: 'stringArray' },
    { key: 'stringArrayCallsTransform', label: 'Transform string array calls', group: 'String array', kind: 'boolean', dependsOn: 'stringArray' },
    { key: 'stringArrayCallsTransformThreshold', label: 'String array calls threshold', group: 'String array', kind: 'number', ...threshold, dependsOn: ['stringArray', 'stringArrayCallsTransform'] },
    { key: 'stringArrayIndexesType', label: 'String array index types', group: 'String array', kind: 'checkbox-group', values: ['hexadecimal-number', 'hexadecimal-numeric-string'], dependsOn: 'stringArray' },
    { key: 'stringArrayIndexShift', label: 'Shift string array indexes', group: 'String array', kind: 'boolean', dependsOn: 'stringArray' },
    { key: 'stringArrayRotate', label: 'Rotate string array', group: 'String array', kind: 'boolean', dependsOn: 'stringArray' },
    { key: 'stringArrayShuffle', label: 'Shuffle string array', group: 'String array', kind: 'boolean', dependsOn: 'stringArray' },
    { key: 'stringArrayWrappersChainedCalls', label: 'Chained wrapper calls', group: 'String array', kind: 'boolean', dependsOn: 'stringArray' },
    { key: 'stringArrayWrappersCount', label: 'Wrapper count', group: 'String array', kind: 'number', min: 0, step: 1, dependsOn: 'stringArray' },
    { key: 'stringArrayWrappersParametersMaxCount', label: 'Wrapper parameter maximum', group: 'String array', kind: 'number', min: 2, step: 1, dependsOn: 'stringArray' },
    { key: 'stringArrayWrappersType', label: 'Wrapper type', group: 'String array', kind: 'select', values: ['variable', 'function'], dependsOn: 'stringArray' },

    { key: 'selfDefending', label: 'Self defending', group: 'Protections', kind: 'boolean' },
    { key: 'debugProtection', label: 'Debug protection', group: 'Protections', kind: 'boolean' },
    { key: 'debugProtectionInterval', label: 'Debug protection interval', group: 'Protections', kind: 'number', min: 0, step: 1, dependsOn: 'debugProtection' },
    { key: 'disableConsoleOutput', label: 'Disable console output', group: 'Protections', kind: 'boolean' },
    { key: 'domainLock', label: 'Allowed domains', group: 'Protections', kind: 'textarea' },
    { key: 'domainLockRedirectUrl', label: 'Domain lock redirect URL', group: 'Protections', kind: 'text' },
    { key: 'forceTransformStrings', label: 'Force-transform strings', group: 'Protections', kind: 'textarea' },

    { key: 'sourceMap', label: 'Source map', group: 'Source maps', kind: 'boolean' },
    { key: 'sourceMapMode', label: 'Source map mode', group: 'Source maps', kind: 'select', values: ['inline', 'separate'], dependsOn: 'sourceMap' },
    { key: 'sourceMapSourcesMode', label: 'Source map sources', group: 'Source maps', kind: 'select', values: ['sources', 'sources-content'], dependsOn: 'sourceMap' },
    { key: 'sourceMapBaseUrl', label: 'Source map base URL', group: 'Source maps', kind: 'text', dependsOn: 'sourceMap' },

    { key: 'vmObfuscation', label: 'VM obfuscation', group: 'VM', kind: 'boolean' },
    { key: 'vmObfuscationThreshold', label: 'VM threshold', group: 'VM', kind: 'number', ...threshold, dependsOn: 'vmObfuscation' },
    { key: 'vmTargetFunctions', label: 'VM target functions', group: 'VM', kind: 'textarea', dependsOn: 'vmObfuscation' },
    { key: 'vmTargetFunctionsMode', label: 'VM target mode', group: 'VM', kind: 'select', values: ['root', 'comment'], dependsOn: 'vmObfuscation' },
    { key: 'vmExcludeFunctions', label: 'VM excluded functions', group: 'VM', kind: 'textarea', dependsOn: 'vmObfuscation' },
    { key: 'vmAsyncExecutor', label: 'Async executor', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmBytecodeFormat', label: 'Bytecode format', group: 'VM', kind: 'select', values: ['json', 'binary'], dependsOn: 'vmObfuscation' },
    { key: 'vmBytecodeEncoding', label: 'Encode bytecode payload', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmBytecodeArrayEncoding', label: 'Encode bytecode arrays', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmBytecodeArrayEncodingKey', label: 'Bytecode array key', group: 'VM', kind: 'text', dependsOn: ['vmObfuscation', 'vmBytecodeArrayEncoding'] },
    { key: 'vmBytecodeArrayEncodingKeyGetter', label: 'Bytecode key getter', group: 'VM', kind: 'text', dependsOn: ['vmObfuscation', 'vmBytecodeArrayEncoding'] },
    { key: 'vmCallContextOpcodes', label: 'Call-context opcodes', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmCompactDispatcher', label: 'Compact dispatcher', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmDeadCodeInjection', label: 'VM dead code injection', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmDebugProtection', label: 'VM debug protection', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmDecoyOpcodes', label: 'Decoy opcodes', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmDomainLock', label: 'VM allowed domains', group: 'VM', kind: 'textarea', dependsOn: 'vmObfuscation' },
    { key: 'vmDomainLockRedirectUrl', label: 'VM domain redirect URL', group: 'VM', kind: 'text', dependsOn: 'vmObfuscation' },
    { key: 'vmDynamicOpcodes', label: 'Dynamic opcodes', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmForceCompileDynamicCode', label: 'Force compile dynamic code', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmIndirectDispatch', label: 'Indirect dispatch', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmInstructionShuffle', label: 'Instruction shuffle', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmJumpsEncoding', label: 'Jump encoding', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmMacroOps', label: 'Macro operations', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmOpcodeShuffle', label: 'Opcode shuffle', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmPreprocessIdentifiers', label: 'Preprocess identifiers', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmRandomizeKeys', label: 'Randomize VM keys', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmRegisterBased', label: 'Register-based VM', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmRuntimeOpcodeDerivation', label: 'Runtime opcode derivation', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmSelfDefending', label: 'VM self defending', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmSplitDispatcher', label: 'Split dispatcher', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmStackEncoding', label: 'Stack encoding', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmStatefulOpcodes', label: 'Stateful opcodes', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmStringArrayBytecodeOnly', label: 'VM-only string array bytecode', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' },
    { key: 'vmWrapTopLevelInitializers', label: 'Wrap top-level initializers', group: 'VM', kind: 'boolean', dependsOn: 'vmObfuscation' }
];

export const maximalCompatibleVMOptions: Readonly<Partial<IOptions>> = {
    stringArray: true,
    vmAsyncExecutor: false,
    vmBytecodeArrayEncoding: true,
    vmBytecodeArrayEncodingKey: '',
    vmBytecodeArrayEncodingKeyGetter: '',
    vmBytecodeEncoding: true,
    vmBytecodeFormat: 'binary',
    vmCallContextOpcodes: true,
    vmCompactDispatcher: true,
    vmDeadCodeInjection: true,
    vmDebugProtection: true,
    vmDecoyOpcodes: true,
    vmDomainLock: [],
    vmDomainLockRedirectUrl: 'about:blank',
    vmDynamicOpcodes: true,
    vmExcludeFunctions: [],
    vmForceCompileDynamicCode: true,
    vmIndirectDispatch: true,
    vmInstructionShuffle: true,
    vmJumpsEncoding: true,
    vmMacroOps: true,
    vmObfuscation: true,
    vmObfuscationThreshold: 1,
    vmOpcodeShuffle: true,
    vmPreprocessIdentifiers: true,
    vmRandomizeKeys: true,
    vmRegisterBased: true,
    vmRuntimeOpcodeDerivation: true,
    vmSelfDefending: true,
    vmSplitDispatcher: true,
    vmStackEncoding: true,
    vmStatefulOpcodes: true,
    vmStringArrayBytecodeOnly: true,
    vmTargetFunctions: [],
    vmTargetFunctionsMode: 'root',
    vmWrapTopLevelInitializers: true
};

export const advancedOnlyOptionNames: readonly (keyof IOptions)[] = [
    'browserEnvironment',
    'identifierNamesCache',
    'inputFileName',
    'sourceMapFileName',
    'vmDefenseHook',
    'vmDefenseReaction'
];

export const optionGroups: readonly TOptionGroup[] = [
    'General',
    'Identifiers',
    'Transformations',
    'String array',
    'Protections',
    'Source maps',
    'VM'
];
