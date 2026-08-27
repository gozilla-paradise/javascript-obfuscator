/* eslint-disable */
import { inject, injectable } from 'inversify';

import { ServiceIdentifiers } from '../container/ServiceIdentifiers';


import { VMBytecodeFormat } from '../enums/vm/VMBytecodeFormat';
import {
    bytesToHex,
    chacha20Xor,
    concatenateBytes,
    deriveDefaultVMKey,
    deriveVMKeyMaterial,
    hmacSha256,
    utf8Bytes
} from './VMCrypto';
import {
    createVMRuntimeCrypto,
    type IVMRuntimeCrypto
} from './VMRuntimeCrypto';

import type { IVMProtectedProgram } from '../interfaces/vm/IVMProgram';
import type { IVMRuntimeBuild, IVMRuntimeBuilder } from '../interfaces/vm/IVMRuntimeBuilder';
import type { IVMSerializedProgram } from '../interfaces/vm/IVMSerializer';
import type { IOptions } from '../interfaces/options/IOptions';


@injectable()
export class VMRuntimeBuilder implements IVMRuntimeBuilder {
    public static readonly runtimeIdentifier: string = '__jovm';

    public constructor(
        @inject(ServiceIdentifiers.IOptions) private readonly options: IOptions
    ) {}

    public build(program: IVMSerializedProgram): IVMRuntimeBuild {
        const protection =
            'protection' in program.program
                ? (program.program as IVMProtectedProgram).protection
                : {
                      decodedOpcodes: {},
                      jumpKeys: {},
                      decoyOpcodes: [],
                      programId: []
                  };
        const hasCustomKey: boolean =
            this.options.vmBytecodeArrayEncodingKey.length > 0;
        const key: string = hasCustomKey
            ? this.options.vmBytecodeArrayEncodingKey
            : deriveDefaultVMKey(this.options.seed);
        const keyMaterial = deriveVMKeyMaterial(key, this.options.seed);
        const programId: Uint8Array = Uint8Array.from(protection.programId);
        const wholeArrayEncoding: boolean =
            this.options.vmBytecodeArrayEncoding;
        let payload: string;

        if (wholeArrayEncoding) {
            const plaintext: Uint8Array =
                program.format === VMBytecodeFormat.Binary
                    ? program.bytes
                    : utf8Bytes(program.json);
            const nonce: Uint8Array = hmacSha256(
                keyMaterial.prk,
                utf8Bytes(`payload:${bytesToHex(programId)}`)
            ).slice(0, 12);
            const ciphertext: Uint8Array = chacha20Xor(
                plaintext,
                keyMaterial.encryptionKey,
                nonce,
                1
            );
            const tag: Uint8Array = hmacSha256(
                keyMaterial.macKey,
                concatenateBytes(programId, nonce, ciphertext)
            );
            payload = JSON.stringify(
                VMRuntimeBuilder.bytesToBase64(
                    concatenateBytes(programId, nonce, ciphertext, tag)
                )
            );
        } else {
            payload =
                program.format === VMBytecodeFormat.Binary
                    ? JSON.stringify(
                          VMRuntimeBuilder.bytesToBase64(program.bytes)
                      )
                    : program.json;
        }
        const format: string = JSON.stringify(program.format);
        const serializedProtection: string = JSON.stringify(protection);
        const embedded: number[] | null = hasCustomKey
            ? null
            : Array.from(key).flatMap(
                  (character: string, index: number): number[] => {
                      const mask: number = (index * 73 + 41) & 0xff;

                      return [mask, character.charCodeAt(0) ^ mask];
                  }
              );
        const keyConfig = {
            async: this.options.vmAsyncExecutor,
            embedded,
            encoded: wholeArrayEncoding,
            seed: this.options.seed
        };
        const keyGetter: string = hasCustomKey
            ? `()=>(${this.options.vmBytecodeArrayEncodingKeyGetter})`
            : 'null';
        const serializedKeyConfig: string = JSON.stringify(keyConfig);
        const defenseConfig = {
            target: this.options.target,
            selfDefending: this.options.vmSelfDefending,
            debugProtection: this.options.vmDebugProtection,
            domains: this.options.vmDomainLock,
            redirectUrl: this.options.vmDomainLockRedirectUrl,
            hook: this.options.vmDefenseHook,
            reactions: this.options.vmDefenseReaction,
            transport: this.options.browserEnvironment.transport ?? null
        };
        const serializedDefenseConfig: string = JSON.stringify(defenseConfig);

        const methodSource: string = VMRuntimeBuilder.runtimeFactory.toString();
        const factorySource: string = methodSource.startsWith('function')
            ? methodSource
            : `function ${methodSource}`;
        const cryptoMethodSource: string = createVMRuntimeCrypto.toString();
        const cryptoFactorySource: string = cryptoMethodSource.startsWith('function')
            ? cryptoMethodSource
            : `function ${cryptoMethodSource}`;


        return {
            runtimeIdentifier: VMRuntimeBuilder.runtimeIdentifier,
            bytecodeLiteralMode:
                wholeArrayEncoding || program.format === VMBytecodeFormat.Binary
                    ? 'payload'
                    : 'jsonConstants',
            code: `${factorySource};var ${VMRuntimeBuilder.runtimeIdentifier}=runtimeFactory(${payload},${format},(s)=>import(s),${serializedProtection},${keyGetter},${serializedKeyConfig},${serializedDefenseConfig},(${cryptoFactorySource})(),runtimeFactory);`
        };
    }


    private static bytesToBase64(bytes: Uint8Array): string {
        const alphabet: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let output: string = '';

        for (let index: number = 0; index < bytes.length; index += 3) {
            const first: number = bytes[index];
            const hasSecond: boolean = index + 1 < bytes.length;
            const hasThird: boolean = index + 2 < bytes.length;
            const second: number = hasSecond ? bytes[index + 1] : 0;
            const third: number = hasThird ? bytes[index + 2] : 0;
            const block: number = (first << 16) | (second << 8) | third;

            output += alphabet[(block >>> 18) & 63];
            output += alphabet[(block >>> 12) & 63];
            output += hasSecond ? alphabet[(block >>> 6) & 63] : '=';
            output += hasThird ? alphabet[block & 63] : '=';
        }

        return output;
    }

    private static runtimeFactory(
        payload: string | unknown[],
        format: string,
        dynamicImport: (specifier: string) => Promise<unknown>,
        protection: {
            decodedOpcodes: Record<string, number>;
            jumpKeys: Record<string, number>;
            decoyOpcodes: number[];
            programId: number[];
        },
        keyGetter: (() => unknown) | null,
        keyConfig: {
            async: boolean;
            embedded: number[] | null;
            encoded: boolean;
            seed: string | number;
        },
        defenseConfig: {
            target: string;
            selfDefending: boolean;
            debugProtection: boolean;
            domains: string[];
            redirectUrl: string;
            hook: {
                name: string;
                aliases?: {
                    source?: {
                        key?: string;
                        values?: Record<string, string>;
                    };
                    category?: {
                        key?: string;
                        values?: Record<string, string>;
                    };
                    score?: { key?: string };
                    threshold?: { key?: string };
                };
            } | null;
            reactions: Record<string, string>;
            transport: string | null;
        },
        crypto: IVMRuntimeCrypto,
        runtimeFactoryReference: (...args: unknown[]) => unknown
    ): Record<string, unknown> {
        'use strict';

        const NORMAL = 0;
        const RETURN = 1;
        const THROW = 2;
        const YIELD = 3;
        const AWAIT = 4;
        const HOLE = {};
        const UNINITIALIZED_THIS = {};
        const expectedIntegrityHash =
            '0000000000000000000000000000000000000000000000000000000000000000';
        type TRuntimeCapture = [() => unknown, (value: unknown) => unknown];
        type TRuntimeOperation = (...args: unknown[]) => unknown;

        interface IRuntimeCell {
            initialized: boolean;
            value: unknown;
        }
        interface IRuntimeFrame {
            readonly fn: unknown[];
            ip: number;
            readonly instructions: Map<number, unknown[]>;
            readonly stack: unknown[];
            readonly locals: IRuntimeCell[];
            readonly captures: TRuntimeCapture[];
            receiver: unknown;
            readonly argsObject: IArguments | null;
            readonly newTarget: unknown;
            readonly ops: TRuntimeOperation[];
            readonly registers: unknown[];
            readonly withStack: Record<string, unknown>[];
            suspended?: boolean;
        }

        const globals = globalThis as unknown as Record<string, unknown>;
        const functionPrototype = Object.getPrototypeOf(function (): void {});
        const nativeCall = functionPrototype.call as (...args: unknown[]) => unknown;
        const nativeApply = functionPrototype.apply as (...args: unknown[]) => unknown;
        const nativeToString = functionPrototype.toString as (...args: unknown[]) => string;
        const reflectApply = Reflect.apply;
        const defineProperty = Object.defineProperty;
        const capturedHook: unknown = defenseConfig.hook
            ? globals[defenseConfig.hook.name]
            : null;
        let hookActive = false;
        let poisoned = false;

        function reportDefense(
            source: string,
            category: string,
            score: number,
            threshold: number
        ): void {
            if (score < threshold) {
                return;
            }

            const aliases = defenseConfig.hook?.aliases;
            if (typeof capturedHook === 'function' && !hookActive) {
                const payload: Record<string, unknown> = {};
                const sourceAlias = aliases?.source;
                const categoryAlias = aliases?.category;
                payload[sourceAlias?.key ?? 'source'] =
                    sourceAlias?.values?.[source] ?? source;
                payload[categoryAlias?.key ?? 'category'] =
                    categoryAlias?.values?.[category] ?? category;
                payload[aliases?.score?.key ?? 'score'] = score;
                payload[aliases?.threshold?.key ?? 'threshold'] = threshold;
                hookActive = true;
                try {
                    reflectApply(
                        capturedHook as (...args: unknown[]) => unknown,
                        undefined,
                        [payload]
                    );
                } catch {
                    // Defense telemetry is observational and cannot alter reactions.
                } finally {
                    hookActive = false;
                }
            }

            const reaction = defenseConfig.reactions[category] ?? 'none';
            if (category === 'domain' && reaction !== 'none') {
                try {
                    const location = globals.location as
                        | { replace?: (url: string) => void }
                        | undefined;
                    if (typeof location?.replace === 'function') {
                        reflectApply(location.replace, location, [
                            defenseConfig.redirectUrl
                        ]);
                    }
                } catch {
                    // A blocked redirect does not suppress the configured reaction.
                }
            }
            if (reaction === 'break') {
                throw new Error('VM protection violation');
            }
            if (reaction === 'decoy') {
                poisoned = true;
            }
        }

        function nativeFunctionScore(): number {
            const nativePattern = /\{\s*\[native code\]\s*\}/;
            const functionsToCheck = [
                nativeCall,
                nativeApply,
                nativeToString,
                reflectApply,
                defineProperty
            ];
            for (const candidate of functionsToCheck) {
                let source = '';
                try {
                    source = reflectApply(nativeToString, candidate, []);
                } catch {
                    return 1;
                }
                if (!nativePattern.test(source)) {
                    return 1;
                }
            }

            return 0;
        }

        function agentScore(): number {
            if (
                '__OPENAI_CODEX__' in globals ||
                '__CLAUDE_CODE__' in globals ||
                '__COPILOT_AGENT__' in globals
            ) {
                return 1;
            }
            const processObject = globals.process as
                | { env?: Record<string, unknown> }
                | undefined;
            const environment = processObject?.env;

            return environment &&
                ('CODEX_HOME' in environment ||
                    'CLAUDECODE' in environment ||
                    'COPILOT_AGENT' in environment)
                ? 1
                : 0;
        }

        function headlessScore(): number {
            const navigatorObject = globals.navigator as
                | {
                      webdriver?: unknown;
                      languages?: unknown[];
                      plugins?: unknown[];
                      userAgent?: string;
                  }
                | undefined;
            const windowObject = globals.window as
                | Record<string, unknown>
                | undefined;
            let score = navigatorObject?.webdriver === true ? 1 : 0;
            if (
                !navigatorObject?.languages ||
                navigatorObject.languages.length === 0
            ) {
                score++;
            }
            if (
                !navigatorObject?.plugins ||
                navigatorObject.plugins.length === 0
            ) {
                score++;
            }
            if (
                /Chrom(?:e|ium)/.test(navigatorObject?.userAgent ?? '') &&
                (!windowObject || !('chrome' in windowObject))
            ) {
                score++;
            }
            if (
                typeof windowObject?.outerWidth === 'number' &&
                typeof windowObject.innerWidth === 'number' &&
                typeof windowObject.outerHeight === 'number' &&
                typeof windowObject.innerHeight === 'number' &&
                windowObject.outerWidth === windowObject.innerWidth &&
                windowObject.outerHeight === windowObject.innerHeight
            ) {
                score++;
            }

            return score;
        }

        function sandboxScore(worker: boolean): number {
            let score = 0;
            const host = worker ? globals.self : globals.window;
            if (!host || host !== globalThis) {score++;}
            if (worker) {
                if (!globals.location || !globals.navigator) {score++;}
            } else {
                if (!globals.document || !globals.location) {score++;}
            }
            if (
                typeof globals.setTimeout !== 'function' ||
                typeof globals.clearTimeout !== 'function'
            ) {
                score++;
            }
            if (nativeFunctionScore() !== 0) {score++;}

            return score;
        }

        function nodeScore(): number {
            const processObject = globals.process as
                | { versions?: { node?: unknown } }
                | undefined;

            return processObject?.versions?.node ? 1 : 0;
        }

        function debuggerAndTimingScores(): {
            readonly debuggerScore: number;
            readonly milliseconds: number;
        } {
            const processObject = globals.process as
                | { execArgv?: string[] }
                | undefined;
            const inspector =
                defenseConfig.target === 'node' &&
                !!processObject?.execArgv?.some((value: string) =>
                    value.startsWith('--inspect')
                );
            const start = Date.now();
            debugger;
            const milliseconds = Date.now() - start;

            return {
                debuggerScore: inspector || milliseconds >= 100 ? 1 : 0,
                milliseconds
            };
        }

        function runtimeIntegrityScore(): number {
            try {
                const source = reflectApply(
                    nativeToString,
                    runtimeFactoryReference,
                    []
                );
                const normalized = source.replace(
                    expectedIntegrityHash,
                    expectedIntegrityHash.replace(/./g, '0')
                );
                const digest = crypto.sha256(crypto.utf8Bytes(normalized));
                const actual = Array.from(
                    digest,
                    (value: number) => value.toString(16).padStart(2, '0')
                ).join('');

                return actual === expectedIntegrityHash ? 0 : 1;
            } catch {
                return 1;
            }
        }

        function domainScore(): number {
            const location = globals.location as
                | { hostname?: string }
                | undefined;
            const hostname = (location?.hostname ?? '').toLowerCase();
            if (!hostname) {
                return 1;
            }
            const allowed = defenseConfig.domains.some((domain: string) => {
                const normalized = domain.toLowerCase();

                return normalized.startsWith('.')
                    ? hostname === normalized.slice(1) ||
                          hostname.endsWith(normalized)
                    : hostname === normalized;
            });

            return allowed ? 0 : 1;
        }

        function runDefenses(): void {
            if (
                !defenseConfig.selfDefending &&
                !defenseConfig.debugProtection &&
                defenseConfig.domains.length === 0
            ) {
                return;
            }
            const sources = new Set<string>();
            const run = (
                source: string,
                category: string,
                score: number,
                threshold: number
            ): void => {
                if (sources.has(source)) {return;}
                sources.add(source);
                reportDefense(source, category, score, threshold);
            };
            const browser =
                defenseConfig.target === 'browser' ||
                defenseConfig.target === 'browser-no-eval';
            const worker = defenseConfig.target === 'service-worker';
            const timing = debuggerAndTimingScores();

            if (defenseConfig.selfDefending) {
                run('nativeHook', 'tamper', nativeFunctionScore(), 1);
                run('agent', 'automation', agentScore(), 1);
                run('debugger', 'debugger', timing.debuggerScore, 1);
                run('timing', 'debugger', timing.milliseconds, 100);
                let integrityScore = runtimeIntegrityScore();
                if (
                    defenseConfig.transport &&
                    browser &&
                    (globals.location as { protocol?: string } | undefined)
                        ?.protocol !== `${defenseConfig.transport}:`
                ) {
                    integrityScore = 1;
                }
                run('integrity', 'integrity', integrityScore, 1);
            }
            if (defenseConfig.debugProtection) {
                run('agent', 'automation', agentScore(), 1);
                run('debugger', 'debugger', timing.debuggerScore, 1);
                run('timing', 'debugger', timing.milliseconds, 100);
                if (browser) {
                    run('headless', 'automation', headlessScore(), 2);
                    run('sandbox', 'sandbox', sandboxScore(false), 2);
                    run('node', 'automation', nodeScore(), 1);
                } else if (worker) {
                    run('sandbox', 'sandbox', sandboxScore(true), 2);
                }
            }
            if (defenseConfig.domains.length > 0 && browser) {
                run('domain', 'domain', domainScore(), 1);
            }
        }
        const keyFailure = (error: unknown): Error => {
            const message = error instanceof Error ? error.message : String(error);
            const wrapped = new Error(`VM decryption key getter failed: ${message}`);
            Object.defineProperty(wrapped, 'cause', {
                value: error,
                configurable: false,
                enumerable: false,
                writable: false
            });

            return wrapped;
        };
        const validateKey = (value: unknown): string => {
            if (value === undefined || value === null || value === '') {
                throw new Error('VM decryption key not available');
            }
            if (typeof value !== 'string') {
                throw new Error('VM decryption key must be a string');
            }

            return value;
        };
        let embeddedKey: string | null = null;
        if (keyConfig.embedded) {
            embeddedKey = '';
            for (let index = 0; index < keyConfig.embedded.length; index += 2) {
                embeddedKey += String.fromCharCode(
                    keyConfig.embedded[index] ^ keyConfig.embedded[index + 1]
                );
            }
        }
        let synchronousKey: string | null = null;
        let startup: Promise<void> | null = null;
        try {
            const keyValue = keyGetter ? keyGetter() : embeddedKey;
            const thenable =
                keyValue !== null &&
                (typeof keyValue === 'object' || typeof keyValue === 'function') &&
                'then' in keyValue &&
                typeof keyValue.then === 'function';
            if (thenable) {
                if (!keyConfig.async) {
                    throw new Error('VM decryption key getter must be synchronous');
                }
                startup = Promise.resolve(keyValue).then(
                    (value: unknown): void => initialize(validateKey(value)),
                    (error: unknown) => {
                        throw keyFailure(error);
                    }
                );
            } else {
                synchronousKey = validateKey(keyValue);
            }
        } catch (error) {
            if (
                error instanceof Error &&
                (error.message === 'VM decryption key getter must be synchronous' ||
                    error.message === 'VM decryption key not available' ||
                    error.message === 'VM decryption key must be a string' ||
                    error.message === 'VM bytecode authentication failed')
            ) {
                throw error;
            }
            throw keyFailure(error);
        }


        function fromHex(hex: string): number {
            const bytes = new Uint8Array(8);
            for (let index = 0; index < 8; index++) {
                bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
            }

            return new DataView(bytes.buffer).getFloat64(0, false);
        }

        function decodeJson(raw: unknown[]): unknown[] {
            const constants = (raw[2] as unknown[][]).map((constant) => {
                switch (constant[0]) {
                    case 0:
                        return undefined;
                    case 1:
                        return null;
                    case 2:
                        return false;
                    case 3:
                        return true;
                    case 4:
                        return fromHex(constant[1] as string);
                    case 5:
                        return BigInt(constant[1] as string);
                    case 6:
                        return constant[1];
                    case 7:
                        return new RegExp(constant[1] as string, constant[2] as string);
                    case 8:
                        return HOLE;
                    case 9:
                        return constant[1];
                    default:
                        throw new Error('Invalid VM bytecode: unknown constant tag');
                }
            });

            return [raw[0], raw[1], constants, raw[3]];
        }

        function decodeBinary(base64: string): unknown[] {
            const text = atob(base64);
            const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
            let offset = 0;
            const byte = () => {
                if (offset >= bytes.length) {throw new Error('Invalid VM bytecode: truncated input');}

                return bytes[offset++];
            };
            const unsigned = () => {
                let value = 0;
                let multiplier = 1;
                for (let index = 0; index < 10; index++) {
                    const current = byte();
                    value += (current & 127) * multiplier;
                    if ((current & 128) === 0) {return value;}
                    multiplier *= 128;
                }
                throw new Error('Invalid VM bytecode: malformed varint');
            };
            const signed = () => {
                const value = unsigned();

                return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
            };
            const string = () => {
                const length = unsigned();
                const value = new TextDecoder().decode(bytes.slice(offset, offset + length));
                offset += length;

                return value;
            };
            if (byte() !== 74 || byte() !== 79 || byte() !== 86 || byte() !== 77 || byte() !== 1) {
                throw new Error('Invalid VM bytecode: invalid header');
            }
            const flags = byte() | (byte() << 8) | (byte() << 16) | (byte() << 24);
            const constants = [];
            const constantCount = unsigned();
            for (let index = 0; index < constantCount; index++) {
                const tag = byte();
                switch (tag) {
                    case 0:
                        constants.push(undefined);
                        break;
                    case 1:
                        constants.push(null);
                        break;
                    case 2:
                        constants.push(false);
                        break;
                    case 3:
                        constants.push(true);
                        break;
                    case 4: {
                        const data = bytes.slice(offset, offset + 8);
                        offset += 8;
                        constants.push(new DataView(data.buffer, data.byteOffset, 8).getFloat64(0, true));
                        break;
                    }
                    case 5: {
                        const negative = byte() === 1;
                        const length = unsigned();
                        let value = BigInt(0);
                        for (let byteIndex = 0; byteIndex < length; byteIndex++) {
                            value = (value << BigInt(8)) | BigInt(byte());
                        }
                        constants.push(negative ? -value : value);
                        break;
                    }
                    case 6:
                        constants.push(string());
                        break;
                    case 7:
                        constants.push(new RegExp(string(), string()));
                        break;
                    case 8:
                        constants.push(HOLE);
                        break;
                    case 9: {
                        const values = [];
                        const length = unsigned();
                        for (let valueIndex = 0; valueIndex < length; valueIndex++) {values.push(signed());}
                        constants.push(values);
                        break;
                    }
                    default:
                        throw new Error('Invalid VM bytecode: unknown constant tag');
                }
            }
            const functions = [];
            const functionCount = unsigned();
            for (let index = 0; index < functionCount; index++) {
                const id = unsigned();
                const functionFlags = byte() | (byte() << 8);
                const arity = unsigned();
                const localCount = unsigned();
                const captureCount = unsigned();
                const instructionCount = unsigned();
                const exceptionCount = unsigned();
                const instructions = [];
                const exceptions = [];
                for (let instructionIndex = 0; instructionIndex < instructionCount; instructionIndex++) {
                    const address = unsigned();
                    const next = unsigned() - 1;
                    const opcode = unsigned();
                    const operandCount = unsigned();
                    const instruction = [address, next, opcode];
                    for (let operandIndex = 0; operandIndex < operandCount; operandIndex++) {
                        instruction.push(signed());
                    }
                    instructions.push(instruction);
                }
                for (let exceptionIndex = 0; exceptionIndex < exceptionCount; exceptionIndex++) {
                    exceptions.push([signed(), signed(), signed(), signed(), signed()]);
                }
                functions.push([id, functionFlags, arity, localCount, captureCount, instructions, exceptions]);
            }

            return [1, flags >>> 0, constants, functions];
        }

        let programFlags = 0;
        const decodedOpcodes = protection.decodedOpcodes;
        const jumpKeys = protection.jumpKeys;
        let constants: unknown[] = [];
        const functions = new Map<number, unknown[]>();

        function initialize(key: string): void {
            const prk = crypto.hmacSha256(
                crypto.utf8Bytes(key),
                crypto.utf8Bytes(
                    `javascript-obfuscator-vm-v1\0${String(keyConfig.seed)}`
                )
            );
            const encryptionKey = crypto.hmacSha256(
                prk,
                crypto.utf8Bytes('enc')
            );
            const macKey = crypto.hmacSha256(
                prk,
                crypto.utf8Bytes('mac')
            );
            let rawPayload: string | unknown[] = payload;

            if (keyConfig.encoded) {
                if (typeof payload !== 'string') {
                    throw new Error('VM bytecode authentication failed');
                }
                const envelope = crypto.base64ToBytes(payload);
                if (envelope.length < 60) {
                    throw new Error('VM bytecode authentication failed');
                }
                const programId = envelope.slice(0, 16);
                const nonce = envelope.slice(16, 28);
                const ciphertext = envelope.slice(28, envelope.length - 32);
                const tag = envelope.slice(envelope.length - 32);
                const expectedProgramId = Uint8Array.from(protection.programId);
                const expectedTag = crypto.hmacSha256(
                    macKey,
                    crypto.concatenateBytes(programId, nonce, ciphertext)
                );
                if (
                    !crypto.constantTimeEqual(programId, expectedProgramId) ||
                    !crypto.constantTimeEqual(tag, expectedTag)
                ) {
                    throw new Error('VM bytecode authentication failed');
                }
                const plaintext = crypto.chacha20Xor(
                    ciphertext,
                    encryptionKey,
                    nonce,
                    1
                );
                rawPayload =
                    format === 'binary'
                        ? crypto.bytesToBase64(plaintext)
                        : JSON.parse(new TextDecoder().decode(plaintext));
            }

            const decoded =
                format === 'binary'
                    ? decodeBinary(rawPayload as string)
                    : decodeJson(rawPayload as unknown[]);
            programFlags = decoded[1] as number;

            if ((programFlags & 2) !== 0) {
                for (const vmFunction of decoded[3] as unknown[][]) {
                    const functionId = vmFunction[0] as number;
                    const instructionKey = crypto.hmacSha256(
                        prk,
                        crypto.utf8Bytes(`instruction:${functionId}`)
                    );
                    for (const instruction of vmFunction[5] as unknown[][]) {
                        const address = instruction[0] as number;
                        const nonce = crypto
                            .hmacSha256(
                                instructionKey,
                                crypto.utf8Bytes(`address:${address}`)
                            )
                            .slice(0, 12);
                        const wordCount = instruction.length - 2;
                        const stream = crypto.chacha20Xor(
                            new Uint8Array(wordCount * 4),
                            instructionKey,
                            nonce,
                            0
                        );
                        const word = (index: number): number =>
                            (stream[index * 4] |
                                (stream[index * 4 + 1] << 8) |
                                (stream[index * 4 + 2] << 16) |
                                (stream[index * 4 + 3] << 24)) >>>
                            0;
                        instruction[2] =
                            ((instruction[2] as number) ^ word(0)) >>> 0;
                        for (
                            let operandIndex = 3;
                            operandIndex < instruction.length;
                            operandIndex++
                        ) {
                            instruction[operandIndex] =
                                ((instruction[operandIndex] as number) ^
                                    word(operandIndex - 2)) |
                                0;
                        }
                    }
                }
            }

            constants = decoded[2] as unknown[];
            functions.clear();
            for (const vmFunction of decoded[3] as unknown[][]) {
                functions.set(vmFunction[0] as number, vmFunction);
            }
            runDefenses();
        }

        if (synchronousKey !== null) {
            initialize(synchronousKey);
        }

        function unary(operator: number, value: unknown): unknown {
            switch (operator) {
                case 0:
                    return void value;
                case 1:
                    return typeof value;
                case 2:
                    return +(value as number);
                case 3:
                    return -(value as number);
                case 4:
                    return ~(value as number);
                case 5:
                    return !value;
                default:
                    throw new Error('Invalid VM unary operator');
            }
        }

        function binary(operator: number, left: unknown, right: unknown): unknown {
            const numericLeft = left as number;
            const numericRight = right as number;
            switch (operator) {
                case 0:
                    return left == right;
                case 1:
                    return left != right;
                case 2:
                    return left === right;
                case 3:
                    return left !== right;
                case 4:
                    return numericLeft < numericRight;
                case 5:
                    return numericLeft <= numericRight;
                case 6:
                    return numericLeft > numericRight;
                case 7:
                    return numericLeft >= numericRight;
                case 8:
                    return numericLeft << numericRight;
                case 9:
                    return numericLeft >> numericRight;
                case 10:
                    return numericLeft >>> numericRight;
                case 11:
                    return numericLeft + numericRight;
                case 12:
                    return numericLeft - numericRight;
                case 13:
                    return numericLeft * numericRight;
                case 14:
                    return numericLeft / numericRight;
                case 15:
                    return numericLeft % numericRight;
                case 16:
                    return numericLeft ** numericRight;
                case 17:
                    return numericLeft | numericRight;
                case 18:
                    return numericLeft ^ numericRight;
                case 19:
                    return numericLeft & numericRight;
                case 20:
                    return (left as PropertyKey) in (right as object);
                case 21:
                    return (left as object) instanceof (right as Function);
                default:
                    throw new Error('Invalid VM binary operator');
            }
        }

        function expand(values: unknown[], maskIndex: number): unknown[] {
            if (maskIndex === -1) {return values;}
            const spread = new Set(constants[maskIndex] as number[]);
            const expanded: unknown[] = [];
            values.forEach((value, index) => {
                if (spread.has(index)) {expanded.push(...(value as Iterable<unknown>));}
                else {expanded.push(value);}
            });

            return expanded;
        }

        function createValueSlots(): unknown[] {
            if ((programFlags & 2048) === 0) {
                return [];
            }

            const valuesByHandle: Map<number, unknown> = new Map();
            let rollingKey: number = 0x6d_2b_79_f5;
            const isIndex = (property: string | symbol): property is string =>
                typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property);

            return new Proxy<unknown[]>([], {
                get(target: unknown[], property: string | symbol, receiver: unknown): unknown {
                    if (isIndex(property)) {
                        const handle: unknown = Reflect.get(target, property, receiver);
                        if (
                            !Number.isSafeInteger(handle) ||
                            !valuesByHandle.has(handle as number)
                        ) {
                            throw new Error('Invalid VM encoded slot');
                        }

                        return valuesByHandle.get(handle as number);
                    }

                    return Reflect.get(target, property, receiver);
                },
                set(
                    target: unknown[],
                    property: string | symbol,
                    value: unknown,
                    receiver: unknown
                ): boolean {
                    if (!isIndex(property)) {
                        return Reflect.set(target, property, value, receiver);
                    }
                    rollingKey = (Math.imul(rollingKey, 1_664_525) + 1_013_904_223) | 0;
                    let handle: number =
                        Number(property) ^ rollingKey ^ valuesByHandle.size;
                    while (valuesByHandle.has(handle)) {
                        handle = (handle + 1) | 0;
                    }
                    valuesByHandle.set(handle, value);

                    return Reflect.set(target, property, handle, receiver);
                },
                deleteProperty(target: unknown[], property: string | symbol): boolean {
                    if (isIndex(property)) {
                        const handle: unknown = Reflect.get(target, property);
                        if (typeof handle === 'number') {
                            valuesByHandle.delete(handle);
                        }
                    }

                    return Reflect.deleteProperty(target, property);
                }
            });
        }

        function createFrame(
            id: number,
            receiver: unknown,
            argsObject: IArguments | null,
            newTarget: unknown,
            captures: TRuntimeCapture[],
            ops: TRuntimeOperation[]
        ): IRuntimeFrame {
            const vmFunction = functions.get(id);
            if (!vmFunction) {throw new Error('Unknown VM function');}
            const instructionMap = new Map<number, unknown[]>();
            for (const instruction of vmFunction[5] as unknown[][]) {
                instructionMap.set(instruction[0] as number, instruction);
            }
            const firstInstruction = (vmFunction[5] as unknown[][])[0];

            return {
                fn: vmFunction,
                ip: instructionMap.has(0)
                    ? 0
                    : firstInstruction
                      ? (firstInstruction[0] as number)
                      : -1,
                instructions: instructionMap,
                stack:
                    (programFlags & 1) !== 0 ? [] : createValueSlots(),
                locals: Array.from({ length: vmFunction[3] as number }, () => ({ value: undefined, initialized: false })),
                captures,
                receiver,
                argsObject,
                newTarget,
                ops,
                withStack: [],
                registers: createValueSlots()
            };
        }

        function step(frame: IRuntimeFrame, resumeKind: number, resumeValue: unknown): unknown[] {
            if (resumeKind === THROW) {throw resumeValue;}
            if (resumeKind === RETURN) {return [RETURN, resumeValue, -1];}
            if (frame.suspended) {
                frame.stack.push(resumeValue);
                frame.suspended = false;
            }

            while (frame.ip !== -1) {
                const instruction = frame.instructions.get(frame.ip);
                if (!instruction) {throw new Error('Invalid VM instruction address');}
                const address = instruction[0] as number;
                const next = instruction[1] as number;
                let opcode = instruction[2] as number;
                let operands = instruction.slice(3) as number[];
                opcode = decodedOpcodes[`${String(frame.fn[0])}:${address}`] ?? opcode;
                let registerDestinations: number[] | null = null;
                if (opcode >= 256 && opcode < 384) {
                    const destinationCount: number = operands[0];
                    registerDestinations = operands.slice(1, destinationCount + 1);
                    const sourceCountIndex: number = destinationCount + 1;
                    const sourceCount: number = operands[sourceCountIndex];
                    const sourceRegisters: number[] = operands.slice(
                        sourceCountIndex + 1,
                        sourceCountIndex + 1 + sourceCount
                    );
                    sourceRegisters.forEach((register: number) => {
                        frame.stack.push(frame.registers[register]);
                    });
                    operands = operands.slice(sourceCountIndex + 1 + sourceCount);
                    opcode -= 256;
                }
                const decodeJump = (encodedTarget: number): number =>
                    (programFlags & 16) !== 0
                        ? address +
                          (encodedTarget ^ (jumpKeys[String(frame.fn[0])] ?? 0))
                        : encodedTarget;
                const stack = frame.stack;
                frame.ip = next;

                try {
                    switch (opcode) {
                        case 0:
                            break;
                        case 1:
                            stack.push(constants[operands[0]]);
                            break;
                        case 2:
                            return [RETURN, stack.pop(), -1];
                        case 3:
                            throw stack.pop();
                        case 4:
                            stack.pop();
                            break;
                        case 5:
                            stack.push(stack[stack.length - 1]);
                            break;
                        case 6: {
                            const cell = frame.locals[operands[0]];
                            if (!cell.initialized) {throw new ReferenceError('Cannot access binding before initialization');}
                            stack.push(cell.value);
                            break;
                        }
                        case 7: {
                            const value = stack[stack.length - 1];
                            const cell = frame.locals[operands[0]];
                            cell.value = value;
                            cell.initialized = true;
                            break;
                        }
                        case 8: {
                            const cell = frame.locals[operands[0]];
                            cell.value = stack.pop();
                            cell.initialized = true;
                            break;
                        }
                        case 9:
                            stack.push(frame.captures[operands[0]][0]());
                            break;
                        case 10: {
                            const value = stack[stack.length - 1];
                            frame.captures[operands[0]][1](value);
                            break;
                        }
                        case 11: {
                            const name = constants[operands[0]] as string;
                            if (!(name in globalThis)) {throw new ReferenceError(`${name} is not defined`);}
                            stack.push(globals[name]);
                            break;
                        }
                        case 12: {
                            const name = constants[operands[0]] as string;
                            const value = stack[stack.length - 1];
                            globals[name] = value;
                            break;
                        }
                        case 13:
                            stack.push(Reflect.deleteProperty(globalThis, constants[operands[0]] as string));
                            break;
                        case 14: {
                            const name = constants[operands[0]] as string;
                            stack.push(name in globals ? typeof globals[name] : 'undefined');
                            break;
                        }
                        case 15:
                            if (frame.receiver === UNINITIALIZED_THIS) {
                                throw new ReferenceError("Must call super constructor in derived class before accessing 'this' or returning from derived constructor");
                            }
                            stack.push(frame.receiver);
                            break;
                        case 16:
                            stack.push(frame.argsObject);
                            break;
                        case 17:
                            stack.push(frame.newTarget);
                            break;
                        case 18:
                            stack.push(unary(operands[0], stack.pop()));
                            break;
                        case 19: {
                            const right = stack.pop();
                            const left = stack.pop();
                            stack.push(binary(operands[0], left, right));
                            break;
                        }
                        case 21: {
                            const key = stack.pop() as PropertyKey;
                            const object = stack.pop();
                            if (object === null || object === undefined) {
                                throw new TypeError(
                                    'Cannot read properties of null or undefined'
                                );
                            }
                            stack.push(
                                (object as Record<PropertyKey, unknown>)[key]
                            );
                            break;
                        }
                        case 22: {
                            const value = stack.pop();
                            const key = stack.pop() as PropertyKey;
                            const object = stack.pop() as object;
                            Reflect.set(object, key, value);
                            stack.push(value);
                            break;
                        }
                        case 23: {
                            const key = stack.pop() as PropertyKey;
                            const object = stack.pop() as object;
                            stack.push(Reflect.deleteProperty(object, key));
                            break;
                        }
                        case 24: {
                            const receiver = stack.pop();
                            stack.push(frame.ops[operands[0]](receiver));
                            break;
                        }
                        case 25: {
                            const value = stack.pop();
                            const receiver = stack.pop();
                            stack.push(frame.ops[operands[0]](receiver, value));
                            break;
                        }
                        case 26:
                            stack.push([]);
                            break;
                        case 27: {
                            const value = stack.pop();
                            const array = stack.pop() as unknown[];
                            if (value === HOLE) {array.length++;}
                            else {array.push(value);}
                            stack.push(array);
                            break;
                        }
                        case 28: {
                            const iterable = stack.pop() as Iterable<unknown>;
                            const array = stack.pop() as unknown[];
                            array.push(...iterable);
                            stack.push(array);
                            break;
                        }
                        case 29:
                            stack.push({});
                            break;
                        case 30: {
                            const value = stack.pop();
                            const key = stack.pop() as PropertyKey;
                            const object = stack.pop() as object;
                            const descriptor: PropertyDescriptor = {
                                enumerable: !!(operands[1] & 1),
                                configurable: !!(operands[1] & 2)
                            };
                            if (operands[0] === 1) {descriptor.get = value as () => unknown;}
                            else if (operands[0] === 2) {descriptor.set = value as (value: unknown) => void;}
                            else {
                                descriptor.value = value;
                                descriptor.writable = !!(operands[1] & 4);
                            }
                            Object.defineProperty(object, key, descriptor);
                            stack.push(object);
                            break;
                        }
                        case 31: {
                            const source = stack.pop() as object;
                            const object = stack.pop() as object;
                            Object.assign(object, source);
                            stack.push(object);
                            break;
                        }
                        case 32:
                            frame.ip = decodeJump(operands[0]);
                            break;
                        case 33:
                            if (stack.pop()) {frame.ip = decodeJump(operands[0]);}
                            break;
                        case 34:
                            if (!stack.pop()) {frame.ip = decodeJump(operands[0]);}
                            break;
                        case 35:
                            if (stack.pop() == null) {frame.ip = decodeJump(operands[0]);}
                            break;
                        case 36: {
                            const values = stack.splice(stack.length - operands[0], operands[0]);
                            const callee = stack.pop() as (...args: unknown[]) => unknown;
                            stack.push(Reflect.apply(callee, undefined, expand(values, operands[1])));
                            break;
                        }
                        case 37: {
                            const values = stack.splice(stack.length - operands[0], operands[0]);
                            const callee = stack.pop() as (...args: unknown[]) => unknown;
                            const receiver = stack.pop();
                            stack.push(Reflect.apply(callee, receiver, expand(values, operands[1])));
                            break;
                        }
                        case 38: {
                            const values = stack.splice(
                                stack.length - operands[1],
                                operands[1]
                            );
                            const callee = stack.pop() as (
                                ...args: unknown[]
                            ) => unknown;
                            const receiver = operands[3]
                                ? stack.pop()
                                : undefined;
                            const token = getCallContextToken(operands[0]);
                            contextStack.push(token);
                            try {
                                stack.push(
                                    Reflect.apply(
                                        callee,
                                        receiver,
                                        expand(values, operands[2])
                                    )
                                );
                            } finally {
                                contextStack.pop();
                            }
                            break;
                        }

                        case 39: {
                            const values = stack.splice(stack.length - operands[0], operands[0]);
                            const constructor = stack.pop() as new (...args: unknown[]) => unknown;
                            stack.push(Reflect.construct(constructor, expand(values, operands[1])));
                            break;
                        }
                        case 40: {
                            const functionId = operands[0];
                            const closureCaptures: TRuntimeCapture[] = [];
                            for (let index = 0; index < operands[1]; index++) {
                                const source = operands[2 + index * 2];
                                const captureIndex = operands[3 + index * 2];
                                closureCaptures.push(source === 0 ? [
                                    () => frame.locals[captureIndex].value,
                                    (value: unknown) => (frame.locals[captureIndex].value = value)
                                ] : frame.captures[captureIndex]);
                            }
                            const nested = functions.get(functionId)!;
                            const nestedFlags = nested[1] as number;
                            const captureOperandEnd = 2 + operands[1] * 2;
                            const parameterAdapterOperation =
                                frame.ops[operands[captureOperandEnd]];
                            const nestedOperations = frame.ops[
                                operands[captureOperandEnd + 1]
                            ]() as TRuntimeOperation[];
                            const closure = function (this: unknown, ...args: unknown[]) {
                                const argsObject = arguments;
                                const parameterCaptures =
                                    parameterAdapterOperation(
                                        ...args
                                    ) as TRuntimeCapture[];
                                const captures = parameterCaptures.concat(closureCaptures);
                                if ((nestedFlags & 3) === 3) {
                                    return invokeAsyncGenerator(
                                        functionId,
                                        this,
                                        argsObject,
                                        new.target,
                                        captures,
                                        nestedOperations
                                    );
                                }
                                if (nestedFlags & 1) {
                                    return invokeAsync(
                                        functionId,
                                        this,
                                        argsObject,
                                        new.target,
                                        captures,
                                        nestedOperations
                                    );
                                }
                                if (nestedFlags & 2) {
                                    return invokeGenerator(
                                        functionId,
                                        this,
                                        argsObject,
                                        new.target,
                                        captures,
                                        nestedOperations
                                    );
                                }

                                return invokeSync(
                                    functionId,
                                    this,
                                    argsObject,
                                    new.target,
                                    captures,
                                    nestedOperations
                                );
                            };
                            stack.push(closure);
                            break;
                        }
                        case 41:
                            stack.push((stack.pop() as Iterable<unknown>)[Symbol.iterator]());
                            break;
                        case 44: {
                            const iterable = stack.pop() as
                                | AsyncIterable<unknown>
                                | Iterable<unknown>;
                            const asyncIterator = (
                                iterable as AsyncIterable<unknown>
                            )[Symbol.asyncIterator];
                            stack.push(
                                asyncIterator
                                    ? asyncIterator.call(iterable)
                                    : (iterable as Iterable<unknown>)[Symbol.iterator]()
                            );
                            break;
                        }
                        case 42: {
                            const iterator = stack.pop() as Iterator<unknown>;
                            const result = iterator.next();
                            stack.push(iterator, result);
                            break;
                        }
                        case 45: {
                            const iterator = stack.pop() as
                                | AsyncIterator<unknown>
                                | Iterator<unknown>;
                            const result = Promise.resolve(iterator.next()).then(
                                async (iteration) => ({
                                    value: await iteration.value,
                                    done: iteration.done
                                })
                            );
                            stack.push(iterator, result);
                            break;
                        }
                        case 43: {
                            const completion = stack.pop();
                            const iterator = stack.pop() as
                                | AsyncIterator<unknown>
                                | Iterator<unknown>;
                            const closeResult = iterator.return
                                ? iterator.return()
                                : undefined;
                            stack.push(
                                operands[0] === 1
                                    ? Promise.resolve(closeResult).then(() => completion)
                                    : completion
                            );
                            break;
                        }
                        case 46:
                            frame.suspended = true;

                            return [AWAIT, stack.pop(), frame.ip];
                        case 47:
                            frame.suspended = true;

                            return [YIELD, stack.pop(), frame.ip];
                        case 48:
                            frame.suspended = true;

                            return [YIELD, stack.pop(), frame.ip, true];
                        case 49: {
                            const closureCount = operands[3];
                            const computedKeyCount = operands[2];
                            const closures = stack.splice(
                                stack.length - closureCount,
                                closureCount
                            );
                            const computedKeys = stack.splice(
                                stack.length - computedKeyCount,
                                computedKeyCount
                            );
                            const superClass = operands[1] ? stack.pop() : undefined;
                            const cells: TRuntimeCapture[] = frame.locals.map(
                                (cell: IRuntimeCell): TRuntimeCapture => [
                                    (): unknown => {
                                        if (!cell.initialized) {
                                            throw new ReferenceError(
                                                'Cannot access binding before initialization'
                                            );
                                        }

                                        return cell.value;
                                    },
                                    (value: unknown): unknown => {
                                        cell.value = value;
                                        cell.initialized = true;

                                        return value;
                                    }
                                ]
                            );
                            cells.push(...frame.captures);
                            stack.push(
                                frame.ops[operands[0]](
                                    superClass,
                                    computedKeys,
                                    closures,
                                    cells
                                )
                            );
                            break;
                        }

                        case 50: {
                            const key = stack.pop();
                            stack.push(frame.ops[operands[0]](key));
                            break;
                        }
                        case 51: {
                            const value = stack.pop();
                            const key = stack.pop();
                            stack.push(frame.ops[operands[0]](key, value));
                            break;
                        }
                        case 52: {
                            const values = stack.splice(
                                stack.length - operands[1],
                                operands[1]
                            );
                            const receiver = frame.ops[operands[0]](
                                ...expand(values, operands[2])
                            );
                            frame.receiver = receiver;
                            stack.push(receiver);
                            break;
                        }
                        case 53: {
                            if (operands[0] === 2) {
                                const values = stack.splice(
                                    stack.length - operands[2],
                                    operands[2]
                                );
                                const receiver = stack.pop();
                                stack.push(
                                    frame.ops[operands[1]](
                                        receiver,
                                        ...expand(values, operands[3])
                                    )
                                );
                            } else {
                                throw new Error('Unsupported VM private operation');
                            }
                            break;
                        }
                        case 54:
                            stack.push(dynamicImport(stack.pop() as string));
                            break;
                        case 55:
                            frame.withStack.push(stack.pop() as Record<string, unknown>);
                            break;
                        case 56:
                            frame.withStack.pop();
                            break;
                        case 57: {
                            const name = constants[operands[0]] as string;
                            let found = false;
                            for (let index = frame.withStack.length - 1; index >= 0; index--) {
                                if (name in frame.withStack[index]) {
                                    stack.push(frame.withStack[index][name]);
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                if (!(name in globalThis)) {
                                    throw new ReferenceError(`${name} is not defined`);
                                }
                                stack.push(globals[name]);
                            }
                            break;
                        }
                        case 58: {
                            const name = constants[operands[0]] as string;
                            const value = stack[stack.length - 1];
                            let target: Record<string, unknown> = globals;
                            for (let index = frame.withStack.length - 1; index >= 0; index--) {
                                if (name in frame.withStack[index]) {
                                    target = frame.withStack[index];
                                    break;
                                }
                            }
                            target[name] = value;
                            break;
                        }
                        case 59:
                            stack.push(frame.ops[operands[0]](stack.pop()));
                            break;
                        case 60:
                            debugger;
                            break;
                        case 61:
                            return [NORMAL, undefined, -1];
                        case 62:
                            stack.push(frame.ops[operands[0]]());
                            break;
                        case 63: {
                            const object = stack.pop() as Record<string, unknown>;
                            const keys: string[] = [];
                            for (const key in object) {keys.push(key);}
                            stack.push(keys[Symbol.iterator]());
                            break;
                        }
                        case 64: {
                            const cell = frame.locals[operands[0]];
                            if (!cell.initialized) {
                                throw new ReferenceError(
                                    'Cannot access binding before initialization'
                                );
                            }
                            const value = binary(
                                operands[2],
                                cell.value,
                                constants[operands[1]]
                            );
                            cell.value = value;
                            stack.push(value);
                            break;
                        }

                        case 66: {
                            let getValue: () => unknown;
                            let setValue: (value: unknown) => unknown;
                            if (operands[0] === 0) {
                                const cell = frame.locals[operands[1]];
                                getValue = () => {
                                    if (!cell.initialized) {
                                        throw new ReferenceError(
                                            'Cannot access binding before initialization'
                                        );
                                    }

                                    return cell.value;
                                };
                                setValue = (value: unknown) => {
                                    cell.value = value;
                                    cell.initialized = true;

                                    return value;
                                };
                            } else if (operands[0] === 1) {
                                getValue = frame.captures[operands[1]][0];
                                setValue = frame.captures[operands[1]][1];
                            } else if (operands[0] === 2) {
                                const name = constants[operands[1]] as string;
                                getValue = () => {
                                    if (!(name in globals)) {
                                        throw new ReferenceError(`${name} is not defined`);
                                    }

                                    return globals[name];
                                };
                                setValue = (value: unknown) => {
                                    globals[name] = value;

                                    return value;
                                };
                            } else if (operands[0] === 3) {
                                const key = stack.pop() as PropertyKey;
                                const object = stack.pop() as object;
                                getValue = () =>
                                    (object as Record<PropertyKey, unknown>)[key];
                                setValue = (value: unknown) => {
                                    Reflect.set(object, key, value);

                                    return value;
                                };
                            } else {
                                throw new Error('Invalid VM update reference');
                            }

                            const previous = getValue();
                            const one = typeof previous === 'bigint' ? BigInt(1) : 1;
                            const next =
                                operands[2] === 0 || operands[2] === 2
                                    ? (previous as number) + (one as number)
                                    : (previous as number) - (one as number);
                            setValue(next);
                            stack.push(operands[2] >= 2 ? previous : next);
                            break;
                        }

                        default:
                            throw new Error(`Unknown VM opcode ${opcode}`);
                    }
                    if (registerDestinations) {
                        const values = stack.splice(
                            stack.length - registerDestinations.length,
                            registerDestinations.length
                        );
                        registerDestinations.forEach(
                            (register: number, index: number) => {
                                frame.registers[register] = values[index];
                            }
                        );
                    }
                } catch (error) {
                    const rows = frame.fn[6] as number[][];
                    const row = rows.find((entry) => address >= entry[0] && address < entry[1]);
                    if (!row) {return [THROW, error, -1];}
                    if (row[4] !== -1) {
                        frame.locals[row[4]].value = error;
                        frame.locals[row[4]].initialized = true;
                    }
                    frame.ip = row[2] !== -1 ? row[2] : row[3];
                }
            }

            return [NORMAL, undefined, -1];
        }

        function invokeSync(id: number, receiver: unknown, argsObject: IArguments, newTarget: unknown, captures: TRuntimeCapture[], ops: TRuntimeOperation[], callContextToken?: number): unknown {
            if (poisoned || !hasCallContext(callContextToken)) {return undefined;}
            const completion = step(createFrame(id, receiver, argsObject, newTarget, captures, ops), NORMAL, undefined);
            if (completion[0] === THROW) {throw completion[1];}
            if (completion[0] === YIELD || completion[0] === AWAIT) {throw new Error('Invalid VM suspension');}

            return completion[1];
        }

        async function invokeAsync(id: number, receiver: unknown, argsObject: IArguments, newTarget: unknown, captures: TRuntimeCapture[], ops: TRuntimeOperation[], callContextToken?: number): Promise<unknown> {
            const contextAccepted = hasCallContext(callContextToken);
            if (startup) {
                await startup;
            }
            if (poisoned || !contextAccepted) {return undefined;}
            const frame = createFrame(id, receiver, argsObject, newTarget, captures, ops);
            let completion = step(frame, NORMAL, undefined);
            while (completion[0] === AWAIT) {
                try {
                    completion = step(frame, NORMAL, await completion[1]);
                } catch (error) {
                    completion = step(frame, THROW, error);
                }
            }
            if (completion[0] === THROW) {throw completion[1];}

            return completion[1];
        }

        function invokeGenerator(id: number, receiver: unknown, argsObject: IArguments, newTarget: unknown, captures: TRuntimeCapture[], ops: TRuntimeOperation[], callContextToken?: number): IterableIterator<unknown> {
            const contextAccepted = hasCallContext(callContextToken);
            const frame = createFrame(id, receiver, argsObject, newTarget, captures, ops);
            let done = false;
            let delegate: Iterator<unknown> | null = null;
            const resume = (kind: number, value: unknown): IteratorResult<unknown> => {
                if (poisoned || !contextAccepted) {
                    done = true;

                    return { value: undefined, done: true };
                }
                if (done) {return { value, done: true };}

                if (delegate) {
                    const method =
                        kind === THROW
                            ? delegate.throw
                            : kind === RETURN
                              ? delegate.return
                              : delegate.next;
                    if (!method) {
                        delegate = null;
                        if (kind === THROW) {throw value;}

                        return resume(kind, value);
                    }
                    const delegatedResult = method.call(delegate, value);
                    if (!delegatedResult.done) {return delegatedResult;}
                    delegate = null;
                    kind = NORMAL;
                    value = delegatedResult.value;
                }

                const completion = step(frame, kind, value);
                if (completion[0] === THROW) {
                    done = true;
                    throw completion[1];
                }
                if (completion[0] === YIELD && completion[3] === true) {
                    delegate = (completion[1] as Iterable<unknown>)[Symbol.iterator]();

                    return resume(NORMAL, undefined);
                }
                if (completion[0] === YIELD) {
                    return { value: completion[1], done: false };
                }
                done = true;

                return { value: completion[1], done: true };
            };

            return {
                next: (value?: unknown) => resume(NORMAL, value),
                throw: (value?: unknown) => resume(THROW, value),
                return: (value?: unknown) => resume(RETURN, value),
                [Symbol.iterator]() {
                    return this;
                }
            };
        }

        function invokeAsyncGenerator(id: number, receiver: unknown, argsObject: IArguments, newTarget: unknown, captures: TRuntimeCapture[], ops: TRuntimeOperation[], callContextToken?: number): AsyncIterableIterator<unknown> {
            const contextAccepted = hasCallContext(callContextToken);
            const frame = createFrame(id, receiver, argsObject, newTarget, captures, ops);
            let done = false;
            let queue: Promise<unknown> = Promise.resolve();
            const resume = async (
                kind: number,
                value: unknown
            ): Promise<IteratorResult<unknown>> => {
                if (startup) {
                    await startup;
                }
                if (poisoned || !contextAccepted) {
                    done = true;

                    return { value: undefined, done: true };
                }
                if (done) {return { value, done: true };}

                let completion = step(frame, kind, value);
                while (completion[0] === AWAIT) {
                    try {
                        completion = step(frame, NORMAL, await completion[1]);
                    } catch (error) {
                        completion = step(frame, THROW, error);
                    }
                }
                if (completion[0] === THROW) {
                    done = true;
                    throw completion[1];
                }
                if (completion[0] === YIELD) {
                    return { value: completion[1], done: false };
                }
                done = true;

                return { value: completion[1], done: true };
            };
            const enqueue = async (kind: number, value: unknown): Promise<IteratorResult<unknown>> => {
                const result = queue.then(async () => resume(kind, value));
                queue = result.then(
                    () => undefined,
                    () => undefined
                );

                return result;
            };

            return {
                next: async (value?: unknown) => enqueue(NORMAL, value),
                throw: async (value?: unknown) => enqueue(THROW, value),
                return: async (value?: unknown) => enqueue(RETURN, value),
                [Symbol.asyncIterator]() {
                    return this;
                }
            };
        }

        const contextStack: unknown[] = [];
        function getCallContextToken(functionId: number): number {
            let hash = 2_166_136_261;
            const value = String(functionId);
            for (let index = 0; index < value.length; index++) {
                hash ^= value.charCodeAt(index);
                hash = Math.imul(hash, 16_777_619);
            }

            return hash >>> 0;
        }

        function hasCallContext(expected?: number): boolean {
            return (
                expected === undefined ||
                contextStack[contextStack.length - 1] === expected
            );
        }

        function callWithContext(token: unknown, callee: (...args: unknown[]) => unknown, receiver: unknown, args: unknown[]): unknown {
            contextStack.push(token);
            try {
                return Reflect.apply(callee, receiver, args);
            } finally {
                contextStack.pop();
            }
        }

        return {
            invokeSync,
            invokeAsync,
            invokeGenerator,
            invokeAsyncGenerator,
            callWithContext,
            UNINITIALIZED_THIS
        };
    }
}
