export enum VMProgramFlag {
    RegisterMode = 1 << 0,
    InstructionEncoding = 1 << 1,
    WholeArrayEncoding = 1 << 2,
    InstructionShuffle = 1 << 3,
    JumpEncoding = 1 << 4,
    StatefulOpcodes = 1 << 5,
    RuntimeOpcodeDerivation = 1 << 6,
    RandomizedKeys = 1 << 7,
    CompactDispatcher = 1 << 8,
    IndirectDispatch = 1 << 9,
    SplitDispatcher = 1 << 10,
    StackEncoding = 1 << 11,
    AsyncKey = 1 << 12
}

export enum VMFunctionFlag {
    Async = 1 << 0,
    Generator = 1 << 1,
    Arrow = 1 << 2,
    Strict = 1 << 3,
    Constructable = 1 << 4,
    Method = 1 << 5,
    DerivedConstructor = 1 << 6
}
