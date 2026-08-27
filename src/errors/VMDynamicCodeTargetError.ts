export class VMDynamicCodeTargetError extends Error {
    public constructor(target: string) {
        super(`Dynamic code is not allowed for target '${target}'`);
        this.name = VMDynamicCodeTargetError.name;
    }
}
