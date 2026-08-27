/* eslint-disable */
import * as acorn from 'acorn';
import equal from 'fast-deep-equal';

import { inject, injectable } from 'inversify';
import { ServiceIdentifiers } from '../container/ServiceIdentifiers';

import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsObject,
    IsNumber,
    IsString,
    IsUrl,
    Max,
    Min,
    ValidateIf,
    validateSync,
    ValidationError,
    ValidatorOptions
} from 'class-validator';

import { TIdentifierNamesCache } from '../types/TIdentifierNamesCache';
import { TInputOptions } from '../types/options/TInputOptions';
import { TOptionsPreset } from '../types/options/TOptionsPreset';
import { TRenamePropertiesMode } from '../types/options/TRenamePropertiesMode';
import { TStringArrayIndexesType } from '../types/options/TStringArrayIndexesType';
import { TStringArrayEncoding } from '../types/options/TStringArrayEncoding';
import { TStringArrayWrappersType } from '../types/options/TStringArrayWrappersType';
import { TTypeFromEnum } from '../types/utils/TTypeFromEnum';
import { IBrowserEnvironment } from '../interfaces/vm/IBrowserEnvironment';
import { IVMDefenseHook } from '../interfaces/vm/IVMDefenseHook';


import { IOptions, TVMDefenseReactionMap } from '../interfaces/options/IOptions';
import { IOptionsNormalizer } from '../interfaces/options/IOptionsNormalizer';

import { IdentifierNamesGenerator } from '../enums/generators/identifier-names-generators/IdentifierNamesGenerator';
import { ObfuscationTarget } from '../enums/ObfuscationTarget';
import { OptionsPreset } from '../enums/options/presets/OptionsPreset';

import { RenamePropertiesMode } from '../enums/node-transformers/rename-properties-transformers/RenamePropertiesMode';
import { SourceMapMode } from '../enums/source-map/SourceMapMode';
import { SourceMapSourcesMode } from '../enums/source-map/SourceMapSourcesMode';
import { StringArrayIndexesType } from '../enums/node-transformers/string-array-transformers/StringArrayIndexesType';
import { StringArrayEncoding } from '../enums/node-transformers/string-array-transformers/StringArrayEncoding';
import { StringArrayWrappersType } from '../enums/node-transformers/string-array-transformers/StringArrayWrappersType';
import { VMBytecodeFormat } from '../enums/vm/VMBytecodeFormat';
import { VMTargetFunctionsMode } from '../enums/vm/VMTargetFunctionsMode';
import { VMDefenseCategory } from '../enums/vm/VMDefenseCategory';
import { VMDefenseReaction } from '../enums/vm/VMDefenseReaction';


import { DEFAULT_PRESET } from './presets/Default';
import { LOW_OBFUSCATION_PRESET } from './presets/LowObfuscation';
import { MEDIUM_OBFUSCATION_PRESET } from './presets/MediumObfuscation';
import { HIGH_OBFUSCATION_PRESET } from './presets/HighObfuscation';

import { ValidationErrorsFormatter } from './ValidationErrorsFormatter';
import { IsAllowedForObfuscationTargets } from './validators/IsAllowedForObfuscationTargets';
import { IsDomainLockRedirectUrl } from './validators/IsDomainLockRedirectUrl';
import { IsIdentifierNamesCache } from './validators/IsIdentifierNamesCache';
import { IsInputFileName } from './validators/IsInputFileName';

@injectable()
export class Options implements IOptions {
    /**
     * @type {Map<TOptionsPreset, TInputOptions>}
     */
    private static readonly optionPresetsMap: Map<TOptionsPreset, TInputOptions> = new Map([
        [OptionsPreset.Default, DEFAULT_PRESET],
        [OptionsPreset.LowObfuscation, LOW_OBFUSCATION_PRESET],
        [OptionsPreset.MediumObfuscation, MEDIUM_OBFUSCATION_PRESET],
        [OptionsPreset.HighObfuscation, HIGH_OBFUSCATION_PRESET]
    ]);

    /**
     * @type {ValidatorOptions}
     */
    private static readonly validatorOptions: ValidatorOptions = {
        forbidUnknownValues: true,
        validationError: {
            target: false
        }
    };

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly compact!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly controlFlowFlattening!: boolean;

    /**
     * @type {boolean}
     */
    @IsNumber()
    @Min(0)
    @Max(1)
    public readonly controlFlowFlatteningThreshold!: number;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly deadCodeInjection!: boolean;

    /**
     * @type {number}
     */
    @IsNumber()
    public readonly deadCodeInjectionThreshold!: number;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly debugProtection!: boolean;

    /**
     * @type {number}
     */
    @IsNumber()
    @Min(0)
    public readonly debugProtectionInterval!: number;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly disableConsoleOutput!: boolean;

    /**
     * @type {string[]}
     */
    @IsArray()
    @ArrayUnique()
    @IsString({
        each: true
    })
    @IsAllowedForObfuscationTargets([ObfuscationTarget.Browser, ObfuscationTarget.BrowserNoEval])
    public readonly domainLock!: string[];

    /**
     * @type {string}
     */
    @IsDomainLockRedirectUrl()
    public readonly domainLockRedirectUrl!: string;

    /**
     * @type {string[]}
     */
    @IsArray()
    @ArrayUnique()
    @IsString({
        each: true
    })
    public readonly forceTransformStrings!: string[];

    /**
     * @type {TIdentifierNamesCache}
     */
    @IsIdentifierNamesCache()
    public readonly identifierNamesCache!: TIdentifierNamesCache;

    /**
     * @type {IdentifierNamesGenerator}
     */
    @IsIn([
        IdentifierNamesGenerator.DictionaryIdentifierNamesGenerator,
        IdentifierNamesGenerator.HexadecimalIdentifierNamesGenerator,
        IdentifierNamesGenerator.MangledIdentifierNamesGenerator,
        IdentifierNamesGenerator.MangledShuffledIdentifierNamesGenerator
    ])
    public readonly identifierNamesGenerator!: TTypeFromEnum<typeof IdentifierNamesGenerator>;

    /**
     * @type {string}
     */
    @IsString()
    public readonly identifiersPrefix!: string;

    @IsArray()
    @ArrayUnique()
    @IsString({
        each: true
    })
    @ValidateIf(
        (options: IOptions) =>
            options.identifierNamesGenerator === IdentifierNamesGenerator.DictionaryIdentifierNamesGenerator
    )
    @ArrayNotEmpty()
    public readonly identifiersDictionary!: string[];

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly ignoreImports!: boolean;

    /**
     * @type {string}
     */
    @IsInputFileName()
    public readonly inputFileName!: string;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly log!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly numbersToExpressions!: boolean;

    /**
     * @type {TOptionsPreset}
     */
    @IsIn([
        OptionsPreset.Default,
        OptionsPreset.LowObfuscation,
        OptionsPreset.MediumObfuscation,
        OptionsPreset.HighObfuscation
    ])
    public readonly optionsPreset!: TOptionsPreset;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly renameGlobals!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly renameProperties!: boolean;

    /**
     * @type {RenamePropertiesMode}
     */
    @IsIn([RenamePropertiesMode.Safe, RenamePropertiesMode.Unsafe])
    public readonly renamePropertiesMode!: TRenamePropertiesMode;

    /**
     * @type {string[]}
     */
    @IsArray()
    @ArrayUnique()
    @IsString({
        each: true
    })
    public readonly reservedNames!: string[];

    /**
     * @type {string[]}
     */
    @IsArray()
    @ArrayUnique()
    @IsString({
        each: true
    })
    public readonly reservedStrings!: string[];

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly selfDefending!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly simplify!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly sourceMap!: boolean;

    /**
     * @type {string}
     */
    @IsString()
    @ValidateIf((options: IOptions) => Boolean(options.sourceMapBaseUrl))
    @IsUrl({
        require_protocol: true,
        require_tld: false,
        require_valid_protocol: true
    })
    public readonly sourceMapBaseUrl!: string;

    /**
     * @type {string}
     */
    @IsString()
    public readonly sourceMapFileName!: string;

    /**
     * @type {SourceMapMode}
     */
    @IsIn([SourceMapMode.Inline, SourceMapMode.Separate])
    public readonly sourceMapMode!: TTypeFromEnum<typeof SourceMapMode>;

    /**
     * @type {SourceMapSourcesMode}
     */
    @IsIn([SourceMapSourcesMode.Sources, SourceMapSourcesMode.SourcesContent])
    public readonly sourceMapSourcesMode!: TTypeFromEnum<typeof SourceMapSourcesMode>;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly splitStrings!: boolean;

    /**
     * @type {number}
     */
    @IsNumber()
    @ValidateIf((options: IOptions) => Boolean(options.splitStrings))
    @Min(1)
    public readonly splitStringsChunkLength!: number;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArray!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArrayCallsTransform!: boolean;

    /**
     * @type {number}
     */
    @IsNumber()
    @Min(0)
    @Max(1)
    public readonly stringArrayCallsTransformThreshold!: number;

    /**
     * @type {TStringArrayEncoding[]}
     */
    @IsArray()
    @ArrayUnique()
    @IsIn([StringArrayEncoding.None, StringArrayEncoding.Base64, StringArrayEncoding.Rc4], { each: true })
    public readonly stringArrayEncoding!: TStringArrayEncoding[];

    /**
     * @type {TStringArrayIndexesType[]}
     */
    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsIn([StringArrayIndexesType.HexadecimalNumber, StringArrayIndexesType.HexadecimalNumericString], { each: true })
    public readonly stringArrayIndexesType!: TStringArrayIndexesType[];

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArrayIndexShift!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArrayRotate!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArrayShuffle!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly stringArrayWrappersChainedCalls!: boolean;

    /**
     * @type {boolean}
     */
    @IsNumber()
    @Min(0)
    public readonly stringArrayWrappersCount!: number;

    /**
     * @type {boolean}
     */
    @IsNumber()
    @Min(2)
    public readonly stringArrayWrappersParametersMaxCount!: number;

    /**
     * @type {TStringArrayWrappersType}
     */
    @IsIn([StringArrayWrappersType.Variable, StringArrayWrappersType.Function])
    public readonly stringArrayWrappersType!: TStringArrayWrappersType;

    /**
     * @type {number}
     */
    @IsNumber()
    @Min(0)
    @Max(1)
    public readonly stringArrayThreshold!: number;

    /**
     * @type {ObfuscationTarget}
     */
    @IsIn([
        ObfuscationTarget.Browser,
        ObfuscationTarget.BrowserNoEval,
        ObfuscationTarget.Node,
        ObfuscationTarget.ServiceWorker
    ])
    public readonly target!: TTypeFromEnum<typeof ObfuscationTarget>;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly transformObjectKeys!: boolean;

    /**
     * @type {boolean}
     */
    @IsBoolean()
    public readonly unicodeEscapeSequence!: boolean;
    @IsObject()
    public readonly browserEnvironment!: IBrowserEnvironment;

    @IsBoolean()
    public readonly parseHtml!: boolean;

    @IsBoolean()
    public readonly randomIdentifiersPrefix!: boolean;

    @IsIn([true, false, null])
    public readonly strictMode!: boolean | null;

    @IsBoolean()
    public readonly vmAsyncExecutor!: boolean;

    @IsBoolean()
    public readonly vmBytecodeArrayEncoding!: boolean;

    @IsString()
    public readonly vmBytecodeArrayEncodingKey!: string;

    @IsString()
    public readonly vmBytecodeArrayEncodingKeyGetter!: string;

    @IsBoolean()
    public readonly vmBytecodeEncoding!: boolean;

    @IsIn([VMBytecodeFormat.Binary, VMBytecodeFormat.Json])
    public readonly vmBytecodeFormat!: TTypeFromEnum<typeof VMBytecodeFormat>;

    @IsBoolean()
    public readonly vmCallContextOpcodes!: boolean;

    @IsBoolean()
    public readonly vmCompactDispatcher!: boolean;

    @IsBoolean()
    public readonly vmDeadCodeInjection!: boolean;

    @IsBoolean()
    public readonly vmDebugProtection!: boolean;

    @IsBoolean()
    public readonly vmDecoyOpcodes!: boolean;

    @ValidateIf((options: IOptions) => options.vmDefenseHook !== null)
    @IsObject()
    public readonly vmDefenseHook!: IVMDefenseHook | null;

    @IsObject()
    public readonly vmDefenseReaction!: TVMDefenseReactionMap;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    public readonly vmDomainLock!: string[];

    @IsString()
    public readonly vmDomainLockRedirectUrl!: string;

    @IsBoolean()
    public readonly vmDynamicOpcodes!: boolean;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    public readonly vmExcludeFunctions!: string[];

    @IsBoolean()
    public readonly vmForceCompileDynamicCode!: boolean;

    @IsBoolean()
    public readonly vmIndirectDispatch!: boolean;

    @IsBoolean()
    public readonly vmInstructionShuffle!: boolean;

    @IsBoolean()
    public readonly vmJumpsEncoding!: boolean;

    @IsBoolean()
    public readonly vmMacroOps!: boolean;

    @IsBoolean()
    public readonly vmObfuscation!: boolean;

    @IsNumber()
    @Min(0)
    @Max(1)
    public readonly vmObfuscationThreshold!: number;

    @IsBoolean()
    public readonly vmOpcodeShuffle!: boolean;

    @IsBoolean()
    public readonly vmPreprocessIdentifiers!: boolean;

    @IsBoolean()
    public readonly vmRandomizeKeys!: boolean;

    @IsBoolean()
    public readonly vmRegisterBased!: boolean;

    @IsBoolean()
    public readonly vmRuntimeOpcodeDerivation!: boolean;

    @IsBoolean()
    public readonly vmSelfDefending!: boolean;

    @IsBoolean()
    public readonly vmSplitDispatcher!: boolean;

    @IsBoolean()
    public readonly vmStackEncoding!: boolean;

    @IsBoolean()
    public readonly vmStatefulOpcodes!: boolean;

    @IsBoolean()
    public readonly vmStringArrayBytecodeOnly!: boolean;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    public readonly vmTargetFunctions!: string[];

    @IsIn([VMTargetFunctionsMode.Root, VMTargetFunctionsMode.Comment])
    public readonly vmTargetFunctionsMode!: TTypeFromEnum<typeof VMTargetFunctionsMode>;

    @IsBoolean()
    public readonly vmWrapTopLevelInitializers!: boolean;


    /**
     * @type {string | number}
     */
    public readonly seed!: string | number;
    private static readonly vmOptionProperties: (keyof IOptions)[] = [
        'vmAsyncExecutor',
        'vmBytecodeArrayEncoding',
        'vmBytecodeArrayEncodingKey',
        'vmBytecodeArrayEncodingKeyGetter',
        'vmBytecodeEncoding',
        'vmBytecodeFormat',
        'vmCallContextOpcodes',
        'vmCompactDispatcher',
        'vmDeadCodeInjection',
        'vmDebugProtection',
        'vmDecoyOpcodes',
        'vmDefenseHook',
        'vmDefenseReaction',
        'vmDomainLock',
        'vmDomainLockRedirectUrl',
        'vmDynamicOpcodes',
        'vmExcludeFunctions',
        'vmForceCompileDynamicCode',
        'vmIndirectDispatch',
        'vmInstructionShuffle',
        'vmJumpsEncoding',
        'vmMacroOps',
        'vmObfuscationThreshold',
        'vmOpcodeShuffle',
        'vmPreprocessIdentifiers',
        'vmRandomizeKeys',
        'vmRegisterBased',
        'vmRuntimeOpcodeDerivation',
        'vmSelfDefending',
        'vmSplitDispatcher',
        'vmStackEncoding',
        'vmStatefulOpcodes',
        'vmStringArrayBytecodeOnly',
        'vmTargetFunctions',
        'vmTargetFunctionsMode',
        'vmWrapTopLevelInitializers'
    ];

    private static readonly defenseCategories: TTypeFromEnum<typeof VMDefenseCategory>[] = [
        VMDefenseCategory.Automation,
        VMDefenseCategory.Debugger,
        VMDefenseCategory.Sandbox,
        VMDefenseCategory.Domain,
        VMDefenseCategory.Tamper,
        VMDefenseCategory.Integrity
    ];

    private static readonly defenseSources: string[] = [
        'headless',
        'agent',
        'node',
        'debugger',
        'timing',
        'sandbox',
        'domain',
        'nativeHook',
        'integrity'
    ];

    private static applyImplications(options: TInputOptions): TInputOptions {
        let normalizedOptions: TInputOptions = options;

        if (options.vmSelfDefending === true) {
            normalizedOptions = {
                ...normalizedOptions,
                vmBytecodeArrayEncoding: true
            };
        }

        if (options.vmStringArrayBytecodeOnly === true) {
            normalizedOptions = {
                ...normalizedOptions,
                stringArray: true
            };
        }

        if (options.parseHtml === true) {
            normalizedOptions = {
                ...normalizedOptions,
                sourceMap: false,
                identifierNamesCache: null
            };
        }

        return normalizedOptions;
    }

    private static clonePlain<TValue>(value: TValue): TValue {
        if (Array.isArray(value)) {
            return <TValue>value.map((item: unknown) => Options.clonePlain(item));
        }

        if (Options.isPlainObject(value)) {
            const clone: Record<string, unknown> = {};

            for (const [key, item] of Object.entries(value)) {
                clone[key] = Options.clonePlain(item);
            }

            return <TValue>clone;
        }

        return value;
    }

    private static deepFreeze(value: unknown): void {
        if ((!Array.isArray(value) && !Options.isPlainObject(value)) || Object.isFrozen(value)) {
            return;
        }

        for (const item of Object.values(value)) {
            Options.deepFreeze(item);
        }

        Object.freeze(value);
    }

    private static freeze(options: Options): void {
        for (const value of Object.values(options)) {
            Options.deepFreeze(value);
        }

        Object.freeze(options);
    }

    private static isPlainObject(value: unknown): value is Record<string, unknown> {
        if (value === null || typeof value !== 'object') {
            return false;
        }

        const prototype: object | null = Object.getPrototypeOf(value);

        return prototype === Object.prototype || prototype === null;
    }

    private static throwInvalidShape(property: string): never {
        throw new ReferenceError(`Validation failed. \`${property}\` has an invalid shape`);
    }

    private static assertKnownKeys(
        value: Record<string, unknown>,
        allowedKeys: readonly string[],
        property: string
    ): void {
        if (Object.keys(value).some((key: string) => !allowedKeys.includes(key))) {
            Options.throwInvalidShape(property);
        }
    }

    private static validateAliasField(
        value: unknown,
        property: string,
        allowedValues: readonly string[] | null
    ): void {
        if (!Options.isPlainObject(value)) {
            Options.throwInvalidShape(property);
        }

        Options.assertKnownKeys(value, allowedValues ? ['key', 'values'] : ['key'], property);

        if (value.key !== undefined && typeof value.key !== 'string') {
            Options.throwInvalidShape(`${property}.key`);
        }

        if (allowedValues === null || value.values === undefined) {
            return;
        }

        if (!Options.isPlainObject(value.values)) {
            Options.throwInvalidShape(`${property}.values`);
        }

        if (
            Object.entries(value.values).some(
                ([key, alias]: [string, unknown]) =>
                    !allowedValues.includes(key) || typeof alias !== 'string'
            )
        ) {
            Options.throwInvalidShape(`${property}.values`);
        }
    }

    private static validateStructuredOptions(options: Options): void {
        if (!Options.isPlainObject(options.browserEnvironment)) {
            Options.throwInvalidShape('browserEnvironment');
        }

        Options.assertKnownKeys(options.browserEnvironment, ['transport'], 'browserEnvironment');

        if (
            options.browserEnvironment.transport !== undefined &&
            options.browserEnvironment.transport !== 'http' &&
            options.browserEnvironment.transport !== 'https'
        ) {
            Options.throwInvalidShape('browserEnvironment.transport');
        }

        if (options.vmDefenseHook !== null) {
            if (!Options.isPlainObject(options.vmDefenseHook)) {
                Options.throwInvalidShape('vmDefenseHook');
            }

            Options.assertKnownKeys(options.vmDefenseHook, ['name', 'aliases'], 'vmDefenseHook');

            if (typeof options.vmDefenseHook.name !== 'string' || options.vmDefenseHook.name.length === 0) {
                Options.throwInvalidShape('vmDefenseHook.name');
            }

            const aliases: unknown = options.vmDefenseHook.aliases;

            if (aliases !== undefined) {
                if (!Options.isPlainObject(aliases)) {
                    Options.throwInvalidShape('vmDefenseHook.aliases');
                }

                Options.assertKnownKeys(
                    aliases,
                    ['source', 'category', 'score', 'threshold'],
                    'vmDefenseHook.aliases'
                );

                if (aliases.source !== undefined) {
                    Options.validateAliasField(
                        aliases.source,
                        'vmDefenseHook.aliases.source',
                        Options.defenseSources
                    );
                }

                if (aliases.category !== undefined) {
                    Options.validateAliasField(
                        aliases.category,
                        'vmDefenseHook.aliases.category',
                        Options.defenseCategories
                    );
                }

                if (aliases.score !== undefined) {
                    Options.validateAliasField(aliases.score, 'vmDefenseHook.aliases.score', null);
                }

                if (aliases.threshold !== undefined) {
                    Options.validateAliasField(
                        aliases.threshold,
                        'vmDefenseHook.aliases.threshold',
                        null
                    );
                }
            }
        }

        if (!Options.isPlainObject(options.vmDefenseReaction)) {
            Options.throwInvalidShape('vmDefenseReaction');
        }

        const allowedReactionKeys: string[] = [...Options.defenseCategories, 'default'];
        const allowedReactionValues: string[] = [
            VMDefenseReaction.Break,
            VMDefenseReaction.Decoy,
            VMDefenseReaction.None
        ];

        if (
            Object.entries(options.vmDefenseReaction).some(
                ([key, reaction]: [string, unknown]) =>
                    !allowedReactionKeys.includes(key) ||
                    typeof reaction !== 'string' ||
                    !allowedReactionValues.includes(reaction)
            )
        ) {
            Options.throwInvalidShape('vmDefenseReaction');
        }
    }

    private static resolveDefenseReactions(
        reactions: TVMDefenseReactionMap
    ): TVMDefenseReactionMap {
        const defaults: TVMDefenseReactionMap = <TVMDefenseReactionMap>(
            DEFAULT_PRESET.vmDefenseReaction
        );
        const resolved: TVMDefenseReactionMap = {};

        for (const category of Options.defenseCategories) {
            resolved[category] = reactions[category] ?? reactions.default ?? defaults[category];
        }

        return resolved;
    }

    private static throwConflict(firstProperty: string, secondProperty: string): never {
        throw new ReferenceError(
            `Validation failed. \`${firstProperty}\` conflicts with \`${secondProperty}\``
        );
    }
    private static validateVMDisabledOptions(options: Options): void {
        if (options.vmObfuscation !== false) {
            return;
        }

        for (const property of Options.vmOptionProperties) {
            if (!equal(options[property], DEFAULT_PRESET[property])) {
                Options.throwConflict('vmObfuscation', String(property));
            }
        }
    }


    private static validateCrossOptionRelations(options: Options): void {

        const hasBytecodeKey: boolean = options.vmBytecodeArrayEncodingKey.length > 0;
        const hasBytecodeKeyGetter: boolean = options.vmBytecodeArrayEncodingKeyGetter.length > 0;

        if (hasBytecodeKey !== hasBytecodeKeyGetter) {
            Options.throwConflict(
                'vmBytecodeArrayEncodingKey',
                'vmBytecodeArrayEncodingKeyGetter'
            );
        }

        if ((hasBytecodeKey || hasBytecodeKeyGetter) && !options.vmBytecodeArrayEncoding) {
            Options.throwConflict(
                'vmBytecodeArrayEncodingKey',
                'vmBytecodeArrayEncoding'
            );
        }

        if (hasBytecodeKeyGetter) {
            try {
                acorn.parse(`(${options.vmBytecodeArrayEncodingKeyGetter})`, {
                    ecmaVersion: 'latest'
                });
            } catch {
                throw new ReferenceError(
                    'Invalid vmBytecodeArrayEncodingKeyGetter expression'
                );
            }
        }

        if (options.vmAsyncExecutor) {
            if (!options.vmBytecodeArrayEncoding) {
                Options.throwConflict('vmAsyncExecutor', 'vmBytecodeArrayEncoding');
            }

            if (!hasBytecodeKey || !hasBytecodeKeyGetter) {
                Options.throwConflict(
                    'vmAsyncExecutor',
                    'vmBytecodeArrayEncodingKeyGetter'
                );
            }

            if (options.vmTargetFunctions.length > 0) {
                Options.throwConflict('vmAsyncExecutor', 'vmTargetFunctions');
            }

            if (options.vmObfuscationThreshold !== 1) {
                Options.throwConflict('vmAsyncExecutor', 'vmObfuscationThreshold');
            }

            if (options.vmWrapTopLevelInitializers) {
                Options.throwConflict('vmAsyncExecutor', 'vmWrapTopLevelInitializers');
            }
        } else if (options.vmTargetFunctionsMode === VMTargetFunctionsMode.Comment) {
            if (options.vmTargetFunctions.length > 0) {
                Options.throwConflict('vmTargetFunctionsMode', 'vmTargetFunctions');
            }

            if (options.vmWrapTopLevelInitializers) {
                Options.throwConflict(
                    'vmTargetFunctionsMode',
                    'vmWrapTopLevelInitializers'
                );
            }
        }

        const hasNondefaultDefenseConfiguration: boolean =
            options.vmDefenseHook !== null ||
            !equal(options.vmDefenseReaction, DEFAULT_PRESET.vmDefenseReaction);
        const hasEnabledDefense: boolean =
            options.vmSelfDefending ||
            options.vmDebugProtection ||
            options.vmDomainLock.length > 0;

        if (hasNondefaultDefenseConfiguration && !hasEnabledDefense) {
            Options.throwConflict(
                options.vmDefenseHook !== null ? 'vmDefenseHook' : 'vmDefenseReaction',
                'vmSelfDefending'
            );
        }

        if (
            options.vmDomainLock.length > 0 &&
            options.target !== ObfuscationTarget.Browser &&
            options.target !== ObfuscationTarget.BrowserNoEval
        ) {
            Options.throwConflict('vmDomainLock', 'target');
        }

        if (
            options.vmDomainLockRedirectUrl !== 'about:blank' &&
            options.vmDomainLock.length === 0
        ) {
            Options.throwConflict('vmDomainLockRedirectUrl', 'vmDomainLock');
        }

        if (options.browserEnvironment.transport !== undefined) {
            if (!options.vmSelfDefending) {
                Options.throwConflict('browserEnvironment.transport', 'vmSelfDefending');
            }

            if (
                options.target !== ObfuscationTarget.Browser &&
                options.target !== ObfuscationTarget.BrowserNoEval &&
                options.target !== ObfuscationTarget.ServiceWorker
            ) {
                Options.throwConflict('browserEnvironment.transport', 'target');
            }
        }
    }


    /**
     * @param {TInputOptions} inputOptions
     * @param {IOptionsNormalizer} optionsNormalizer
     */
    public constructor(
        @inject(ServiceIdentifiers.TInputOptions) inputOptions: TInputOptions,
        @inject(ServiceIdentifiers.IOptionsNormalizer) optionsNormalizer: IOptionsNormalizer
    ) {
        const optionsPreset: TInputOptions = Options.getOptionsByPreset(
            inputOptions.optionsPreset ?? OptionsPreset.Default
        );
        const mergedOptions: TInputOptions = Options.applyImplications({
            ...optionsPreset,
            ...inputOptions
        });

        Object.assign(this, Options.clonePlain(mergedOptions));

        const errors: ValidationError[] = validateSync(this, Options.validatorOptions);

        if (errors.length) {
            throw new ReferenceError(`Validation failed. errors:\n${ValidationErrorsFormatter.format(errors)}`);
        }

        Options.validateStructuredOptions(this);
        Options.validateVMDisabledOptions(this);
        Object.assign(this, {
            vmDefenseReaction: Options.resolveDefenseReactions(this.vmDefenseReaction)
        });
        Options.validateCrossOptionRelations(this);
        Object.assign(this, optionsNormalizer.normalize(this));
        Options.freeze(this);
    }

    /**
     * @param {TOptionsPreset} optionsPreset
     * @returns {TInputOptions}
     */
    public static getOptionsByPreset(optionsPreset: TOptionsPreset): TInputOptions {
        const options: TInputOptions | null = Options.optionPresetsMap.get(optionsPreset) ?? null;

        if (!options) {
            throw new Error(`Options for preset name \`${optionsPreset}\` are not found`);
        }

        return options;
    }
}
