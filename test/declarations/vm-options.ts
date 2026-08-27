import JavaScriptObfuscator = require('../../typings/index');

const result = JavaScriptObfuscator.obfuscate('function f(){return 1}', {
    randomIdentifiersPrefix: true,
    browserEnvironment: { transport: 'https' },
    strictMode: true,
    parseHtml: false,
    vmObfuscation: true,
    vmObfuscationThreshold: 1,
    vmPreprocessIdentifiers: false,
    vmDynamicOpcodes: true,
    vmTargetFunctions: ['f'],
    vmExcludeFunctions: [],
    vmTargetFunctionsMode: JavaScriptObfuscator.VMTargetFunctionsMode.Root,
    vmForceCompileDynamicCode: false,
    vmWrapTopLevelInitializers: false,
    vmOpcodeShuffle: true,
    vmBytecodeEncoding: true,
    vmBytecodeArrayEncoding: true,
    vmBytecodeArrayEncodingKey: 'key',
    vmBytecodeArrayEncodingKeyGetter: 'globalThis.key',
    vmInstructionShuffle: true,
    vmJumpsEncoding: true,
    vmDecoyOpcodes: true,
    vmDeadCodeInjection: true,
    vmSplitDispatcher: true,
    vmMacroOps: true,
    vmDebugProtection: true,
    vmSelfDefending: true,
    vmRuntimeOpcodeDerivation: true,
    vmStatefulOpcodes: true,
    vmCallContextOpcodes: true,
    vmAsyncExecutor: false,
    vmStackEncoding: true,
    vmRandomizeKeys: true,
    vmIndirectDispatch: true,
    vmCompactDispatcher: true,
    vmRegisterBased: true,
    vmStringArrayBytecodeOnly: true,
    vmDomainLock: ['example.com'],
    vmDomainLockRedirectUrl: 'about:blank',
    vmBytecodeFormat: JavaScriptObfuscator.VMBytecodeFormat.Binary,
    vmDefenseHook: { name: '__defense' },
    vmDefenseReaction: { default: JavaScriptObfuscator.VMDefenseReaction.None }
});

result.getWarnings().forEach((warning) => {
    warning.code;
    warning.location?.line;
});

// @ts-expect-error cloud API was removed
JavaScriptObfuscator.obfuscatePro;
// @ts-expect-error cloud error was removed
JavaScriptObfuscator.ApiError;
