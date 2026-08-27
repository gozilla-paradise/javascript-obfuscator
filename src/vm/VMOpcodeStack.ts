/* eslint-disable complexity */
import { VMOpcode, VM_REGISTER_OPCODE_OFFSET } from '../enums/vm/VMOpcode';
import { VMPrivateOperation, VMReferenceKind } from '../enums/vm/VMOperand';

export interface IVMOpcodeStackContract {
    readonly consumed: number;
    readonly produced: number;
}

export function getVMOpcodeStackContract(
    opcode: number,
    operands: readonly number[]
): IVMOpcodeStackContract {
    if (
        (opcode >= VM_REGISTER_OPCODE_OFFSET && opcode < VMOpcode.RegisterMove) ||
        opcode === VMOpcode.RegisterMove
    ) {
        const destinationCount: number = operands[0];
        const sourceCountIndex: number = destinationCount + 1;
        const sourceCount: number = operands[sourceCountIndex];

        if (
            !Number.isSafeInteger(destinationCount) ||
            destinationCount < 0 ||
            !Number.isSafeInteger(sourceCount) ||
            sourceCount < 0 ||
            sourceCountIndex + sourceCount >= operands.length + 1
        ) {
            throw new Error(`Invalid register operands for VM opcode ${opcode}`);
        }

        return {
            consumed: sourceCount,
            produced: destinationCount
        };
    }

    switch (opcode) {
        case VMOpcode.Nop:
        case VMOpcode.Jump:
        case VMOpcode.ExitWith:
        case VMOpcode.Debugger:
        case VMOpcode.End:
            return { consumed: 0, produced: 0 };

        case VMOpcode.Const:
        case VMOpcode.GetLocal:
        case VMOpcode.GetCapture:
        case VMOpcode.GetGlobal:
        case VMOpcode.DeleteGlobal:
        case VMOpcode.TypeofGlobal:
        case VMOpcode.This:
        case VMOpcode.Arguments:
        case VMOpcode.NewTarget:
        case VMOpcode.UpdateLocal:
        case VMOpcode.MakeArray:
        case VMOpcode.MakeObject:
        case VMOpcode.MakeClosure:
        case VMOpcode.ResolveName:
        case VMOpcode.ImportMeta:
        case VMOpcode.LocalBinaryConst:
            return { consumed: 0, produced: 1 };

        case VMOpcode.Return:
        case VMOpcode.Throw:
        case VMOpcode.Pop:
        case VMOpcode.InitLocal:
        case VMOpcode.JumpIfTrue:
        case VMOpcode.JumpIfFalse:
        case VMOpcode.JumpIfNullish:
        case VMOpcode.EnterWith:
            return { consumed: 1, produced: 0 };

        case VMOpcode.Dup:
            return { consumed: 1, produced: 2 };

        case VMOpcode.SetLocal:
        case VMOpcode.SetCapture:
        case VMOpcode.SetGlobal:
        case VMOpcode.Unary:
        case VMOpcode.IterOpen:
        case VMOpcode.AsyncIterOpen:
        case VMOpcode.Await:
        case VMOpcode.Yield:
        case VMOpcode.YieldStar:
        case VMOpcode.DynamicImport:
        case VMOpcode.SetName:
        case VMOpcode.EvalThunk:
        case VMOpcode.EnumKeys:
            return { consumed: 1, produced: 1 };

        case VMOpcode.Binary:
        case VMOpcode.GetProperty:
        case VMOpcode.DeleteProperty:
        case VMOpcode.ArrayAppend:
        case VMOpcode.ArraySpread:
        case VMOpcode.ObjectSpread:
            return { consumed: 2, produced: 1 };

        case VMOpcode.SetProperty:
        case VMOpcode.DefineProperty:
            return { consumed: 3, produced: 1 };

        case VMOpcode.GetPrivate:
            return { consumed: 1, produced: 1 };

        case VMOpcode.SetPrivate:
            return { consumed: 2, produced: 1 };

        case VMOpcode.Call:
        case VMOpcode.Construct:
            return { consumed: getOperand(operands, 0) + 1, produced: 1 };

        case VMOpcode.CallMethod:
        case VMOpcode.PropertyCall:
            return { consumed: getOperand(operands, 0) + 2, produced: 1 };

        case VMOpcode.CallContext:
            return {
                consumed:
                    getOperand(operands, 1) +
                    1 +
                    (operands[3] ?? 0),
                produced: 1
            };

        case VMOpcode.IterNext:
        case VMOpcode.AsyncIterNext:
            return { consumed: 1, produced: 2 };

        case VMOpcode.IterClose:
            return { consumed: 2, produced: 1 };

        case VMOpcode.MakeClass:
            return {
                consumed: getOperand(operands, 1) + getOperand(operands, 2) + getOperand(operands, 3),
                produced: 1
            };

        case VMOpcode.SuperGet:
            return { consumed: 2, produced: 1 };

        case VMOpcode.SuperSet:
            return { consumed: 3, produced: 1 };

        case VMOpcode.SuperCall:
            return { consumed: getOperand(operands, 1), produced: 1 };

        case VMOpcode.PrivateOp:
            return getPrivateOperationContract(operands);

        case VMOpcode.UpdateReference:
            return getUpdateReferenceContract(operands);

        default:
            throw new Error(`Unknown VM opcode stack contract: ${opcode}`);
    }
}


function getOperand(operands: readonly number[], index: number): number {
    const operand: number = operands[index];

    if (!Number.isSafeInteger(operand) || operand < 0) {
        throw new Error(`Invalid VM operand at index ${index}`);
    }

    return operand;
}

function getPrivateOperationContract(operands: readonly number[]): IVMOpcodeStackContract {
    switch (getOperand(operands, 0)) {
        case VMPrivateOperation.Get:
        case VMPrivateOperation.In:
            return { consumed: 1, produced: 1 };

        case VMPrivateOperation.Set:
            return { consumed: 2, produced: 1 };

        case VMPrivateOperation.Call:
            return { consumed: getOperand(operands, 2) + 1, produced: 1 };

        default:
            throw new Error('Invalid VM private operation');
    }
}

function getUpdateReferenceContract(operands: readonly number[]): IVMOpcodeStackContract {
    switch (getOperand(operands, 0)) {
        case VMReferenceKind.Local:
        case VMReferenceKind.Capture:
        case VMReferenceKind.Global:
            return { consumed: 0, produced: 1 };

        case VMReferenceKind.Property:
            return { consumed: 2, produced: 1 };

        case VMReferenceKind.Private:
            return { consumed: 1, produced: 1 };

        default:
            throw new Error('Invalid VM reference kind');
    }
}
