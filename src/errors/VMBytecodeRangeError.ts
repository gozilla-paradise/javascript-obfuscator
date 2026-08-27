export class VMBytecodeRangeError extends RangeError {
    public constructor(value: number) {
        super(`VM bytecode operand is outside signed 32-bit range: ${value}`);
        this.name = 'VMBytecodeRangeError';
    }
}
