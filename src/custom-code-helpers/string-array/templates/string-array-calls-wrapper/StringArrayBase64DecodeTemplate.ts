import { IRandomGenerator } from '../../../../interfaces/utils/IRandomGenerator';

/**
 * @param {IRandomGenerator} randomGenerator
 * @returns {string}
 * @constructor
 */
export function StringArrayBase64DecodeTemplate(randomGenerator: IRandomGenerator): string {
    const identifierLength: number = 6;
    const initializedIdentifier: string = randomGenerator.getRandomString(identifierLength);
    const base64Identifier: string = randomGenerator.getRandomString(identifierLength);
    const dataIdentifier: string = randomGenerator.getRandomString(identifierLength);
    const cacheStateIdentifier: string = randomGenerator.getRandomString(identifierLength);

    return `
        if ({stringArrayCallsWrapperName}.${initializedIdentifier} === undefined) {
            {atobPolyfill}
            {stringArrayCallsWrapperName}.${base64Identifier} = {atobFunctionName};

            {stringArrayCallsWrapperName}.${dataIdentifier} = {};

            {stringArrayCallsWrapperName}.${initializedIdentifier} = true;
        }

        const firstValue = stringArray[0];

        if ({stringArrayCallsWrapperName}.${cacheStateIdentifier} !== firstValue) {
            {stringArrayCallsWrapperName}.${dataIdentifier} = {};
            {stringArrayCallsWrapperName}.${cacheStateIdentifier} = firstValue;
        }

        const cachedValue = {stringArrayCallsWrapperName}.${dataIdentifier}[index];

        if (cachedValue === undefined) {
            {selfDefendingCode}

            value = {stringArrayCallsWrapperName}.${base64Identifier}(value);
            {stringArrayCallsWrapperName}.${dataIdentifier}[index] = value;
        } else {
            value = cachedValue;
        }
    `;
}
