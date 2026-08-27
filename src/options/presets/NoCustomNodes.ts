import { TInputOptions } from '../../types/options/TInputOptions';

import { DEFAULT_PRESET } from './Default';


export const NO_ADDITIONAL_NODES_PRESET: TInputOptions = Object.freeze({
    ...DEFAULT_PRESET,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjectionThreshold: 0,
    simplify: false,
    splitStringsChunkLength: 0,
    stringArray: false,
    stringArrayCallsTransformThreshold: 0,
    stringArrayIndexShift: false,
    stringArrayRotate: false,
    stringArrayShuffle: false,
    stringArrayThreshold: 0,
    stringArrayWrappersChainedCalls: false,
    stringArrayWrappersCount: 0
});
