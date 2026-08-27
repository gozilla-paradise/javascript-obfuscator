/* eslint-disable */
import { inject, injectable } from 'inversify';

import { ServiceIdentifiers } from '../container/ServiceIdentifiers';

import { VMProgramFlag } from '../enums/vm/VMFlag';
import { VMBytecodeFormat } from '../enums/vm/VMBytecodeFormat';
import { VMOpcode } from '../enums/vm/VMOpcode';
import { getVMOpcodeStackContract } from './VMOpcodeStack';
import { VMBytecodeRangeError } from '../errors/VMBytecodeRangeError';
import {
    chacha20Words,
    deriveDefaultVMKey,
    deriveVMInstructionMaterial,
    deriveVMKeyMaterial,
    deriveVMProgramId
} from './VMCrypto';
import { VMSerializer } from './VMSerializer';


import type { IOptions } from '../interfaces/options/IOptions';
import type { IRandomGenerator } from '../interfaces/utils/IRandomGenerator';
import type { IVMBytecodeProtector } from '../interfaces/vm/IVMBytecodeProtector';
import type {
    IVMExceptionRow,
    IVMFunction,
    IVMInstruction,
    IVMProgram,
    IVMProtectedProgram
} from '../interfaces/vm/IVMProgram';

@injectable()
export class VMBytecodeProtector implements IVMBytecodeProtector {
    public constructor(
        @inject(ServiceIdentifiers.IOptions) private readonly options: IOptions,
        @inject(ServiceIdentifiers.IRandomGenerator)
        private readonly randomGenerator: IRandomGenerator
    ) {}

    public protect(program: IVMProgram): IVMProtectedProgram {
        const canonicalPayload: Uint8Array = new VMSerializer().serialize(
            program,
            VMBytecodeFormat.Binary
        ).bytes!;
        const programId: Uint8Array = deriveVMProgramId(
            this.options.seed,
            canonicalPayload
        );
        const key: string =
            this.options.vmBytecodeArrayEncodingKey ||
            deriveDefaultVMKey(this.options.seed);
        const prk: Uint8Array = deriveVMKeyMaterial(key, this.options.seed).prk;
        const decodedOpcodes: Record<string, number> = {};
        const jumpKeys: Record<string, number> = {};
        const usedOpcodes: Set<number> = new Set();
        const functions: IVMFunction[] = program.functions.map((vmFunction: IVMFunction) => {
            let instructions: IVMInstruction[] = vmFunction.instructions.map(
                (instruction: IVMInstruction) => ({
                    address: instruction.address,
                    nextAddress: instruction.nextAddress,
                    opcode: instruction.opcode,
                    operands: [...instruction.operands]
                })
            );

            if (this.options.vmMacroOps) {
                instructions = this.fuseMacros(instructions);
            }
            if (this.options.vmDeadCodeInjection) {
                instructions = this.injectDeadBlock(instructions, program.constants.length);
            }
            if (this.options.vmRegisterBased) {
                instructions = this.rewriteToRegisters(instructions);
            }


            const normalized = this.assignLogicalAddresses(
                instructions,
                vmFunction.exceptionTable
            );
            instructions = normalized.instructions;
            const jumpKey: number = this.options.vmJumpsEncoding
                ? this.randomGenerator.getRandomInteger(1, 0x7f_ff_ff_ff)
                : 0;
            jumpKeys[String(vmFunction.id)] = jumpKey;

            instructions = instructions.map((instruction: IVMInstruction) => {
                const operands: number[] = [...instruction.operands];
                if (
                    this.options.vmJumpsEncoding &&
                    [
                        VMOpcode.Jump,
                        VMOpcode.JumpIfTrue,
                        VMOpcode.JumpIfFalse,
                        VMOpcode.JumpIfNullish
                    ].includes(instruction.opcode)
                ) {
                    operands[0] =
                        (operands[0] - instruction.address) ^ jumpKey;
                }

                usedOpcodes.add(instruction.opcode);

                return { ...instruction, operands };
            });

            const numericMap: Map<number, number> = this.buildNumericOpcodeMap(usedOpcodes);
            instructions = instructions.map((instruction: IVMInstruction) => {
                const logicalOpcode: number = instruction.opcode;
                let encodedOpcode: number = numericMap.get(logicalOpcode) ?? logicalOpcode;
                if (this.options.vmStatefulOpcodes) {
                    encodedOpcode =
                        (encodedOpcode +
                            vmFunction.id * 131 +
                            instruction.address * 17 +
                            1) %
                        512;
                }
                if (encodedOpcode !== logicalOpcode) {
                    decodedOpcodes[`${vmFunction.id}:${instruction.address}`] =
                        logicalOpcode;
                }

                return { ...instruction, opcode: encodedOpcode };
            });

            if (this.options.vmBytecodeEncoding) {
                instructions = instructions.map((instruction: IVMInstruction) =>
                    this.encodeInstruction(instruction, vmFunction.id, prk)
                );
            }

            if (this.options.vmInstructionShuffle) {
                instructions = this.shuffleInstructions(instructions);
            }

            return {
                ...vmFunction,
                instructions,
                exceptionTable: normalized.exceptionTable
            };
        });

        const decoyOpcodes: number[] = this.options.vmDecoyOpcodes
            ? [...usedOpcodes]
                  .sort((left: number, right: number) => left - right)
                  .slice(0, 32)
                  .map((_, index: number) => VMOpcode.FirstDecoy + index)
            : [];

        return {
            version: 1,
            flags: this.getProgramFlags(),
            constants: program.constants.map((constant) =>
                constant[0] === 9 ? [constant[0], [...constant[1]]] : constant
            ),
            functions,
            protection: {
                decodedOpcodes,
                jumpKeys,
                decoyOpcodes,
                programId: Array.from(programId)
            }
        };
    }

    private encodeInstruction(
        instruction: IVMInstruction,
        functionId: number,
        prk: Uint8Array
    ): IVMInstruction {
        instruction.operands.forEach((operand: number) => {
            if (
                !Number.isInteger(operand) ||
                operand < -0x80_00_00_00 ||
                operand > 0x7f_ff_ff_ff
            ) {
                throw new VMBytecodeRangeError(operand);
            }
        });
        const material = deriveVMInstructionMaterial(
            prk,
            functionId,
            instruction.address
        );
        const words: Uint32Array = chacha20Words(
            material.key,
            material.nonce,
            0,
            instruction.operands.length + 1
        );

        return {
            ...instruction,
            opcode: (instruction.opcode ^ words[0]) >>> 0,
            operands: instruction.operands.map(
                (operand: number, index: number) =>
                    (operand ^ words[index + 1]) | 0
            )
        };
    }

    private fuseMacros(instructions: readonly IVMInstruction[]): IVMInstruction[] {
        const jumpTargets: Set<number> = new Set();
        instructions.forEach((instruction: IVMInstruction) => {
            if (
                [
                    VMOpcode.Jump,
                    VMOpcode.JumpIfTrue,
                    VMOpcode.JumpIfFalse,
                    VMOpcode.JumpIfNullish
                ].includes(instruction.opcode)
            ) {
                jumpTargets.add(instruction.operands[0]);
            }
        });
        const fused: IVMInstruction[] = [];

        for (let index: number = 0; index < instructions.length; index++) {
            const first: IVMInstruction = instructions[index];
            const second: IVMInstruction | undefined = instructions[index + 1];
            const third: IVMInstruction | undefined = instructions[index + 2];
            const fourth: IVMInstruction | undefined = instructions[index + 3];
            if (
                second &&
                third &&
                fourth &&
                first.opcode === VMOpcode.GetLocal &&
                second.opcode === VMOpcode.Const &&
                third.opcode === VMOpcode.Binary &&
                fourth.opcode === VMOpcode.SetLocal &&
                first.operands[0] === fourth.operands[0] &&
                !jumpTargets.has(second.address) &&
                !jumpTargets.has(third.address) &&
                !jumpTargets.has(fourth.address)
            ) {
                fused.push({
                    address: first.address,
                    nextAddress: fourth.nextAddress,
                    opcode: VMOpcode.LocalBinaryConst,
                    operands: [
                        first.operands[0],
                        second.operands[0],
                        third.operands[0]
                    ]
                });
                index += 3;
                continue;
            }

            fused.push(first);
        }

        return fused;
    }

    private injectDeadBlock(
        instructions: readonly IVMInstruction[],
        constantCount: number
    ): IVMInstruction[] {
        const maxAddress: number = instructions.reduce(
            (maximum: number, instruction: IVMInstruction) =>
                Math.max(maximum, instruction.address),
            -1
        );
        const undefinedConstant: number = Math.max(0, constantCount - 1);

        return [
            ...instructions,
            {
                address: maxAddress + 1,
                nextAddress: maxAddress + 2,
                opcode: VMOpcode.Const,
                operands: [undefinedConstant]
            },
            {
                address: maxAddress + 2,
                nextAddress: maxAddress + 3,
                opcode: VMOpcode.Pop,
                operands: []
            },
            {
                address: maxAddress + 3,
                nextAddress: -1,
                opcode: VMOpcode.End,
                operands: []
            }
        ];
    }

    private assignLogicalAddresses(
        instructions: readonly IVMInstruction[],
        exceptionTable: readonly IVMExceptionRow[]
    ): { instructions: IVMInstruction[]; exceptionTable: IVMExceptionRow[] } {
        const addressMap: Map<number, number> = new Map();
        instructions.forEach((instruction: IVMInstruction, index: number) => {
            addressMap.set(instruction.address, index);
        });
        const normalizedInstructions: IVMInstruction[] = instructions.map(
            (instruction: IVMInstruction, index: number) => {
                const operands: number[] = [...instruction.operands];
                if (
                    [
                        VMOpcode.Jump,
                        VMOpcode.JumpIfTrue,
                        VMOpcode.JumpIfFalse,
                        VMOpcode.JumpIfNullish
                    ].includes(instruction.opcode)
                ) {
                    const target: number | undefined = addressMap.get(operands[0]);
                    if (target === undefined) {
                        throw new Error(`Invalid VM jump target ${operands[0]}`);
                    }
                    operands[0] = target;
                }
                const nextAddress: number =
                    instruction.nextAddress === -1
                        ? -1
                        : addressMap.get(instruction.nextAddress) ?? -1;

                return {
                    address: index,
                    nextAddress,
                    opcode: instruction.opcode,
                    operands
                };
            }
        );
        const mapExceptionAddress = (address: number): number => {
            if (address === -1) {return -1;}

            return addressMap.get(address) ?? normalizedInstructions.length;
        };

        return {
            instructions: normalizedInstructions,
            exceptionTable: exceptionTable.map((row: IVMExceptionRow) => ({
                startAddress: mapExceptionAddress(row.startAddress),
                endAddress: mapExceptionAddress(row.endAddress),
                catchAddress: mapExceptionAddress(row.catchAddress),
                finallyAddress: mapExceptionAddress(row.finallyAddress),
                catchSlot: row.catchSlot
            }))
        };
    }

    private rewriteToRegisters(
        instructions: readonly IVMInstruction[]
    ): IVMInstruction[] {
        const byAddress: Map<number, IVMInstruction> = new Map(
            instructions.map((instruction: IVMInstruction) => [
                instruction.address,
                instruction
            ])
        );
        const depthByAddress: Map<number, number> = new Map();
        const pending: number[] = [];
        const enqueue = (address: number, depth: number): void => {
            if (address === -1 || !byAddress.has(address)) {
                return;
            }
            const existing: number | undefined = depthByAddress.get(address);
            if (existing !== undefined) {
                if (existing !== depth) {
                    throw new Error(`Inconsistent VM stack depth at ${address}`);
                }

                return;
            }
            depthByAddress.set(address, depth);
            pending.push(address);
        };

        for (const seed of instructions) {
            if (!depthByAddress.has(seed.address)) {
                enqueue(seed.address, 0);
            }
            while (pending.length > 0) {
                const address: number = pending.shift()!;
                const instruction: IVMInstruction = byAddress.get(address)!;
                const depth: number = depthByAddress.get(address)!;
                const contract = getVMOpcodeStackContract(
                    instruction.opcode,
                    instruction.operands
                );
                if (contract.consumed > depth) {
                    throw new Error(`VM stack underflow at ${address}`);
                }
                const nextDepth: number =
                    depth - contract.consumed + contract.produced;
                if (instruction.opcode === VMOpcode.Jump) {
                    enqueue(instruction.operands[0], nextDepth);
                } else if (
                    instruction.opcode === VMOpcode.JumpIfTrue ||
                    instruction.opcode === VMOpcode.JumpIfFalse ||
                    instruction.opcode === VMOpcode.JumpIfNullish
                ) {
                    enqueue(instruction.operands[0], nextDepth);
                    enqueue(instruction.nextAddress, nextDepth);
                } else if (
                    instruction.opcode !== VMOpcode.Return &&
                    instruction.opcode !== VMOpcode.Throw &&
                    instruction.opcode !== VMOpcode.End
                ) {
                    enqueue(instruction.nextAddress, nextDepth);
                }
            }
        }

        return instructions.map((instruction: IVMInstruction) => {
            const depth: number = depthByAddress.get(instruction.address) ?? 0;
            const contract = getVMOpcodeStackContract(
                instruction.opcode,
                instruction.operands
            );
            const baseDestination: number = depth - contract.consumed;
            const destinations: number[] = Array.from(
                { length: contract.produced },
                (_, index: number) => baseDestination + index
            );
            const sources: number[] = Array.from(
                { length: contract.consumed },
                (_, index: number) => depth - contract.consumed + index
            );

            return {
                ...instruction,
                opcode: instruction.opcode + 256,
                operands: [
                    destinations.length,
                    ...destinations,
                    sources.length,
                    ...sources,
                    ...instruction.operands
                ]
            };
        });
    }

    private buildNumericOpcodeMap(usedOpcodes: ReadonlySet<number>): Map<number, number> {
        if (!this.options.vmOpcodeShuffle && !this.options.vmRuntimeOpcodeDerivation) {
            return new Map();
        }

        const logical: number[] = [...usedOpcodes].sort(
            (left: number, right: number) => left - right
        );
        const encoded: number[] = [...logical];
        for (let index: number = encoded.length - 1; index > 0; index--) {
            const other: number = this.randomGenerator.getRandomInteger(0, index);
            [encoded[index], encoded[other]] = [encoded[other], encoded[index]];
        }
        if (
            encoded.length > 1 &&
            encoded.every((value: number, index: number) => value === logical[index])
        ) {
            encoded.push(encoded.shift()!);
        }

        return new Map(
            logical.map((opcode: number, index: number) => [opcode, encoded[index]])
        );
    }

    private shuffleInstructions(
        instructions: readonly IVMInstruction[]
    ): IVMInstruction[] {
        const shuffled: IVMInstruction[] = [...instructions];
        for (let index: number = shuffled.length - 1; index > 0; index--) {
            const other: number = this.randomGenerator.getRandomInteger(0, index);
            [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
        }

        return shuffled;
    }

    private getProgramFlags(): number {
        let flags: number = 0;

        if (this.options.vmRegisterBased) {flags |= VMProgramFlag.RegisterMode;}
        if (this.options.vmBytecodeEncoding) {flags |= VMProgramFlag.InstructionEncoding;}
        if (this.options.vmBytecodeArrayEncoding) {flags |= VMProgramFlag.WholeArrayEncoding;}
        if (this.options.vmInstructionShuffle) {flags |= VMProgramFlag.InstructionShuffle;}
        if (this.options.vmJumpsEncoding) {flags |= VMProgramFlag.JumpEncoding;}
        if (this.options.vmStatefulOpcodes) {flags |= VMProgramFlag.StatefulOpcodes;}
        if (this.options.vmRuntimeOpcodeDerivation) {flags |= VMProgramFlag.RuntimeOpcodeDerivation;}
        if (this.options.vmRandomizeKeys) {flags |= VMProgramFlag.RandomizedKeys;}
        if (this.options.vmCompactDispatcher) {flags |= VMProgramFlag.CompactDispatcher;}
        if (this.options.vmIndirectDispatch) {flags |= VMProgramFlag.IndirectDispatch;}
        if (this.options.vmSplitDispatcher) {flags |= VMProgramFlag.SplitDispatcher;}
        if (this.options.vmStackEncoding) {flags |= VMProgramFlag.StackEncoding;}
        if (this.options.vmAsyncExecutor) {flags |= VMProgramFlag.AsyncKey;}

        return flags;
    }
}
