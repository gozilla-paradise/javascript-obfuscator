import { assert } from 'chai';

import { VMBytecodeFormat } from '../../../src/enums/vm/VMBytecodeFormat';
import type { IVMProgram } from '../../../src/interfaces/vm/IVMProgram';
import { VMConstantTag } from '../../../src/interfaces/vm/IVMProgram';
import type { IVMSerializedProgram } from '../../../src/interfaces/vm/IVMSerializer';
import { VMSerializer } from '../../../src/vm/VMSerializer';

const baselineProgram: IVMProgram = {
    version: 1,
    flags: 0,
    constants: [[VMConstantTag.Number, 1]],
    functions: [
        {
            id: 0,
            flags: 0,
            arity: 0,
            localCount: 0,
            captureCount: 0,
            instructions: [
                { address: 0, nextAddress: 1, opcode: 1, operands: [0] },
                { address: 1, nextAddress: -1, opcode: 2, operands: [] }
            ],
            exceptionTable: []
        }
    ]
};

const extendedProgram: IVMProgram = {
    version: 1,
    flags: 0,
    constants: [
        [VMConstantTag.Undefined],
        [VMConstantTag.Null],
        [VMConstantTag.False],
        [VMConstantTag.True],
        [VMConstantTag.Number, -0],
        [VMConstantTag.BigInt, BigInt(-258)],
        [VMConstantTag.String, 'Aπ'],
        [VMConstantTag.RegExp, 'a+', 'gi'],
        [VMConstantTag.ArrayHole],
        [VMConstantTag.SignedIntArray, [-2, 0, 3]]
    ],
    functions: [
        {
            id: 7,
            flags: 11,
            arity: 2,
            localCount: 3,
            captureCount: 1,
            instructions: [
                { address: 10, nextAddress: 20, opcode: 40, operands: [3, 1, 0, 2] },
                { address: 20, nextAddress: 30, opcode: 36, operands: [2, 9] },
                { address: 30, nextAddress: -1, opcode: 2, operands: [] }
            ],
            exceptionTable: [
                {
                    startAddress: 10,
                    endAddress: 30,
                    catchAddress: 20,
                    finallyAddress: 30,
                    catchSlot: 2
                }
            ]
        }
    ]
};

describe('VMSerializer', () => {
    const serializer: VMSerializer = new VMSerializer();

    it('should emit the normative baseline JSON and binary vectors', () => {
        const json = serializer.serialize(baselineProgram, VMBytecodeFormat.Json);
        const binary = serializer.serialize(baselineProgram, VMBytecodeFormat.Binary);

        assert.equal(
            json.json,
            '[1,0,[[4,"3ff0000000000000"]],[[0,0,0,0,0,[[0,1,1,0],[1,-1,2]],[]]]]'
        );
        assert.equal(
            Buffer.from(binary.bytes!).toString('hex'),
            '4a4f564d01000000000104000000000000f03f010000000000000200000201010001000200'
        );
    });

    it('should emit the extended constants, operands, capture, spread, and exception vectors', () => {
        const json = serializer.serialize(extendedProgram, VMBytecodeFormat.Json);
        const binary = serializer.serialize(extendedProgram, VMBytecodeFormat.Binary);

        assert.equal(
            json.json,
            '[1,0,[[0],[1],[2],[3],[4,"8000000000000000"],[5,"-258"],[6,"Aπ"],[7,"a+","gi"],[8],[9,[-2,0,3]]],[[7,11,2,3,1,[[10,20,40,3,1,0,2],[20,30,36,2,9],[30,-1,2]],[[10,30,20,30,2]]]]]'
        );
        assert.equal(
            Buffer.from(binary.bytes!).toString('hex'),
            '4a4f564d01000000000a000102030400000000000000800501020102060341cf800702612b02676908090303000601070b0002030103010a15280406020004141f240204121e000200143c283c04'
        );
    });

    it('should round-trip both formats without losing numeric edge cases', () => {
        const numericProgram: IVMProgram = {
            ...extendedProgram,
            constants: [
                ...extendedProgram.constants,
                [VMConstantTag.Number, Number.NaN],
                [VMConstantTag.Number, Number.POSITIVE_INFINITY],
                [VMConstantTag.Number, Number.NEGATIVE_INFINITY]
            ]
        };

        for (const format of [VMBytecodeFormat.Binary, VMBytecodeFormat.Json]) {
            const result = serializer.deserialize(serializer.serialize(numericProgram, format));

            assert.isTrue(Object.is(result.constants[4][1], -0));
            assert.isNaN(result.constants[10][1] as number);
            assert.equal(result.constants[11][1], Number.POSITIVE_INFINITY);
            assert.equal(result.constants[12][1], Number.NEGATIVE_INFINITY);
        }
    });

    it('should reject malformed tags, varints, and logical addresses', () => {
        const malformedTag: IVMSerializedProgram = {
            format: VMBytecodeFormat.Binary,
            program: baselineProgram,
            bytes: Uint8Array.from([
                0x4a,
                0x4f,
                0x56,
                0x4d,
                1,
                0,
                0,
                0,
                0,
                1,
                255
            ]),
            json: null
        };
        const malformedVarint: IVMSerializedProgram = {
            ...malformedTag,
            bytes: Uint8Array.from([
                0x4a,
                0x4f,
                0x56,
                0x4d,
                1,
                0,
                0,
                0,
                0,
                0x80,
                0
            ])
        };
        const invalidAddress: IVMProgram = {
            ...baselineProgram,
            functions: [
                {
                    ...baselineProgram.functions[0],
                    instructions: [
                        { address: 0, nextAddress: 99, opcode: 2, operands: [] }
                    ]
                }
            ]
        };

        assert.throws(() => serializer.deserialize(malformedTag), /unknown constant tag/);
        assert.throws(() => serializer.deserialize(malformedVarint), /non-canonical varint/);
        assert.throws(
            () => serializer.serialize(invalidAddress, VMBytecodeFormat.Binary),
            /next address 99/
        );
    });
});
