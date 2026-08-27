const SHA256_INITIAL_STATE: readonly number[] = [
    0x6a_09_e6_67,
    0xbb_67_ae_85,
    0x3c_6e_f3_72,
    0xa5_4f_f5_3a,
    0x51_0e_52_7f,
    0x9b_05_68_8c,
    0x1f_83_d9_ab,
    0x5b_e0_cd_19
];

const SHA256_ROUND_CONSTANTS: readonly number[] = [
    0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b, 0x59_f1_11_f1, 0x92_3f_82_a4, 0xab_1c_5e_d5,
    0xd8_07_aa_98, 0x12_83_5b_01, 0x24_31_85_be, 0x55_0c_7d_c3, 0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7, 0xc1_9b_f1_74,
    0xe4_9b_69_c1, 0xef_be_47_86, 0x0f_c1_9d_c6, 0x24_0c_a1_cc, 0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da,
    0x98_3e_51_52, 0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47, 0x06_ca_63_51, 0x14_29_29_67,
    0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc, 0x53_38_0d_13, 0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85,
    0xa2_bf_e8_a1, 0xa8_1a_66_4b, 0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19, 0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70,
    0x19_a4_c1_16, 0x1e_37_6c_08, 0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a, 0x5b_9c_ca_4f, 0x68_2e_6f_f3,
    0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08, 0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2
];

function rotateRight(value: number, count: number): number {
    return (value >>> count) | (value << (32 - count));
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    ) >>> 0;
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value;
    bytes[offset + 1] = value >>> 8;
    bytes[offset + 2] = value >>> 16;
    bytes[offset + 3] = value >>> 24;
}

export function concatenateBytes(...parts: readonly Uint8Array[]): Uint8Array {
    const length: number = parts.reduce((total: number, part: Uint8Array) => total + part.length, 0);
    const result: Uint8Array = new Uint8Array(length);
    let offset: number = 0;

    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }

    return result;
}

export function utf8Bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

export function sha256(input: Uint8Array): Uint8Array {
    const bitLength: bigint = BigInt(input.length) * BigInt(8);
    const paddedLength: number = Math.ceil((input.length + 9) / 64) * 64;
    const padded: Uint8Array = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;

    for (let index: number = 0; index < 8; index++) {
        padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & BigInt(0xff));
    }

    const state: number[] = [...SHA256_INITIAL_STATE];
    const words: Uint32Array = new Uint32Array(64);

    for (let blockOffset: number = 0; blockOffset < padded.length; blockOffset += 64) {
        for (let index: number = 0; index < 16; index++) {
            const offset: number = blockOffset + index * 4;
            words[index] =
                ((padded[offset] << 24) |
                    (padded[offset + 1] << 16) |
                    (padded[offset + 2] << 8) |
                    padded[offset + 3]) >>>
                0;
        }
        for (let index: number = 16; index < 64; index++) {
            const first: number = words[index - 15];
            const second: number = words[index - 2];
            const sigma0: number = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
            const sigma1: number = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }

        let a: number = state[0];
        let b: number = state[1];
        let c: number = state[2];
        let d: number = state[3];
        let e: number = state[4];
        let f: number = state[5];
        let g: number = state[6];
        let h: number = state[7];

        for (let index: number = 0; index < 64; index++) {
            const sum1: number = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice: number = (e & f) ^ (~e & g);
            const temporary1: number = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
            const sum0: number = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority: number = (a & b) ^ (a & c) ^ (b & c);
            const temporary2: number = (sum0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }

        state[0] = (state[0] + a) >>> 0;
        state[1] = (state[1] + b) >>> 0;
        state[2] = (state[2] + c) >>> 0;
        state[3] = (state[3] + d) >>> 0;
        state[4] = (state[4] + e) >>> 0;
        state[5] = (state[5] + f) >>> 0;
        state[6] = (state[6] + g) >>> 0;
        state[7] = (state[7] + h) >>> 0;
    }

    const digest: Uint8Array = new Uint8Array(32);
    state.forEach((value: number, index: number) => {
        const offset: number = index * 4;
        digest[offset] = value >>> 24;
        digest[offset + 1] = value >>> 16;
        digest[offset + 2] = value >>> 8;
        digest[offset + 3] = value;
    });

    return digest;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    const blockSize: number = 64;
    const normalizedKey: Uint8Array = key.length > blockSize ? sha256(key) : key;
    const innerPad: Uint8Array = new Uint8Array(blockSize);
    const outerPad: Uint8Array = new Uint8Array(blockSize);

    for (let index: number = 0; index < blockSize; index++) {
        const keyByte: number = index < normalizedKey.length ? normalizedKey[index] : 0;
        innerPad[index] = keyByte ^ 0x36;
        outerPad[index] = keyByte ^ 0x5c;
    }

    return sha256(concatenateBytes(outerPad, sha256(concatenateBytes(innerPad, message))));
}

function chachaQuarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
    state[a] = (state[a] + state[b]) >>> 0;
    state[d] ^= state[a];
    state[d] = (state[d] << 16) | (state[d] >>> 16);
    state[c] = (state[c] + state[d]) >>> 0;
    state[b] ^= state[c];
    state[b] = (state[b] << 12) | (state[b] >>> 20);
    state[a] = (state[a] + state[b]) >>> 0;
    state[d] ^= state[a];
    state[d] = (state[d] << 8) | (state[d] >>> 24);
    state[c] = (state[c] + state[d]) >>> 0;
    state[b] ^= state[c];
    state[b] = (state[b] << 7) | (state[b] >>> 25);
}

export function chacha20Xor(
    input: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
    initialCounter: number
): Uint8Array {
    if (key.length !== 32 || nonce.length !== 12) {
        throw new RangeError('ChaCha20 requires a 32-byte key and 12-byte nonce');
    }

    const output: Uint8Array = new Uint8Array(input.length);
    let counter: number = initialCounter >>> 0;

    for (let blockOffset: number = 0; blockOffset < input.length; blockOffset += 64) {
        const state: Uint32Array = new Uint32Array(16);
        state[0] = 0x61_70_78_65;
        state[1] = 0x33_20_64_6e;
        state[2] = 0x79_62_2d_32;
        state[3] = 0x6b_20_65_74;
        for (let index: number = 0; index < 8; index++) {
            state[4 + index] = readUint32LittleEndian(key, index * 4);
        }
        state[12] = counter;
        state[13] = readUint32LittleEndian(nonce, 0);
        state[14] = readUint32LittleEndian(nonce, 4);
        state[15] = readUint32LittleEndian(nonce, 8);

        const working: Uint32Array = new Uint32Array(state);
        for (let round: number = 0; round < 10; round++) {
            chachaQuarterRound(working, 0, 4, 8, 12);
            chachaQuarterRound(working, 1, 5, 9, 13);
            chachaQuarterRound(working, 2, 6, 10, 14);
            chachaQuarterRound(working, 3, 7, 11, 15);
            chachaQuarterRound(working, 0, 5, 10, 15);
            chachaQuarterRound(working, 1, 6, 11, 12);
            chachaQuarterRound(working, 2, 7, 8, 13);
            chachaQuarterRound(working, 3, 4, 9, 14);
        }

        const stream: Uint8Array = new Uint8Array(64);
        for (let index: number = 0; index < 16; index++) {
            writeUint32LittleEndian(stream, index * 4, (working[index] + state[index]) >>> 0);
        }

        const blockLength: number = Math.min(64, input.length - blockOffset);
        for (let index: number = 0; index < blockLength; index++) {
            output[blockOffset + index] = input[blockOffset + index] ^ stream[index];
        }
        counter = (counter + 1) >>> 0;
    }

    return output;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
    let difference: number = left.length ^ right.length;
    const length: number = Math.max(left.length, right.length);

    for (let index: number = 0; index < length; index++) {
        difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
    }

    return difference === 0;
}

export interface IVMKeyMaterial {
    readonly prk: Uint8Array;
    readonly encryptionKey: Uint8Array;
    readonly macKey: Uint8Array;
}

export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (value: number) => value.toString(16).padStart(2, '0')).join('');
}

export function deriveDefaultVMKey(seed: string | number): string {
    return bytesToHex(sha256(utf8Bytes(`javascript-obfuscator-vm-default\0${String(seed)}`)));
}

export function deriveVMKeyMaterial(key: string, seed: string | number): IVMKeyMaterial {
    const prk: Uint8Array = hmacSha256(
        utf8Bytes(key),
        utf8Bytes(`javascript-obfuscator-vm-v1\0${String(seed)}`)
    );

    return {
        prk,
        encryptionKey: hmacSha256(prk, utf8Bytes('enc')),
        macKey: hmacSha256(prk, utf8Bytes('mac'))
    };
}

export function deriveVMProgramId(seed: string | number, canonicalPayload: Uint8Array): Uint8Array {
    return sha256(
        concatenateBytes(utf8Bytes(String(seed)), Uint8Array.of(0), canonicalPayload)
    ).slice(0, 16);
}

export function deriveVMInstructionMaterial(
    prk: Uint8Array,
    functionId: number,
    logicalAddress: number
): { readonly key: Uint8Array; readonly nonce: Uint8Array } {
    const key: Uint8Array = hmacSha256(prk, utf8Bytes(`instruction:${functionId}`));

    return {
        key,
        nonce: hmacSha256(key, utf8Bytes(`address:${logicalAddress}`)).slice(0, 12)
    };
}

export function chacha20Words(
    key: Uint8Array,
    nonce: Uint8Array,
    counter: number,
    count: number
): Uint32Array {
    const stream: Uint8Array = chacha20Xor(new Uint8Array(count * 4), key, nonce, counter);
    const words: Uint32Array = new Uint32Array(count);

    for (let index: number = 0; index < count; index++) {
        words[index] = readUint32LittleEndian(stream, index * 4);
    }

    return words;
}
