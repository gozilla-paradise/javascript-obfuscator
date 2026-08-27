import { inject, injectable } from 'inversify';
import { ServiceIdentifiers } from '../container/ServiceIdentifiers';

import { TIdentifierNamesCache } from '../types/TIdentifierNamesCache';

import { ICryptUtils } from '../interfaces/utils/ICryptUtils';
import { IGlobalIdentifierNamesCacheStorage } from '../interfaces/storages/identifier-names-cache/IGlobalIdentifierNamesCacheStorage';
import { IObfuscationResult } from '../interfaces/source-code/IObfuscationResult';
import { IObfuscationWarning } from '../interfaces/source-code/IObfuscationWarning';
import { IObfuscationWarningsStorage } from '../interfaces/storages/IObfuscationWarningsStorage';

import { IPropertyIdentifierNamesCacheStorage } from '../interfaces/storages/identifier-names-cache/IPropertyIdentifierNamesCacheStorage';
import { IOptions } from '../interfaces/options/IOptions';

import { initializable } from '../decorators/Initializable';
import { SourceMapMode } from '../enums/source-map/SourceMapMode';

@injectable()
export class ObfuscationResult implements IObfuscationResult {
    /**
     * @type {string}
     */
    @initializable()
    private obfuscatedCode!: string;

    /**
     * @type {string}
     */
    @initializable()
    private sourceMap!: string;

    /**
     * @type {ICryptUtils}
     */
    private readonly cryptUtils: ICryptUtils;

    /**
     * @type {IGlobalIdentifierNamesCacheStorage}
     */
    private readonly globalIdentifierNamesCacheStorage: IGlobalIdentifierNamesCacheStorage;

    /**
     * @type {IPropertyIdentifierNamesCacheStorage}
     */
    private readonly propertyIdentifierNamesCacheStorage: IPropertyIdentifierNamesCacheStorage;

    /**
     * @type {IOptions}
     */
    private readonly options: IOptions;
    /**
     * @type {IObfuscationWarningsStorage}
     */
    private readonly warningsStorage: IObfuscationWarningsStorage;


    /**
     * @param {ICryptUtils} cryptUtils
     * @param {IGlobalIdentifierNamesCacheStorage} globalIdentifierNamesCacheStorage
     * @param {IPropertyIdentifierNamesCacheStorage} propertyIdentifierNamesCacheStorage
     * @param {IOptions} options
     */
    public constructor(
        @inject(ServiceIdentifiers.ICryptUtils) cryptUtils: ICryptUtils,
        @inject(ServiceIdentifiers.IGlobalIdentifierNamesCacheStorage)
        globalIdentifierNamesCacheStorage: IGlobalIdentifierNamesCacheStorage,
        @inject(ServiceIdentifiers.IPropertyIdentifierNamesCacheStorage)
        propertyIdentifierNamesCacheStorage: IPropertyIdentifierNamesCacheStorage,
        @inject(ServiceIdentifiers.IOptions) options: IOptions,
        @inject(ServiceIdentifiers.IObfuscationWarningsStorage)
        warningsStorage: IObfuscationWarningsStorage
    ) {
        this.cryptUtils = cryptUtils;
        this.globalIdentifierNamesCacheStorage = globalIdentifierNamesCacheStorage;
        this.propertyIdentifierNamesCacheStorage = propertyIdentifierNamesCacheStorage;
        this.options = options;
        this.warningsStorage = warningsStorage;

    }

    /**
     * @param {string} obfuscatedCode
     * @param {string} sourceMap
     */
    public initialize(obfuscatedCode: string, sourceMap: string): void {
        this.obfuscatedCode = obfuscatedCode;
        this.sourceMap = sourceMap;
    }

    /**
     * @returns {string}
     */
    public getIdentifierNamesCache(): TIdentifierNamesCache {
        if (!this.options.identifierNamesCache) {
            return null;
        }

        return {
            globalIdentifiers: this.globalIdentifierNamesCacheStorage.getStorageAsDictionary(),
            propertyIdentifiers: this.propertyIdentifierNamesCacheStorage.getStorageAsDictionary()
        };
    }

    /**
     * @returns {string}
     */
    public getObfuscatedCode(): string {
        return this.correctObfuscatedCode();
    }

    /**
     * @returns {IOptions}
     */
    public getOptions(): IOptions {
        return this.options;
    }

    /**
     * @returns {string}
     */
    public getSourceMap(): string {
        return this.sourceMap;
    }

    /**
     * @returns {readonly IObfuscationWarning[]}
     */
    public getWarnings(): readonly IObfuscationWarning[] {
        return this.warningsStorage.getWarnings();
    }

    /**
     * @returns {string}
     */
    public toString(): string {
        return this.obfuscatedCode;
    }

    /**
     * @returns {string}
     */
    private correctObfuscatedCode(): string {
        if (!this.sourceMap) {
            return this.obfuscatedCode;
        }

        const sourceMapUrl: string = this.options.sourceMapBaseUrl + this.options.sourceMapFileName;

        let sourceMappingUrl: string = '//# sourceMappingURL=';

        switch (this.options.sourceMapMode) {
            case SourceMapMode.Inline:
                sourceMappingUrl += `data:application/json;base64,${this.cryptUtils.btoa(this.sourceMap)}`;

                break;

            case SourceMapMode.Separate:
            default:
                if (!sourceMapUrl) {
                    return this.obfuscatedCode;
                }

                sourceMappingUrl += sourceMapUrl;
        }

        return `${this.obfuscatedCode}\n${sourceMappingUrl}`;
    }
}
