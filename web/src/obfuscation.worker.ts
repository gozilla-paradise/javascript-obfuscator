/* eslint-disable no-void */
import 'reflect-metadata';

import * as esbuild from 'esbuild-wasm';
import { strToU8, zipSync, Zippable } from 'fflate';

import { JavaScriptObfuscator } from '../../src/JavaScriptObfuscatorFacade';
import { IOptions } from '../../src/interfaces/options/IOptions';
import { IObfuscationResult } from '../../src/interfaces/source-code/IObfuscationResult';
import { TInputOptions } from '../../src/types/options/TInputOptions';
import { Utils } from '../../src/utils/Utils';

import { buildUploadedProject, createProjectFileMap, IUploadedProjectBuild } from './project-files';
import {
    IOutputArtifact,
    IWebWarning,
    TWorkerRequest,
    TWorkerResponse
} from './protocol';

interface IWorkerScope {
    postMessage: (response: TWorkerResponse) => void;
    addEventListener: (
        type: 'message',
        listener: (event: MessageEvent<TWorkerRequest>) => void
    ) => void;
}

const workerScope: IWorkerScope = <IWorkerScope><unknown>self;
let esbuildInitialization: Promise<void> | null = null;

function postResponse(response: TWorkerResponse): void {
    workerScope.postMessage(response);
}

function postProgress(id: number, phase: string, completed: number, total: number): void {
    postResponse({ id, type: 'progress', phase, completed, total });
}

function clonePreset(preset: Extract<TWorkerRequest, { type: 'get-preset' }>): IOptions {
    const options: TInputOptions = JavaScriptObfuscator.getOptionsByPreset(preset.preset);
    const clonedOptions: TInputOptions = <TInputOptions>JSON.parse(JSON.stringify(options));

    delete clonedOptions.config;
    delete clonedOptions.exclude;

    return <IOptions>clonedOptions;
}

function getOutputName(inputName: string): string {
    const fileName: string = inputName.split('/').pop() ?? 'snippet.js';
    const extensionIndex: number = fileName.lastIndexOf('.');
    const stem: string = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;

    return `${stem}.obfuscated.js`;
}

function mapWarnings(result: IObfuscationResult, filePath: string): IWebWarning[] {
    return result.getWarnings().map((warning) => ({
        origin: 'obfuscator',
        message: warning.message,
        filePath,
        code: warning.code,
        line: warning.location?.line,
        column: warning.location?.column
    }));
}

function obfuscateSource(
    source: string,
    inputName: string,
    options: IOptions,
    useOutputNameAsInput: boolean = false
): { artifacts: IOutputArtifact[]; preview: string; warnings: IWebWarning[] } {
    const outputName: string = getOutputName(inputName);
    const result: IObfuscationResult = JavaScriptObfuscator.obfuscate(source, {
        ...options,
        inputFileName: useOutputNameAsInput ? outputName : inputName,
        sourceMapFileName: `${outputName}.map`
    });
    const preview: string = result.getObfuscatedCode();
    const artifacts: IOutputArtifact[] = [
        { name: outputName, data: preview, mimeType: 'text/javascript;charset=utf-8' }
    ];
    const sourceMap: string = result.getSourceMap();

    if (sourceMap.length > 0) {
        artifacts.push({
            name: `${outputName}.map`,
            data: sourceMap,
            mimeType: 'application/json;charset=utf-8'
        });
    }

    return { artifacts, preview, warnings: mapWarnings(result, inputName) };
}

async function ensureEsbuild(wasmUrl: string): Promise<void> {
    esbuildInitialization ??= esbuild.initialize({ wasmURL: wasmUrl, worker: false });
    await esbuildInitialization;
}

function obfuscateProjectModules(
    request: Extract<TWorkerRequest, { type: 'obfuscate-project' }>,
    project: IUploadedProjectBuild
): { artifacts: IOutputArtifact[]; preview: string; warnings: IWebWarning[] } {
    const fileMap: Map<string, string> = createProjectFileMap(request.files);
    const archiveEntries: Zippable = {};
    const warnings: IWebWarning[] = [...project.warnings];
    let preview: string = '';
    let sourceIndex: number = 0;

    for (let index: number = 0; index < project.reachablePaths.length; index++) {
        const filePath: string = project.reachablePaths[index];
        const source: string | undefined = fileMap.get(filePath);
        const archivePath: string = `obfuscated/${filePath}`;

        if (source === undefined) {
            throw new Error(`Missing uploaded project file: "${filePath}".`);
        }

        postProgress(request.id, `Obfuscating ${index + 1}/${project.reachablePaths.length}`, index, project.reachablePaths.length);

        if (filePath.toLowerCase().endsWith('.json')) {
            archiveEntries[archivePath] = strToU8(source);
            continue;
        }

        const slashIndex: number = filePath.lastIndexOf('/');
        const basename: string = slashIndex === -1 ? filePath : filePath.slice(slashIndex + 1);
        const identifiersPrefix: string = Utils.getIdentifiersPrefixForMultipleSources(
            request.options.identifiersPrefix,
            sourceIndex
        );
        const result: IObfuscationResult = JavaScriptObfuscator.obfuscate(source, {
            ...request.options,
            identifiersPrefix,
            inputFileName: filePath,
            sourceMapFileName: `${basename}.map`
        });
        const obfuscatedCode: string = result.getObfuscatedCode();
        const sourceMap: string = result.getSourceMap();

        sourceIndex++;
        archiveEntries[archivePath] = strToU8(obfuscatedCode);
        warnings.push(...mapWarnings(result, filePath));
        if (filePath === request.entryPath || preview.length === 0) {
            preview = obfuscatedCode;
        }

        if (sourceMap.length > 0) {
            archiveEntries[`${archivePath}.map`] = strToU8(sourceMap);
        }
    }

    postProgress(request.id, 'Packaging', project.reachablePaths.length, project.reachablePaths.length);

    return {
        artifacts: [{
            name: 'obfuscated-project.zip',
            data: zipSync(archiveEntries),
            mimeType: 'application/zip'
        }],
        preview,
        warnings
    };
}

async function handleProjectRequest(
    request: Extract<TWorkerRequest, { type: 'obfuscate-project' }>
): Promise<void> {
    postProgress(request.id, 'Initializing', 0, 1);
    await ensureEsbuild(request.wasmUrl);
    postProgress(request.id, 'Resolving dependencies', 0, request.files.length);
    postProgress(request.id, 'Bundling', 0, 1);

    const project: IUploadedProjectBuild = await buildUploadedProject(request, esbuild.build);

    if (request.outputMode === 'modules') {
        const output = obfuscateProjectModules(request, project);
        postResponse({
            id: request.id,
            type: 'success',
            ...output,
            projectManifest: project.manifest
        });

        return;
    }

    postProgress(request.id, 'Obfuscating 1/1', 0, 1);
    const output = obfuscateSource(
        project.bundledCode,
        request.entryPath,
        request.options,
        true
    );
    const combinedWarnings: IWebWarning[] = [...project.warnings, ...output.warnings];
    postProgress(request.id, 'Packaging', 1, 1);
    postResponse({
        id: request.id,
        type: 'success',
        artifacts: output.artifacts,
        preview: output.preview,
        warnings: combinedWarnings,
        projectManifest: project.manifest
    });
}

workerScope.addEventListener('message', (event: MessageEvent<TWorkerRequest>): void => {
    const request: TWorkerRequest = event.data;

    void (async (): Promise<void> => {
        try {
            if (request.type === 'get-preset') {
                const defaultOptions: IOptions = clonePreset({ ...request, preset: 'default' });
                postResponse({
                    id: request.id,
                    type: 'preset',
                    options: clonePreset(request),
                    allowedOptionNames: Object.keys(defaultOptions)
                });

                return;
            }

            if (request.type === 'obfuscate-source') {
                postProgress(request.id, 'Obfuscating 1/1', 0, 1);
                const output = obfuscateSource(request.source, request.name, request.options);
                postProgress(request.id, 'Packaging', 1, 1);
                postResponse({ id: request.id, type: 'success', ...output });

                return;
            }

            await handleProjectRequest(request);
        } catch (error: unknown) {
            postResponse({
                id: request.id,
                type: 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    })();
});
