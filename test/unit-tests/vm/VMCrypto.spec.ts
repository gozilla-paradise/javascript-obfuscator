import { assert } from 'chai';

import {
    chacha20Xor,
    deriveVMProgramId,
    hmacSha256,
    sha256,
    utf8Bytes
} from '../../../src/vm/VMCrypto';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (value: number) =>
        value.toString(16).padStart(2, '0')
    ).join('');
}

describe('VMCrypto', () => {
    it('should match SHA-256 and HMAC-SHA256 vectors', () => {
        assert.equal(
            toHex(sha256(utf8Bytes('abc'))),
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
        assert.equal(
            toHex(
                hmacSha256(
                    utf8Bytes('key'),
                    utf8Bytes('The quick brown fox jumps over the lazy dog')
                )
            ),
            'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
        );
    });

    it('should match the RFC 8439 ChaCha20 block vector', () => {
        const key: Uint8Array = Uint8Array.from(
            Array.from({ length: 32 }, (_, index: number) => index)
        );
        const nonce: Uint8Array = Uint8Array.from([
            0, 0, 0, 9, 0, 0, 0, 74, 0, 0, 0, 0
        ]);

        assert.equal(
            toHex(chacha20Xor(new Uint8Array(64), key, nonce, 1)),
            '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4' +
                'ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e'
        );
    });

    it('should bind program identifiers to seed and canonical payload', () => {
        const payload: Uint8Array = Uint8Array.from([0x4a, 0x4f, 0x56, 0x4d]);

        assert.equal(toHex(deriveVMProgramId(7, payload)).length, 32);
        assert.notEqual(
            toHex(deriveVMProgramId(7, payload)),
            toHex(deriveVMProgramId(8, payload))
        );
        assert.notEqual(
            toHex(deriveVMProgramId(7, payload)),
            toHex(deriveVMProgramId(7, Uint8Array.from([...payload, 1])))
        );
    });
});
