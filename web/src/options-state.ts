import { IOptions } from '../../src/interfaces/options/IOptions';

export interface IOptionsStateInitialization {
    readonly options: IOptions;
    readonly allowedOptionNames: readonly string[];
}

export class OptionsState {
    public options: IOptions;
    public jsonText: string;
    public jsonError: string = '';
    public jsonDirty: boolean = false;

    private allowedOptionNames: ReadonlySet<string>;


    public constructor(initialization: IOptionsStateInitialization) {
        this.options = OptionsState.cloneOptions(initialization.options);
        this.allowedOptionNames = new Set(initialization.allowedOptionNames);
        this.jsonText = OptionsState.formatOptions(this.options);
    }
    private static cloneOptions(options: IOptions): IOptions {
        return <IOptions>JSON.parse(JSON.stringify(options));
    }

    private static formatOptions(options: IOptions): string {
        return JSON.stringify(options, null, 2);
    }

    public replaceFromPreset(
        options: IOptions,
        allowedOptionNames?: readonly string[]
    ): void {
        this.options = OptionsState.cloneOptions(options);

        if (allowedOptionNames !== undefined) {
            this.allowedOptionNames = new Set(allowedOptionNames);
        }

        this.jsonText = OptionsState.formatOptions(this.options);
        this.jsonError = '';
        this.jsonDirty = false;
    }

    public setFormValue<TKey extends keyof IOptions>(key: TKey, value: IOptions[TKey]): void {
        this.setFormValues(<Partial<IOptions>>{ [key]: value });
    }

    public setFormValues(values: Readonly<Partial<IOptions>>): void {
        Object.assign(this.options, values);
        this.jsonText = OptionsState.formatOptions(this.options);
        this.jsonError = '';
        this.jsonDirty = false;
    }

    public setJsonText(jsonText: string): void {
        this.jsonText = jsonText;
        this.jsonError = '';
        this.jsonDirty = true;
    }

    public applyJson(): boolean {
        let parsedOptions: unknown;

        try {
            parsedOptions = JSON.parse(this.jsonText);
        } catch (error: unknown) {
            this.jsonError = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;

            return false;
        }

        if (
            typeof parsedOptions !== 'object'
            || parsedOptions === null
            || Array.isArray(parsedOptions)
        ) {
            this.jsonError = 'Options JSON must be an object.';

            return false;
        }

        const unknownOptionName: string | undefined = Object.keys(parsedOptions)
            .find((optionName: string): boolean => !this.allowedOptionNames.has(optionName));

        if (unknownOptionName !== undefined) {
            this.jsonError = `Unknown option: "${unknownOptionName}".`;

            return false;
        }

        this.options = OptionsState.cloneOptions(<IOptions>parsedOptions);
        this.jsonText = OptionsState.formatOptions(this.options);
        this.jsonError = '';
        this.jsonDirty = false;

        return true;
    }

}
