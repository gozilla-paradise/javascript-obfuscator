import { BuildFailure, BuildOptions, BuildResult, Plugin } from 'esbuild-wasm';

import {
    IProjectFile,
    IProjectManifest,
    IWebWarning,
    TWorkerRequest
} from './protocol';

const supportedExtensions: Readonly<Record<string, true>> = {
    js: true,
    mjs: true,
    cjs: true,
    json: true
};
const resolutionSuffixes: readonly string[] = [
    '',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '/index.js',
    '/index.mjs',
    '/index.cjs',
    '/index.json'
];

export type TProjectFileMap = ReadonlyMap<string, string>;
export type TEsbuildBuild = (options: BuildOptions) => Promise<BuildResult>;
type TProjectRequest = Extract<TWorkerRequest, { type: 'obfuscate-project' }>;

export interface IUploadedProjectBuild {
    readonly bundledCode: string;
    readonly reachablePaths: string[];
    readonly manifest: IProjectManifest;
    readonly warnings: IWebWarning[];
}

export function normalizeProjectPath(rawPath: string): string {
    let normalizedPath: string = rawPath.replace(/\\/g, '/');

    while (normalizedPath.startsWith('./')) {
        normalizedPath = normalizedPath.slice(2);
    }

    if (
        normalizedPath.length === 0 ||
        normalizedPath.includes('\0') ||
        normalizedPath.startsWith('/') ||
        /^[A-Za-z]:/.test(normalizedPath)
    ) {
        throw new Error(`Invalid project path: "${rawPath}".`);
    }

    const segments: string[] = normalizedPath.split('/');

    if (segments.some((segment: string): boolean => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(`Invalid project path: "${rawPath}".`);
    }

    const extensionIndex: number = normalizedPath.lastIndexOf('.');
    const extension: string = extensionIndex === -1
        ? ''
        : normalizedPath.slice(extensionIndex).toLowerCase();

    if (supportedExtensions[extension.slice(1)] === undefined) {
        throw new Error(`Unsupported project file type: "${rawPath}".`);
    }

    return segments.join('/');
}

export function createProjectFileMap(files: readonly IProjectFile[]): Map<string, string> {
    const fileMap: Map<string, string> = new Map();

    for (const file of files) {
        const normalizedPath: string = normalizeProjectPath(file.path);

        if (fileMap.has(normalizedPath)) {
            throw new Error(`Duplicate project path: "${normalizedPath}".`);
        }

        fileMap.set(normalizedPath, file.contents);
    }

    return fileMap;
}

function normalizeResolvedPath(importerPath: string, specifier: string): string | null {
    const segments: string[] = importerPath.split('/');

    segments.pop();

    for (const segment of specifier.replace(/\\/g, '/').split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }

        if (segment === '..') {
            if (segments.length === 0) {
                return null;
            }

            segments.pop();
            continue;
        }

        segments.push(segment);
    }

    return segments.join('/');
}

export function resolveProjectImport(
    fileMap: TProjectFileMap,
    importerPath: string,
    specifier: string
): string {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error(`Package import "${specifier}" cannot be resolved in the browser.`);
    }

    const basePath: string | null = normalizeResolvedPath(importerPath, specifier);

    if (basePath !== null) {
        for (const suffix of resolutionSuffixes) {
            const candidate: string = `${basePath}${suffix}`;

            if (fileMap.has(candidate)) {
                return candidate;
            }
        }
    }

    throw new Error(`Cannot resolve "${specifier}" imported by "${importerPath}".`);
}

function getResolverError(error: unknown): Error | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const resolverMessage: string | undefined = (<Partial<BuildFailure>>error).errors?.[0]?.text;

    if (
        resolverMessage?.startsWith('Cannot resolve "') !== true
        && resolverMessage?.startsWith('Package import "') !== true
    ) {
        return undefined;
    }

    return new Error(resolverMessage);
}


export async function buildUploadedProject(
    request: TProjectRequest,
    esbuildBuild: TEsbuildBuild
): Promise<IUploadedProjectBuild> {
    const fileMap: Map<string, string> = createProjectFileMap(request.files);
    const entryPath: string = normalizeProjectPath(request.entryPath);

    if (!fileMap.has(entryPath) || entryPath.toLowerCase().endsWith('.json')) {
        throw new Error(`Invalid project entry point: "${request.entryPath}".`);
    }

    const uploadedFilesPlugin: Plugin = {
        name: 'uploaded-files',
        setup: (build): void => {
            build.onResolve({ filter: /.*/ }, (resolveArguments) => {
                if (resolveArguments.kind === 'entry-point') {
                    return { path: entryPath, namespace: 'uploaded-file' };
                }

                return {
                    path: resolveProjectImport(
                        fileMap,
                        resolveArguments.importer,
                        resolveArguments.path
                    ),
                    namespace: 'uploaded-file'
                };
            });
            build.onLoad({ filter: /.*/, namespace: 'uploaded-file' }, (loadArguments) => ({
                contents: fileMap.get(loadArguments.path),
                loader: loadArguments.path.toLowerCase().endsWith('.json') ? 'json' : 'js'
            }));
        }
    };
    let result: BuildResult;

    try {
        result = await esbuildBuild({
            entryPoints: [entryPath],
            bundle: true,
            write: false,
            metafile: true,
            treeShaking: false,
            minify: false,
            target: 'es2018',
            platform: request.options.target === 'node' ? 'node' : 'browser',
            format: request.bundleFormat,
            ...(request.bundleFormat === 'iife' ? { globalName: 'ObfuscatedBundle' } : {}),
            plugins: [uploadedFilesPlugin],
            logLevel: 'silent'
        });
    } catch (error: unknown) {
        const resolverError: Error | undefined = getResolverError(error);

        if (resolverError !== undefined) {
            throw resolverError;
        }

        throw error;
    }
    const reachablePaths: string[] = Object.keys(result.metafile?.inputs ?? {})
        .map((inputPath: string): string => inputPath.startsWith('uploaded-file:')
            ? inputPath.slice('uploaded-file:'.length)
            : inputPath)
        .sort();
    const reachablePathSet: ReadonlySet<string> = new Set(reachablePaths);
    const ignoredPaths: string[] = [...fileMap.keys()]
        .filter((filePath: string): boolean => !reachablePathSet.has(filePath))
        .sort();
    const outputFile = result.outputFiles?.find((file): boolean => file.path.endsWith('.js'))
        ?? result.outputFiles?.[0];

    if (!outputFile) {
        throw new Error('Bundling did not produce JavaScript output.');
    }

    return {
        bundledCode: outputFile.text,
        reachablePaths,
        manifest: {
            includedPaths: reachablePaths,
            ignoredPaths
        },
        warnings: result.warnings.map((warning) => ({
            origin: 'bundler',
            message: warning.text,
            filePath: warning.location?.file,
            line: warning.location?.line,
            column: warning.location?.column
        }))
    };
}
