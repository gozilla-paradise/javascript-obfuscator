export class VMUnsupportedSyntaxError extends SyntaxError {
    public constructor(nodeType: string, line: number, column: number) {
        super(`${nodeType} at ${line}:${column}`);
        this.name = VMUnsupportedSyntaxError.name;
    }
}
