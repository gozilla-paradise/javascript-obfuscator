export interface IVMRuntimeCrypto {
    readonly utf8Bytes: (value: string) => Uint8Array;
    readonly concatenateBytes: (...parts: readonly Uint8Array[]) => Uint8Array;
    readonly sha256: (input: Uint8Array) => Uint8Array;
    readonly hmacSha256: (key: Uint8Array, message: Uint8Array) => Uint8Array;
    readonly chacha20Xor: (
        input: Uint8Array,
        key: Uint8Array,
        nonce: Uint8Array,
        counter: number
    ) => Uint8Array;
    readonly constantTimeEqual: (left: Uint8Array, right: Uint8Array) => boolean;
    readonly bytesToBase64: (bytes: Uint8Array) => string;
    readonly base64ToBytes: (value: string) => Uint8Array;
}

/**
 * This function is stringified into generated output. Keep every dependency inside its body.
 */
export function createVMRuntimeCrypto(): IVMRuntimeCrypto {
    const initialState = [
        0x6a_09_e6_67,
        0xbb_67_ae_85,
        0x3c_6e_f3_72,
        0xa5_4f_f5_3a,
        0x51_0e_52_7f,
        0x9b_05_68_8c,
        0x1f_83_d9_ab,
        0x5b_e0_cd_19
    ];
    const roundConstants = [
        0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b, 0x59_f1_11_f1, 0x92_3f_82_a4, 0xab_1c_5e_d5,
        0xd8_07_aa_98, 0x12_83_5b_01, 0x24_31_85_be, 0x55_0c_7d_c3, 0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7, 0xc1_9b_f1_74,
        0xe4_9b_69_c1, 0xef_be_47_86, 0x0f_c1_9d_c6, 0x24_0c_a1_cc, 0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da,
        0x98_3e_51_52, 0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47, 0x06_ca_63_51, 0x14_29_29_67,
        0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc, 0x53_38_0d_13, 0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85,
        0xa2_bf_e8_a1, 0xa8_1a_66_4b, 0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19, 0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70,
        0x19_a4_c1_16, 0x1e_37_6c_08, 0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a, 0x5b_9c_ca_4f, 0x68_2e_6f_f3,
        0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08, 0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2
    ];
    const rotateRight = (value: number, count: number): number =>
        (value >>> count) | (value << (32 - count));
    const readUint32 = (bytes: Uint8Array, offset: number): number =>
        (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 3] << 24)) >>>
        0;
    const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
        bytes[offset] = value;
        bytes[offset + 1] = value >>> 8;
        bytes[offset + 2] = value >>> 16;
        bytes[offset + 3] = value >>> 24;
    };
    const concatenateBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
        const length = parts.reduce((total, part) => total + part.length, 0);
        const output = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
            output.set(part, offset);
            offset += part.length;
        }

        return output;
    };
    const utf8Bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
    const sha256 = (input: Uint8Array): Uint8Array => {
        const bitLength = BigInt(input.length) * BigInt(8);
        const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
        const padded = new Uint8Array(paddedLength);
        padded.set(input);
        padded[input.length] = 0x80;
        for (let index = 0; index < 8; index++) {
            padded[paddedLength - 1 - index] = Number(
                (bitLength >> BigInt(index * 8)) & BigInt(0xff)
            );
        }
        const state = [...initialState];
        const words = new Uint32Array(64);
        for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
            for (let index = 0; index < 16; index++) {
                const offset = blockOffset + index * 4;
                words[index] =
                    ((padded[offset] << 24) |
                        (padded[offset + 1] << 16) |
                        (padded[offset + 2] << 8) |
                        padded[offset + 3]) >>>
                    0;
            }
            for (let index = 16; index < 64; index++) {
                const first = words[index - 15];
                const second = words[index - 2];
                const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
                const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
                words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
            }
            let a = state[0];
            let b = state[1];
            let c = state[2];
            let d = state[3];
            let e = state[4];
            let f = state[5];
            let g = state[6];
            let h = state[7];
            for (let index = 0; index < 64; index++) {
                const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
                const choice = (e & f) ^ (~e & g);
                const temporary1 =
                    (h + sum1 + choice + roundConstants[index] + words[index]) >>> 0;
                const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
                const majority = (a & b) ^ (a & c) ^ (b & c);
                const temporary2 = (sum0 + majority) >>> 0;
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
        const digest = new Uint8Array(32);
        state.forEach((value, index) => {
            const offset = index * 4;
            digest[offset] = value >>> 24;
            digest[offset + 1] = value >>> 16;
            digest[offset + 2] = value >>> 8;
            digest[offset + 3] = value;
        });

        return digest;
    };
    const hmacSha256 = (key: Uint8Array, message: Uint8Array): Uint8Array => {
        const normalizedKey = key.length > 64 ? sha256(key) : key;
        const innerPad = new Uint8Array(64);
        const outerPad = new Uint8Array(64);
        for (let index = 0; index < 64; index++) {
            const keyByte = index < normalizedKey.length ? normalizedKey[index] : 0;
            innerPad[index] = keyByte ^ 0x36;
            outerPad[index] = keyByte ^ 0x5c;
        }

        return sha256(concatenateBytes(outerPad, sha256(concatenateBytes(innerPad, message))));
    };
    const quarterRound = (state: Uint32Array, a: number, b: number, c: number, d: number): void => {
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
    };
    const chacha20Xor = (
        input: Uint8Array,
        key: Uint8Array,
        nonce: Uint8Array,
        initialCounter: number
    ): Uint8Array => {
        const output = new Uint8Array(input.length);
        let counter = initialCounter >>> 0;
        for (let blockOffset = 0; blockOffset < input.length; blockOffset += 64) {
            const state = new Uint32Array(16);
            state[0] = 0x61_70_78_65;
            state[1] = 0x33_20_64_6e;
            state[2] = 0x79_62_2d_32;
            state[3] = 0x6b_20_65_74;
            for (let index = 0; index < 8; index++) {state[4 + index] = readUint32(key, index * 4);}
            state[12] = counter;
            state[13] = readUint32(nonce, 0);
            state[14] = readUint32(nonce, 4);
            state[15] = readUint32(nonce, 8);
            const working = new Uint32Array(state);
            for (let round = 0; round < 10; round++) {
                quarterRound(working, 0, 4, 8, 12);
                quarterRound(working, 1, 5, 9, 13);
                quarterRound(working, 2, 6, 10, 14);
                quarterRound(working, 3, 7, 11, 15);
                quarterRound(working, 0, 5, 10, 15);
                quarterRound(working, 1, 6, 11, 12);
                quarterRound(working, 2, 7, 8, 13);
                quarterRound(working, 3, 4, 9, 14);
            }
            const stream = new Uint8Array(64);
            for (let index = 0; index < 16; index++) {
                writeUint32(stream, index * 4, (working[index] + state[index]) >>> 0);
            }
            const length = Math.min(64, input.length - blockOffset);
            for (let index = 0; index < length; index++) {
                output[blockOffset + index] = input[blockOffset + index] ^ stream[index];
            }
            counter = (counter + 1) >>> 0;
        }

        return output;
    };
    const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
        let difference = left.length ^ right.length;
        const length = Math.max(left.length, right.length);
        for (let index = 0; index < length; index++) {
            difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
        }

        return difference === 0;
    };
    const bytesToBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        for (const byte of bytes) {binary += String.fromCharCode(byte);}

        return btoa(binary);
    };
    const base64ToBytes = (value: string): Uint8Array =>
        Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

    return {
        utf8Bytes,
        concatenateBytes,
        sha256,
        hmacSha256,
        chacha20Xor,
        constantTimeEqual,
        bytesToBase64,
        base64ToBytes
    };
}
