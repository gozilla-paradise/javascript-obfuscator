import { IOptions } from '../../src/interfaces/options/IOptions';
import { TOptionsPreset } from '../../src/types/options/TOptionsPreset';

export type TProjectOutputMode = 'bundle' | 'modules';
export type TBundleFormat = 'esm' | 'iife';

export interface IProjectFile {
    readonly path: string;
    readonly contents: string;
}

export interface IProjectManifest {
    readonly includedPaths: string[];
    readonly ignoredPaths: string[];
}

export interface IOutputArtifact {
    readonly name: string;
    readonly data: string | Uint8Array;
    readonly mimeType: string;
}

export interface IWebWarning {
    readonly origin: 'bundler' | 'obfuscator';
    readonly message: string;
    readonly filePath?: string;
    readonly code?: string;
    readonly line?: number;
    readonly column?: number;
}

export type TWorkerRequest =
    | {
        readonly id: number;
        readonly type: 'get-preset';
        readonly preset: TOptionsPreset;
    }
    | {
        readonly id: number;
        readonly type: 'obfuscate-source';
        readonly name: string;
        readonly source: string;
        readonly options: IOptions;
    }
    | {
        readonly id: number;
        readonly type: 'obfuscate-project';
        readonly entryPath: string;
        readonly files: IProjectFile[];
        readonly outputMode: TProjectOutputMode;
        readonly bundleFormat: TBundleFormat;
        readonly wasmUrl: string;
        readonly options: IOptions;
    };

export type TWorkerResponse =
    | {
        readonly id: number;
        readonly type: 'progress';
        readonly phase: string;
        readonly completed: number;
        readonly total: number;
    }
    | {
        readonly id: number;
        readonly type: 'preset';
        readonly options: IOptions;
        readonly allowedOptionNames: string[];
    }
    | {
        readonly id: number;
        readonly type: 'success';
        readonly artifacts: IOutputArtifact[];
        readonly preview: string;
        readonly warnings: IWebWarning[];
        readonly projectManifest?: IProjectManifest;
    }
    | {
        readonly id: number;
        readonly type: 'error';
        readonly message: string;
    };
