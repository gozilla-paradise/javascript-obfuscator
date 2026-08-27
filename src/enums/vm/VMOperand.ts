export enum VMUnaryOperator {
    Void = 0,
    Typeof = 1,
    Plus = 2,
    Minus = 3,
    BitNot = 4,
    Not = 5
}

export enum VMBinaryOperator {
    Equal = 0,
    NotEqual = 1,
    StrictEqual = 2,
    StrictNotEqual = 3,
    LessThan = 4,
    LessThanOrEqual = 5,
    GreaterThan = 6,
    GreaterThanOrEqual = 7,
    ShiftLeft = 8,
    ShiftRight = 9,
    ShiftRightUnsigned = 10,
    Add = 11,
    Subtract = 12,
    Multiply = 13,
    Divide = 14,
    Modulo = 15,
    Power = 16,
    BitOr = 17,
    BitXor = 18,
    BitAnd = 19,
    In = 20,
    Instanceof = 21
}

export enum VMUpdateOperator {
    PreIncrement = 0,
    PreDecrement = 1,
    PostIncrement = 2,
    PostDecrement = 3
}

export enum VMCaptureSource {
    Local = 0,
    Capture = 1
}

export enum VMReferenceKind {
    Local = 0,
    Capture = 1,
    Global = 2,
    Property = 3,
    Private = 4
}

export enum VMPropertyKind {
    Data = 0,
    Get = 1,
    Set = 2,
    Method = 3
}

export enum VMPropertyFlag {
    Enumerable = 1 << 0,
    Configurable = 1 << 1,
    Writable = 1 << 2,
    Static = 1 << 3
}

export enum VMPrivateOperation {
    Get = 0,
    Set = 1,
    Call = 2,
    In = 3
}

export enum VMIteratorMode {
    Sync = 0,
    Async = 1
}

export enum VMClassElementKind {
    Constructor = 0,
    Method = 1,
    Getter = 2,
    Setter = 3,
    InstanceField = 4,
    StaticField = 5,
    StaticBlock = 6,
    PrivateMethod = 7,
    PrivateField = 8
}
