/* eslint-disable */
import { injectable } from 'inversify';

import { TTypeFromEnum } from '../types/utils/TTypeFromEnum';

import { VMBytecodeFormat } from '../enums/vm/VMBytecodeFormat';

import {
    IVMExceptionRow,
    IVMFunction,
    IVMInstruction,
    IVMProgram,
    TVMConstant,
    VMConstantTag
} from '../interfaces/vm/IVMProgram';
import { IVMSerializedProgram, IVMSerializer } from '../interfaces/vm/IVMSerializer';

class VMBinaryWriter {
    private readonly bytes: number[] = [];

    public writeByte(value: number): void {
        this.bytes.push(value & 0xff);
    }

    public writeBytes(values: Uint8Array): void {
        for (const value of values) {
            this.bytes.push(value);
        }
    }

    public writeUint16(value: number): void {
        this.writeByte(value);
        this.writeByte(value >>> 8);
    }

    public writeUint32(value: number): void {
        this.writeByte(value);
        this.writeByte(value >>> 8);
        this.writeByte(value >>> 16);
        this.writeByte(value >>> 24);
    }

    public writeUnsignedVarint(value: number | bigint): void {
        let remainder: bigint = typeof value === 'bigint' ? value : BigInt(value);

        if (remainder < BigInt(0)) {
            throw new RangeError('Unsigned VM varint cannot be negative');
        }

        do {
            const byte: number = Number(remainder & BigInt(0x7f));
            remainder >>= BigInt(7);
            this.writeByte(remainder === BigInt(0) ? byte : byte | 0x80);
        } while (remainder !== BigInt(0));
    }

    public writeSignedVarint(value: number): void {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError('Signed VM varint must be a safe integer');
        }

        const encoded: bigint =
            value >= 0 ? BigInt(value) * BigInt(2) : BigInt(-value) * BigInt(2) - BigInt(1);

        this.writeUnsignedVarint(encoded);
    }

    public writeNumber(value: number): void {
        const bytes: Uint8Array = new Uint8Array(8);
        new DataView(bytes.buffer).setFloat64(0, value, true);
        this.writeBytes(bytes);
    }

    public writeString(value: string): void {
        const bytes: Uint8Array = new TextEncoder().encode(value);
        this.writeUnsignedVarint(bytes.length);
        this.writeBytes(bytes);
    }

    public toUint8Array(): Uint8Array {
        return Uint8Array.from(this.bytes);
    }
}

class VMBinaryReader {
    private offset: number = 0;

    public constructor(private readonly bytes: Uint8Array) {}

    public get remaining(): number {
        return this.bytes.length - this.offset;
    }

    public readByte(): number {
        if (this.offset >= this.bytes.length) {
            throw new Error('Invalid VM bytecode: truncated input');
        }

        return this.bytes[this.offset++];
    }

    public readBytes(length: number): Uint8Array {
        if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
            throw new Error('Invalid VM bytecode: truncated input');
        }

        const value: Uint8Array = this.bytes.slice(this.offset, this.offset + length);
        this.offset += length;

        return value;
    }

    public readUint16(): number {
        return this.readByte() | (this.readByte() << 8);
    }

    public readUint32(): number {
        return (
            this.readByte() |
            (this.readByte() << 8) |
            (this.readByte() << 16) |
            (this.readByte() << 24)
        ) >>> 0;
    }

    public readUnsignedVarint(): number {
        let value: bigint = BigInt(0);
        let shift: bigint = BigInt(0);

        for (let index: number = 0; index < 10; index++) {
            const byte: number = this.readByte();
            value |= BigInt(byte & 0x7f) << shift;

            if ((byte & 0x80) === 0) {
                if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
                    throw new Error('Invalid VM bytecode: varint exceeds safe integer range');
                }

                if (index > 0 && byte === 0) {
                    throw new Error('Invalid VM bytecode: non-canonical varint');
                }

                return Number(value);
            }

            shift += BigInt(7);
        }

        throw new Error('Invalid VM bytecode: malformed varint');
    }

    public readSignedVarint(): number {
        const encoded: number = this.readUnsignedVarint();
        const magnitude: number = Math.floor(encoded / 2);

        return encoded % 2 === 0 ? magnitude : -magnitude - 1;
    }

    public readNumber(): number {
        const bytes: Uint8Array = this.readBytes(8);

        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    }

    public readString(): string {
        return new TextDecoder('utf-8', { fatal: true }).decode(
            this.readBytes(this.readUnsignedVarint())
        );
    }
}

@injectable()
export class VMSerializer implements IVMSerializer {
    private static readonly magic: readonly number[] = [0x4a, 0x4f, 0x56, 0x4d];

    public serialize(
        program: IVMProgram,
        format: TTypeFromEnum<typeof VMBytecodeFormat>
    ): IVMSerializedProgram {
        VMSerializer.validateProgram(program);

        switch (format) {
            case VMBytecodeFormat.Binary:
                return {
                    format,
                    program,
                    bytes: VMSerializer.serializeBinary(program),
                    json: null
                };

            case VMBytecodeFormat.Json:
                return {
                    format,
                    program,
                    bytes: null,
                    json: JSON.stringify(VMSerializer.toJsonValue(program))
                };

            default:
                throw new ReferenceError(`Unsupported VM bytecode format: ${String(format)}`);
        }
    }

    public deserialize(program: IVMSerializedProgram): IVMProgram {
        const deserialized: IVMProgram =
            program.format === VMBytecodeFormat.Binary
                ? VMSerializer.deserializeBinary(program.bytes)
                : VMSerializer.deserializeJson(program.json);

        VMSerializer.validateProgram(deserialized);

        return deserialized;
    }

    private static serializeBinary(program: IVMProgram): Uint8Array {
        const writer: VMBinaryWriter = new VMBinaryWriter();

        for (const byte of VMSerializer.magic) {
            writer.writeByte(byte);
        }

        writer.writeByte(program.version);
        writer.writeUint32(program.flags);
        writer.writeUnsignedVarint(program.constants.length);

        for (const constant of program.constants) {
            VMSerializer.writeConstant(writer, constant);
        }

        writer.writeUnsignedVarint(program.functions.length);

        for (const vmFunction of program.functions) {
            VMSerializer.writeFunction(writer, vmFunction);
        }

        return writer.toUint8Array();
    }

    private static writeConstant(writer: VMBinaryWriter, constant: TVMConstant): void {
        writer.writeByte(constant[0]);

        switch (constant[0]) {
            case VMConstantTag.Undefined:
            case VMConstantTag.Null:
            case VMConstantTag.False:
            case VMConstantTag.True:
            case VMConstantTag.ArrayHole:
                return;

            case VMConstantTag.Number:
                writer.writeNumber(constant[1]);

                return;

            case VMConstantTag.BigInt: {
                const negative: boolean = constant[1] < BigInt(0);
                let magnitude: bigint = negative ? -constant[1] : constant[1];
                const bytes: number[] = [];

                while (magnitude > BigInt(0)) {
                    bytes.push(Number(magnitude & BigInt(0xff)));
                    magnitude >>= BigInt(8);
                }

                bytes.reverse();
                writer.writeByte(negative ? 1 : 0);
                writer.writeUnsignedVarint(bytes.length);
                writer.writeBytes(Uint8Array.from(bytes));

                return;
            }

            case VMConstantTag.String:
                writer.writeString(constant[1]);

                return;

            case VMConstantTag.RegExp:
                writer.writeString(constant[1]);
                writer.writeString(constant[2]);

                return;

            case VMConstantTag.SignedIntArray:
                writer.writeUnsignedVarint(constant[1].length);
                constant[1].forEach((value: number) => writer.writeSignedVarint(value));

                return;
        }
    }

    private static writeFunction(writer: VMBinaryWriter, vmFunction: IVMFunction): void {
        writer.writeUnsignedVarint(vmFunction.id);
        writer.writeUint16(vmFunction.flags);
        writer.writeUnsignedVarint(vmFunction.arity);
        writer.writeUnsignedVarint(vmFunction.localCount);
        writer.writeUnsignedVarint(vmFunction.captureCount);
        writer.writeUnsignedVarint(vmFunction.instructions.length);
        writer.writeUnsignedVarint(vmFunction.exceptionTable.length);

        for (const instruction of vmFunction.instructions) {
            writer.writeUnsignedVarint(instruction.address);
            writer.writeUnsignedVarint(instruction.nextAddress + 1);
            writer.writeUnsignedVarint(instruction.opcode);
            writer.writeUnsignedVarint(instruction.operands.length);
            instruction.operands.forEach((operand: number) => writer.writeSignedVarint(operand));
        }

        for (const row of vmFunction.exceptionTable) {
            writer.writeSignedVarint(row.startAddress);
            writer.writeSignedVarint(row.endAddress);
            writer.writeSignedVarint(row.catchAddress);
            writer.writeSignedVarint(row.finallyAddress);
            writer.writeSignedVarint(row.catchSlot);
        }
    }

    private static deserializeBinary(bytes: Uint8Array): IVMProgram {
        const reader: VMBinaryReader = new VMBinaryReader(bytes);

        for (const expected of VMSerializer.magic) {
            if (reader.readByte() !== expected) {
                throw new Error('Invalid VM bytecode: invalid magic');
            }
        }

        const version: number = reader.readByte();

        if (version !== 1) {
            throw new Error(`Invalid VM bytecode: unsupported version ${version}`);
        }

        const flags: number = reader.readUint32();
        const constants: TVMConstant[] = [];
        const constantCount: number = reader.readUnsignedVarint();

        for (let index: number = 0; index < constantCount; index++) {
            constants.push(VMSerializer.readConstant(reader));
        }

        const functions: IVMFunction[] = [];
        const functionCount: number = reader.readUnsignedVarint();

        for (let index: number = 0; index < functionCount; index++) {
            functions.push(VMSerializer.readFunction(reader));
        }

        if (reader.remaining !== 0) {
            throw new Error('Invalid VM bytecode: trailing data');
        }

        return {
            version: 1,
            flags,
            constants,
            functions
        };
    }

    private static readConstant(reader: VMBinaryReader): TVMConstant {
        const tag: number = reader.readByte();

        switch (tag) {
            case VMConstantTag.Undefined:
            case VMConstantTag.Null:
            case VMConstantTag.False:
            case VMConstantTag.True:
            case VMConstantTag.ArrayHole:
                return [tag];

            case VMConstantTag.Number:
                return [tag, reader.readNumber()];

            case VMConstantTag.BigInt: {
                const sign: number = reader.readByte();

                if (sign !== 0 && sign !== 1) {
                    throw new Error('Invalid VM bytecode: invalid bigint sign');
                }

                const bytes: Uint8Array = reader.readBytes(reader.readUnsignedVarint());

                if (bytes.length > 0 && bytes[0] === 0) {
                    throw new Error('Invalid VM bytecode: non-canonical bigint magnitude');
                }

                let magnitude: bigint = BigInt(0);

                for (const byte of bytes) {
                    magnitude = (magnitude << BigInt(8)) | BigInt(byte);
                }

                return [tag, sign === 1 ? -magnitude : magnitude];
            }

            case VMConstantTag.String:
                return [tag, reader.readString()];

            case VMConstantTag.RegExp:
                return [tag, reader.readString(), reader.readString()];

            case VMConstantTag.SignedIntArray: {
                const length: number = reader.readUnsignedVarint();
                const values: number[] = [];

                for (let index: number = 0; index < length; index++) {
                    values.push(reader.readSignedVarint());
                }

                return [tag, values];
            }

            default:
                throw new Error(`Invalid VM bytecode: unknown constant tag ${tag}`);
        }
    }

    private static readFunction(reader: VMBinaryReader): IVMFunction {
        const id: number = reader.readUnsignedVarint();
        const flags: number = reader.readUint16();
        const arity: number = reader.readUnsignedVarint();
        const localCount: number = reader.readUnsignedVarint();
        const captureCount: number = reader.readUnsignedVarint();
        const instructionCount: number = reader.readUnsignedVarint();
        const exceptionCount: number = reader.readUnsignedVarint();
        const instructions: IVMInstruction[] = [];
        const exceptionTable: IVMExceptionRow[] = [];

        for (let index: number = 0; index < instructionCount; index++) {
            const address: number = reader.readUnsignedVarint();
            const encodedNextAddress: number = reader.readUnsignedVarint();
            const opcode: number = reader.readUnsignedVarint();
            const operandCount: number = reader.readUnsignedVarint();
            const operands: number[] = [];

            for (let operandIndex: number = 0; operandIndex < operandCount; operandIndex++) {
                operands.push(reader.readSignedVarint());
            }

            instructions.push({
                address,
                nextAddress: encodedNextAddress - 1,
                opcode,
                operands
            });
        }

        for (let index: number = 0; index < exceptionCount; index++) {
            exceptionTable.push({
                startAddress: reader.readSignedVarint(),
                endAddress: reader.readSignedVarint(),
                catchAddress: reader.readSignedVarint(),
                finallyAddress: reader.readSignedVarint(),
                catchSlot: reader.readSignedVarint()
            });
        }

        return {
            id,
            flags,
            arity,
            localCount,
            captureCount,
            instructions,
            exceptionTable
        };
    }

    private static toJsonValue(program: IVMProgram): unknown[] {
        return [
            program.version,
            program.flags,
            program.constants.map((constant: TVMConstant) => VMSerializer.constantToJson(constant)),
            program.functions.map((vmFunction: IVMFunction) => [
                vmFunction.id,
                vmFunction.flags,
                vmFunction.arity,
                vmFunction.localCount,
                vmFunction.captureCount,
                vmFunction.instructions.map((instruction: IVMInstruction) => [
                    instruction.address,
                    instruction.nextAddress,
                    instruction.opcode,
                    ...instruction.operands
                ]),
                vmFunction.exceptionTable.map((row: IVMExceptionRow) => [
                    row.startAddress,
                    row.endAddress,
                    row.catchAddress,
                    row.finallyAddress,
                    row.catchSlot
                ])
            ])
        ];
    }

    private static constantToJson(constant: TVMConstant): unknown[] {
        switch (constant[0]) {
            case VMConstantTag.Number:
                return [constant[0], VMSerializer.numberToHex(constant[1])];

            case VMConstantTag.BigInt:
                return [constant[0], constant[1].toString(10)];

            case VMConstantTag.SignedIntArray:
                return [constant[0], [...constant[1]]];

            default:
                return [...constant];
        }
    }

    private static deserializeJson(json: string): IVMProgram {
        let value: unknown;

        try {
            value = JSON.parse(json);
        } catch {
            throw new Error('Invalid VM bytecode: malformed JSON');
        }

        if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1) {
            throw new Error('Invalid VM bytecode: invalid JSON program');
        }

        const [, flags, rawConstants, rawFunctions] = value;

        if (!Number.isSafeInteger(flags) || !Array.isArray(rawConstants) || !Array.isArray(rawFunctions)) {
            throw new Error('Invalid VM bytecode: invalid JSON program');
        }

        const constants: TVMConstant[] = rawConstants.map((constant: unknown) =>
            VMSerializer.constantFromJson(constant)
        );
        const functions: IVMFunction[] = rawFunctions.map((vmFunction: unknown) =>
            VMSerializer.functionFromJson(vmFunction)
        );

        return {
            version: 1,
            flags,
            constants,
            functions
        };
    }

    private static constantFromJson(value: unknown): TVMConstant {
        if (!Array.isArray(value) || value.length < 1) {
            throw new Error('Invalid VM bytecode: invalid JSON constant');
        }

        const tag: unknown = value[0];

        switch (tag) {
            case VMConstantTag.Undefined:
            case VMConstantTag.Null:
            case VMConstantTag.False:
            case VMConstantTag.True:
            case VMConstantTag.ArrayHole:
                if (value.length !== 1) {
                    throw new Error('Invalid VM bytecode: invalid JSON constant');
                }

                return [tag];

            case VMConstantTag.Number:
                if (value.length !== 2 || typeof value[1] !== 'string') {
                    throw new Error('Invalid VM bytecode: invalid JSON number');
                }

                return [tag, VMSerializer.hexToNumber(value[1])];

            case VMConstantTag.BigInt:
                if (value.length !== 2 || typeof value[1] !== 'string' || !/^-?\d+$/.test(value[1])) {
                    throw new Error('Invalid VM bytecode: invalid JSON bigint');
                }

                return [tag, BigInt(value[1])];

            case VMConstantTag.String:
                if (value.length !== 2 || typeof value[1] !== 'string') {
                    throw new Error('Invalid VM bytecode: invalid JSON string');
                }

                return [tag, value[1]];

            case VMConstantTag.RegExp:
                if (value.length !== 3 || typeof value[1] !== 'string' || typeof value[2] !== 'string') {
                    throw new Error('Invalid VM bytecode: invalid JSON regexp');
                }

                return [tag, value[1], value[2]];

            case VMConstantTag.SignedIntArray:
                if (
                    value.length !== 2 ||
                    !Array.isArray(value[1]) ||
                    value[1].some((item: unknown) => !Number.isSafeInteger(item))
                ) {
                    throw new Error('Invalid VM bytecode: invalid JSON int array');
                }

                return [tag, value[1]];

            default:
                throw new Error(`Invalid VM bytecode: unknown constant tag ${String(tag)}`);
        }
    }

    private static functionFromJson(value: unknown): IVMFunction {
        if (!Array.isArray(value) || value.length !== 7) {
            throw new Error('Invalid VM bytecode: invalid JSON function');
        }

        const [id, flags, arity, localCount, captureCount, rawInstructions, rawExceptions] = value;
        const scalars: unknown[] = [id, flags, arity, localCount, captureCount];

        if (
            scalars.some((item: unknown) => !Number.isSafeInteger(item) || Number(item) < 0) ||
            !Array.isArray(rawInstructions) ||
            !Array.isArray(rawExceptions)
        ) {
            throw new Error('Invalid VM bytecode: invalid JSON function');
        }

        const instructions: IVMInstruction[] = rawInstructions.map((instruction: unknown) => {
            if (
                !Array.isArray(instruction) ||
                instruction.length < 3 ||
                instruction.some((item: unknown) => !Number.isSafeInteger(item))
            ) {
                throw new Error('Invalid VM bytecode: invalid JSON instruction');
            }

            return {
                address: instruction[0],
                nextAddress: instruction[1],
                opcode: instruction[2],
                operands: instruction.slice(3)
            };
        });
        const exceptionTable: IVMExceptionRow[] = rawExceptions.map((row: unknown) => {
            if (
                !Array.isArray(row) ||
                row.length !== 5 ||
                row.some((item: unknown) => !Number.isSafeInteger(item))
            ) {
                throw new Error('Invalid VM bytecode: invalid JSON exception row');
            }

            return {
                startAddress: row[0],
                endAddress: row[1],
                catchAddress: row[2],
                finallyAddress: row[3],
                catchSlot: row[4]
            };
        });

        return {
            id,
            flags,
            arity,
            localCount,
            captureCount,
            instructions,
            exceptionTable
        };
    }

    private static numberToHex(value: number): string {
        const bytes: Uint8Array = new Uint8Array(8);
        const view: DataView = new DataView(bytes.buffer);

        if (Number.isNaN(value)) {
            view.setUint32(0, 0x7f_f8_00_00, false);
            view.setUint32(4, 0, false);
        } else {
            view.setFloat64(0, value, false);
        }

        return Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, '0')).join('');
    }

    private static hexToNumber(value: string): number {
        if (!/^[0-9a-f]{16}$/.test(value)) {
            throw new Error('Invalid VM bytecode: invalid JSON number');
        }

        const bytes: Uint8Array = new Uint8Array(8);

        for (let index: number = 0; index < bytes.length; index++) {
            bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
        }

        const number: number = new DataView(bytes.buffer).getFloat64(0, false);

        return Number.isNaN(number) ? Number.NaN : number;
    }

    private static validateProgram(program: IVMProgram): void {
        if (program.version !== 1 || !Number.isSafeInteger(program.flags) || program.flags < 0) {
            throw new Error('Invalid VM program header');
        }

        const functionIds: Set<number> = new Set();

        for (const vmFunction of program.functions) {
            if (functionIds.has(vmFunction.id)) {
                throw new Error(`Invalid VM program: duplicate function id ${vmFunction.id}`);
            }

            functionIds.add(vmFunction.id);
            const addresses: Set<number> = new Set();

            for (const instruction of vmFunction.instructions) {
                if (
                    !Number.isSafeInteger(instruction.address) ||
                    instruction.address < 0 ||
                    addresses.has(instruction.address) ||
                    !Number.isSafeInteger(instruction.nextAddress) ||
                    instruction.nextAddress < -1 ||
                    !Number.isSafeInteger(instruction.opcode) ||
                    instruction.opcode < 0 ||
                    instruction.operands.some((operand: number) => !Number.isSafeInteger(operand))
                ) {
                    throw new Error(`Invalid VM program instruction in function ${vmFunction.id}`);
                }

                addresses.add(instruction.address);
            }

            for (const instruction of vmFunction.instructions) {
                if (instruction.nextAddress !== -1 && !addresses.has(instruction.nextAddress)) {
                    throw new Error(`Invalid VM program next address ${instruction.nextAddress}`);
                }
            }
        }
    }
}
