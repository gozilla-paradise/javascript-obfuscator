export interface IJavaScriptParsingErrorLocation {
    readonly line: number;
    readonly column: number;
}

export class JavaScriptParsingError extends SyntaxError {
    public readonly cause!: unknown;

    public readonly location: Readonly<IJavaScriptParsingErrorLocation>;

    public constructor(
        message: string,
        location: IJavaScriptParsingErrorLocation,
        cause: unknown
    ) {
        super(message);

        this.name = JavaScriptParsingError.name;
        this.location = Object.freeze({
            line: location.line,
            column: location.column
        });

        Object.defineProperty(this, 'cause', {
            configurable: false,
            enumerable: false,
            value: cause,
            writable: false
        });
    }
}
