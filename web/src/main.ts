/* eslint-disable complexity, max-lines, no-void */
import { strToU8, zipSync, Zippable } from 'fflate';

import { IOptions } from '../../src/interfaces/options/IOptions';
import { TOptionsPreset } from '../../src/types/options/TOptionsPreset';

import {
    maximalCompatibleVMOptions,
    optionControls,
    optionGroups,
    IOptionControlDescriptor
} from './options-schema';
import { OptionsState } from './options-state';
import { animateModePanel, animateResult, initializeMotion, setProcessingMotion } from './motion';
import { createProjectFileMap, normalizeProjectPath } from './project-files';
import {
    IOutputArtifact,
    IProjectFile,
    IWebWarning,
    TBundleFormat,
    TProjectOutputMode
} from './protocol';
import { TWorkerCompletionResponse, WorkerClient } from './worker-client';

type TInputMode = 'paste' | 'file' | 'project';
type TProgressResponse = Parameters<NonNullable<Parameters<WorkerClient['request']>[1]>>[0];

interface ISelectedFile extends IProjectFile {
    readonly bytes: number;
}

function requiredElement<TElement extends HTMLElement>(id: string): TElement {
    const element: HTMLElement | null = document.getElementById(id);

    if (element === null) {
        throw new Error(`Missing interface element: ${id}`);
    }

    return <TElement>element;
}

const version = requiredElement<HTMLSpanElement>('version');
const pasteName = requiredElement<HTMLInputElement>('paste-name');
const pasteSource = requiredElement<HTMLTextAreaElement>('paste-source');
const singleFileInput = requiredElement<HTMLInputElement>('single-file');
const singleFileMeta = requiredElement<HTMLParagraphElement>('single-file-meta');
const projectFilesInput = requiredElement<HTMLInputElement>('project-files');
const projectFolderInput = requiredElement<HTMLInputElement>('project-folder');
const projectSummary = requiredElement<HTMLParagraphElement>('project-summary');
const projectManifest = requiredElement<HTMLUListElement>('project-manifest');
const projectEntry = requiredElement<HTMLSelectElement>('project-entry');
const bundleFormatField = requiredElement<HTMLDivElement>('bundle-format-field');
const bundleFormat = requiredElement<HTMLSelectElement>('bundle-format');
const errorRegion = requiredElement<HTMLDivElement>('error-region');
const obfuscateButton = requiredElement<HTMLButtonElement>('obfuscate');
const cancelButton = requiredElement<HTMLButtonElement>('cancel');
const progress = requiredElement<HTMLSpanElement>('progress');
const optionControlsContainer = requiredElement<HTMLDivElement>('option-controls');
const optionsJson = requiredElement<HTMLTextAreaElement>('options-json');
const optionsError = requiredElement<HTMLDivElement>('options-error');
const applyOptionsButton = requiredElement<HTMLButtonElement>('apply-options');
const resultActions = requiredElement<HTMLDivElement>('result-actions');
const copyResultButton = requiredElement<HTMLButtonElement>('copy-result');
const downloadResultButton = requiredElement<HTMLButtonElement>('download-result');
const downloadAllButton = requiredElement<HTMLButtonElement>('download-all');
const resultMeta = requiredElement<HTMLParagraphElement>('result-meta');
const projectCounts = requiredElement<HTMLParagraphElement>('project-counts');
const resultPreview = requiredElement<HTMLElement>('result-preview');
const artifactDownloads = requiredElement<HTMLDivElement>('artifact-downloads');
const warningsSection = requiredElement<HTMLElement>('warnings-section');
const warningsContainer = requiredElement<HTMLDivElement>('warnings');

const workerClient: WorkerClient = new WorkerClient();
const textEncoder: TextEncoder = new TextEncoder();
const controlElements: Map<keyof IOptions, HTMLInputElement[] | HTMLSelectElement[] | HTMLTextAreaElement[]> = new Map();
let inputMode: TInputMode = 'paste';
let selectedFile: ISelectedFile | null = null;
let selectedProjectFiles: ISelectedFile[] = [];
let optionsState: OptionsState | null = null;
let isRunning: boolean = false;
let isLoadingPreset: boolean = true;
let currentArtifacts: readonly IOutputArtifact[] = [];
let artifactUrls: string[] = [];
let currentPreview: string = '';
let maximalVMButton: HTMLButtonElement | null = null;

version.textContent = `v${process.env.VERSION}`;

function clearError(): void {
    errorRegion.textContent = '';
}

function showError(message: string): void {
    errorRegion.textContent = message;
}

function revokeArtifactUrls(): void {
    for (const url of artifactUrls) {
        URL.revokeObjectURL(url);
    }

    artifactUrls = [];
}

function clearResult(): void {
    revokeArtifactUrls();
    currentArtifacts = [];
    currentPreview = '';
    resultPreview.textContent = '';
    resultMeta.textContent = 'Obfuscated output will appear here.';
    projectCounts.hidden = true;
    projectCounts.textContent = '';
    resultActions.hidden = true;
    downloadAllButton.hidden = true;
    artifactDownloads.replaceChildren();
    warningsContainer.replaceChildren();
    warningsSection.hidden = true;
}

function isCurrentInputValid(): boolean {
    if (inputMode === 'paste') {
        return pasteSource.value.trim().length > 0;
    }

    if (inputMode === 'file') {
        return selectedFile !== null;
    }

    return selectedProjectFiles.length > 0 && projectEntry.value.length > 0;
}

function updateObfuscateAvailability(): void {
    obfuscateButton.disabled = isRunning || isLoadingPreset || !isCurrentInputValid();
    cancelButton.disabled = !isRunning;
}

function setInputMode(mode: TInputMode): void {
    inputMode = mode;

    for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const selected: boolean = tab.dataset.mode === mode;

        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }

    for (const panel of document.querySelectorAll<HTMLElement>('[data-mode-panel]')) {
        const selected: boolean = panel.dataset.modePanel === mode;

        panel.hidden = !selected;

        if (selected) {
            animateModePanel(panel);
        }
    }

    clearError();
    clearResult();
    updateObfuscateAvailability();
}

function getProjectOutputMode(): TProjectOutputMode {
    const checked = document.querySelector<HTMLInputElement>('input[name="project-output"]:checked');

    return checked?.value === 'modules' ? 'modules' : 'bundle';
}

function refreshBundleFormatVisibility(): void {
    bundleFormatField.hidden = getProjectOutputMode() === 'modules';
}

function renderProjectManifest(): void {
    const totalBytes: number = selectedProjectFiles.reduce(
        (total: number, file: ISelectedFile): number => total + file.bytes,
        0
    );
    const javaScriptPaths: string[] = selectedProjectFiles
        .map((file: ISelectedFile): string => file.path)
        .filter((filePath: string): boolean => /\.(?:c|m)?js$/i.test(filePath))
        .sort();

    projectSummary.textContent = selectedProjectFiles.length === 0
        ? 'No project selected.'
        : `${selectedProjectFiles.length} files · ${totalBytes.toLocaleString()} bytes`;
    projectManifest.replaceChildren(...selectedProjectFiles
        .slice()
        .sort((left: ISelectedFile, right: ISelectedFile): number => left.path.localeCompare(right.path))
        .map((file: ISelectedFile): HTMLLIElement => {
            const item: HTMLLIElement = document.createElement('li');

            item.textContent = `${file.path} (${file.bytes.toLocaleString()} bytes)`;

            return item;
        }));
    projectEntry.replaceChildren(...javaScriptPaths.map((filePath: string): HTMLOptionElement => {
        const option: HTMLOptionElement = document.createElement('option');

        option.value = filePath;
        option.textContent = filePath;

        return option;
    }));
    projectEntry.disabled = javaScriptPaths.length === 0;

    if (javaScriptPaths.length > 0) {
        projectEntry.value = javaScriptPaths[0];
    }

    updateObfuscateAvailability();
}

async function selectProjectFiles(fileList: FileList | null): Promise<void> {
    if (fileList === null) {
        return;
    }

    clearError();

    try {
        const files: ISelectedFile[] = await Promise.all([...fileList].map(async (file: File): Promise<ISelectedFile> => {
            const rawPath: string = file.webkitRelativePath || file.name;
            const normalizedPath: string = normalizeProjectPath(rawPath);

            return {
                path: normalizedPath,
                contents: await file.text(),
                bytes: file.size
            };
        }));

        createProjectFileMap(files);
        selectedProjectFiles = files;
        renderProjectManifest();
        clearResult();
    } catch (error: unknown) {
        selectedProjectFiles = [];
        renderProjectManifest();
        showError(error instanceof Error ? error.message : String(error));
    }
}

async function selectSingleFile(file: File | undefined): Promise<void> {
    clearError();

    if (file === undefined) {
        selectedFile = null;
        singleFileMeta.textContent = 'No file selected.';
        updateObfuscateAvailability();

        return;
    }

    if (!/\.(?:c|m)?js$/i.test(file.name)) {
        selectedFile = null;
        singleFileMeta.textContent = 'No file selected.';
        showError(`Unsupported JavaScript file type: "${file.name}".`);
        updateObfuscateAvailability();

        return;
    }

    selectedFile = {
        path: file.name,
        contents: await file.text(),
        bytes: file.size
    };
    singleFileMeta.textContent = `${file.name} · ${file.size.toLocaleString()} bytes`;
    clearResult();
    updateObfuscateAvailability();
}

function updateOptionsJson(): void {
    if (optionsState === null) {
        return;
    }

    optionsJson.value = optionsState.jsonText;
    optionsError.textContent = optionsState.jsonError;
}

function readControlValue(
    descriptor: IOptionControlDescriptor,
    elements: HTMLInputElement[] | HTMLSelectElement[] | HTMLTextAreaElement[]
): IOptions[keyof IOptions] {
    const firstElement = elements[0];

    if (descriptor.kind === 'boolean') {
        return (<HTMLInputElement>firstElement).checked;
    }

    if (descriptor.kind === 'number') {
        return Number(firstElement.value);
    }

    if (descriptor.kind === 'checkbox-group') {
        return (<HTMLInputElement[]>elements)
            .filter((element: HTMLInputElement): boolean => element.checked)
            .map((element: HTMLInputElement): string => element.value);
    }

    if (descriptor.kind === 'textarea') {
        return firstElement.value
            .split('\n')
            .map((value: string): string => value.trim())
            .filter((value: string): boolean => value.length > 0);
    }
    if (descriptor.key === 'strictMode') {
        return firstElement.value === 'null'
            ? null
            : firstElement.value === 'true';
    }

    if (descriptor.key === 'seed') {
        const numericSeed: number = Number(firstElement.value);

        return firstElement.value.trim().length > 0 && Number.isFinite(numericSeed)
            ? numericSeed
            : firstElement.value;
    }

    return firstElement.value;
}

function refreshOptionControls(): void {
    if (optionsState === null) {
        return;
    }

    for (const descriptor of optionControls) {
        const elements = controlElements.get(descriptor.key);

        if (elements === undefined) {
            continue;
        }

        const value: IOptions[keyof IOptions] = optionsState.options[descriptor.key];
        const dependencies: readonly (keyof IOptions)[] = descriptor.dependsOn === undefined
            ? []
            : typeof descriptor.dependsOn === 'string'
                ? [descriptor.dependsOn]
                : descriptor.dependsOn;
        const disabled: boolean = dependencies.some(
            (dependency: keyof IOptions): boolean => !Boolean(optionsState?.options[dependency])
        );

        for (const element of elements) {
            element.disabled = disabled || isRunning || isLoadingPreset;

            if (descriptor.kind === 'boolean') {
                (<HTMLInputElement>element).checked = Boolean(value);
            } else if (descriptor.kind === 'checkbox-group') {
                (<HTMLInputElement>element).checked = Array.isArray(value)
                    && value.includes(<never>(<HTMLInputElement>element).value);
            } else if (descriptor.kind === 'textarea') {
                element.value = Array.isArray(value) ? value.join('\n') : '';
            } else {
                element.value = descriptor.key === 'strictMode'
                    ? String(value)
                    : String(value ?? '');
            }
        }
    }

    if (maximalVMButton !== null) {
        maximalVMButton.disabled = isRunning || isLoadingPreset;
    }

    updateOptionsJson();
}

async function loadPreset(preset: TOptionsPreset): Promise<void> {
    isLoadingPreset = true;
    progress.textContent = 'Loading preset…';
    refreshOptionControls();
    updateObfuscateAvailability();

    try {
        const response: TWorkerCompletionResponse = await workerClient.request({
            type: 'get-preset',
            preset
        });

        if (response.type !== 'preset') {
            throw new Error('The worker returned an unexpected preset response.');
        }

        if (optionsState === null) {
            optionsState = new OptionsState(response);
        } else {
            optionsState.replaceFromPreset(response.options, response.allowedOptionNames);
        }

        optionsJson.disabled = false;
        applyOptionsButton.disabled = false;
        clearError();
        progress.textContent = 'Idle';
    } catch (error: unknown) {
        const message: string = error instanceof Error ? error.message : String(error);

        if (message !== 'Superseded by a newer request.') {
            showError(message);
            progress.textContent = 'Options unavailable';
        }
    } finally {
        isLoadingPreset = false;
        refreshOptionControls();
        updateObfuscateAvailability();
    }
}

function createControl(descriptor: IOptionControlDescriptor): HTMLElement {
    const wrapper: HTMLDivElement = document.createElement('div');
    const label: HTMLLabelElement = document.createElement('label');
    const controlId: string = `option-${descriptor.key}`;
    let elements: HTMLInputElement[] | HTMLSelectElement[] | HTMLTextAreaElement[];

    wrapper.className = 'option-field';
    label.textContent = descriptor.label;

    if (descriptor.kind === 'select') {
        const select: HTMLSelectElement = document.createElement('select');

        select.id = controlId;
        select.replaceChildren(...(descriptor.values ?? []).map((value: string): HTMLOptionElement => {
            const option: HTMLOptionElement = document.createElement('option');

            option.value = value;
            option.textContent = value;

            return option;
        }));
        label.htmlFor = controlId;
        wrapper.append(label, select);
        elements = [select];
    } else if (descriptor.kind === 'checkbox-group') {
        const group: HTMLDivElement = document.createElement('div');
        const checkboxes: HTMLInputElement[] = (descriptor.values ?? []).map((value: string): HTMLInputElement => {
            const itemLabel: HTMLLabelElement = document.createElement('label');
            const checkbox: HTMLInputElement = document.createElement('input');

            checkbox.type = 'checkbox';
            checkbox.value = value;
            itemLabel.append(checkbox, document.createTextNode(value));
            group.append(itemLabel);

            return checkbox;
        });

        group.className = 'checkbox-group';
        wrapper.append(label, group);
        elements = checkboxes;
    } else if (descriptor.kind === 'textarea') {
        const textarea: HTMLTextAreaElement = document.createElement('textarea');

        textarea.id = controlId;
        textarea.rows = 3;
        label.htmlFor = controlId;
        wrapper.append(label, textarea);
        elements = [textarea];
    } else {
        const input: HTMLInputElement = document.createElement('input');

        input.id = controlId;
        input.type = descriptor.kind === 'boolean'
            ? 'checkbox'
            : descriptor.kind === 'number' ? 'number' : 'text';

        if (descriptor.kind === 'boolean') {
            input.className = 'switch';
            wrapper.classList.add('switch-field');
        }

        if (descriptor.min !== undefined) {
            input.min = String(descriptor.min);
        }
        if (descriptor.max !== undefined) {
            input.max = String(descriptor.max);
        }
        if (descriptor.step !== undefined) {
            input.step = String(descriptor.step);
        }

        label.htmlFor = controlId;
        wrapper.append(label, input);
        elements = [input];
    }

    controlElements.set(descriptor.key, elements);

    for (const element of elements) {
        element.addEventListener('change', (): void => {
            if (optionsState === null) {
                return;
            }

            const value: IOptions[keyof IOptions] = readControlValue(descriptor, elements);

            if (descriptor.key === 'optionsPreset') {
                void loadPreset(<TOptionsPreset>value);

                return;
            }

            optionsState.setFormValue(descriptor.key, <never>value);
            refreshOptionControls();
        });
    }

    return wrapper;
}

function createMaximalVMAction(): HTMLDivElement {
    const wrapper: HTMLDivElement = document.createElement('div');
    const button: HTMLButtonElement = document.createElement('button');
    const explanation: HTMLParagraphElement = document.createElement('p');

    wrapper.className = 'vm-profile-action';
    button.id = 'enable-all-vm-features';
    button.type = 'button';
    button.textContent = 'Enable all compatible VM features';
    button.disabled = true;
    explanation.className = 'muted';
    explanation.textContent = 'Uses the maximal synchronous profile. Async executor stays off because it conflicts with top-level wrapping. VM defenses can block DevTools execution.';
    button.addEventListener('click', (): void => {
        if (optionsState === null) {
            return;
        }

        optionsState.setFormValues(maximalCompatibleVMOptions);
        refreshOptionControls();
    });
    wrapper.append(button, explanation);
    maximalVMButton = button;

    return wrapper;
}

function renderOptionControls(): void {
    optionControlsContainer.replaceChildren(...optionGroups.map((groupName): HTMLFieldSetElement => {
        const fieldset: HTMLFieldSetElement = document.createElement('fieldset');
        const legend: HTMLLegendElement = document.createElement('legend');

        legend.textContent = groupName;
        fieldset.append(legend);

        if (groupName === 'VM') {
            fieldset.append(createMaximalVMAction());
        }

        fieldset.append(...optionControls
            .filter((descriptor: IOptionControlDescriptor): boolean => descriptor.group === groupName)
            .map(createControl));

        return fieldset;
    }));

    const optionsCount: HTMLElement | null = document.querySelector<HTMLElement>('#options-count');

    if (optionsCount !== null) {
        optionsCount.textContent = `${optionControls.length} controls`;
    }
}

function createArtifactBlob(artifact: IOutputArtifact): Blob {
    const data: BlobPart = typeof artifact.data === 'string'
        ? artifact.data
        : artifact.data.slice().buffer;

    return new Blob([data], { type: artifact.mimeType });
}

function triggerArtifactDownload(artifact: IOutputArtifact, url?: string): void {
    try {
        const link: HTMLAnchorElement = document.createElement('a');
        const objectUrl: string = url ?? URL.createObjectURL(createArtifactBlob(artifact));

        link.href = objectUrl;
        link.download = artifact.name;
        document.body.append(link);
        link.click();
        link.remove();

        if (url === undefined) {
            setTimeout((): void => URL.revokeObjectURL(objectUrl), 0);
        }
    } catch (error: unknown) {
        showError(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function renderWarnings(warnings: readonly IWebWarning[]): void {
    warningsContainer.replaceChildren();
    warningsSection.hidden = warnings.length === 0;

    if (warnings.length === 0) {
        return;
    }

    const warningsByFile: Map<string, IWebWarning[]> = new Map();

    for (const warning of warnings) {
        const filePath: string = warning.filePath ?? 'General';
        const groupedWarnings: IWebWarning[] = warningsByFile.get(filePath) ?? [];

        groupedWarnings.push(warning);
        warningsByFile.set(filePath, groupedWarnings);
    }

    for (const [filePath, groupedWarnings] of warningsByFile) {
        const group: HTMLDivElement = document.createElement('div');
        const heading: HTMLHeadingElement = document.createElement('h4');
        const list: HTMLUListElement = document.createElement('ul');

        heading.textContent = filePath;
        list.replaceChildren(...groupedWarnings.map((warning: IWebWarning): HTMLLIElement => {
            const item: HTMLLIElement = document.createElement('li');
            const location: string = warning.line === undefined
                ? ''
                : ` (${warning.line}:${warning.column ?? 0})`;

            item.textContent = `${warning.origin}: ${warning.message}${location}`;

            return item;
        }));
        group.append(heading, list);
        warningsContainer.append(group);
    }
}

function renderResult(response: Extract<TWorkerCompletionResponse, { type: 'success' }>, elapsed: number): void {
    clearResult();
    currentArtifacts = response.artifacts;
    currentPreview = response.preview;
    resultPreview.textContent = response.preview;
    resultMeta.textContent = `${textEncoder.encode(response.preview).byteLength.toLocaleString()} bytes · ${elapsed.toFixed(0)} ms`;
    resultActions.hidden = false;
    downloadAllButton.hidden = response.artifacts.length <= 1;

    if (response.projectManifest !== undefined) {
        projectCounts.hidden = false;
        projectCounts.textContent = `${response.projectManifest.includedPaths.length} included · ${response.projectManifest.ignoredPaths.length} ignored`;
    }

    artifactUrls = response.artifacts.map((artifact: IOutputArtifact): string => URL.createObjectURL(createArtifactBlob(artifact)));
    artifactDownloads.replaceChildren(...response.artifacts.map((artifact: IOutputArtifact, index: number): HTMLButtonElement => {
        const button: HTMLButtonElement = document.createElement('button');

        button.type = 'button';
        button.textContent = artifact.name;
        button.addEventListener('click', (): void => triggerArtifactDownload(artifact, artifactUrls[index]));

        return button;
    }));
    renderWarnings(response.warnings);
    animateResult();
}

async function startObfuscation(): Promise<void> {
    if (optionsState === null) {
        showError('Options are still loading.');

        return;
    }

    if (optionsState.jsonDirty && !optionsState.applyJson()) {
        updateOptionsJson();
        optionsJson.focus();

        return;
    }

    if (inputMode === 'paste' && pasteSource.value.trim().length === 0) {
        showError('Enter JavaScript to obfuscate.');

        return;
    }

    if (inputMode === 'file' && selectedFile === null) {
        showError('Choose a JavaScript file.');

        return;
    }

    if (inputMode === 'project' && (selectedProjectFiles.length === 0 || projectEntry.value.length === 0)) {
        showError('Choose a project with a JavaScript entry point.');

        return;
    }

    isRunning = true;
    clearError();
    clearResult();
    progress.textContent = 'Starting…';
    refreshOptionControls();
    updateObfuscateAvailability();
    setProcessingMotion(true);

    const startedAt: number = performance.now();
    const onProgress = (response: TProgressResponse): void => {
        const amount: string = response.total > 1 ? ` ${response.completed}/${response.total}` : '';

        progress.textContent = `${response.phase}${amount}`;
    };

    try {
        let response: TWorkerCompletionResponse;

        if (inputMode === 'paste') {
            response = await workerClient.request({
                type: 'obfuscate-source',
                name: pasteName.value.trim() || 'snippet.js',
                source: pasteSource.value,
                options: optionsState.options
            }, onProgress);
        } else if (inputMode === 'file') {
            const file: ISelectedFile = <ISelectedFile>selectedFile;

            response = await workerClient.request({
                type: 'obfuscate-source',
                name: file.path,
                source: file.contents,
                options: optionsState.options
            }, onProgress);
        } else {
            response = await workerClient.request({
                type: 'obfuscate-project',
                entryPath: projectEntry.value,
                files: selectedProjectFiles.map(({ path, contents }): IProjectFile => ({ path, contents })),
                outputMode: getProjectOutputMode(),
                bundleFormat: <TBundleFormat>bundleFormat.value,
                wasmUrl: new URL('assets/esbuild.wasm', document.baseURI).href,
                options: optionsState.options
            }, onProgress);
        }

        if (response.type !== 'success') {
            throw new Error('The worker returned an unexpected obfuscation response.');
        }

        renderResult(response, performance.now() - startedAt);
        progress.textContent = 'Complete';
    } catch (error: unknown) {
        const message: string = error instanceof Error ? error.message : String(error);

        if (message === 'Obfuscation cancelled.') {
            progress.textContent = 'Idle';
        } else {
            showError(message);
            progress.textContent = 'Failed';
        }
    } finally {
        isRunning = false;
        refreshOptionControls();
        updateObfuscateAvailability();
        setProcessingMotion(false);
    }
}

renderOptionControls();
refreshBundleFormatVisibility();
initializeMotion();

for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    tab.addEventListener('click', (): void => setInputMode(<TInputMode>tab.dataset.mode));
    tab.addEventListener('keydown', (event: KeyboardEvent): void => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }

        const tabs: HTMLButtonElement[] = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        const currentIndex: number = tabs.indexOf(tab);
        const direction: number = event.key === 'ArrowRight' ? 1 : -1;
        const nextTab: HTMLButtonElement = tabs[(currentIndex + direction + tabs.length) % tabs.length];

        nextTab.focus();
        nextTab.click();
    });
}

pasteSource.addEventListener('input', (): void => updateObfuscateAvailability());
singleFileInput.addEventListener('change', (): void => { void selectSingleFile(singleFileInput.files?.[0]); });
projectFilesInput.addEventListener('change', (): void => { void selectProjectFiles(projectFilesInput.files); });
projectFolderInput.addEventListener('change', (): void => { void selectProjectFiles(projectFolderInput.files); });
projectEntry.addEventListener('change', clearResult);
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="project-output"]')) {
    radio.addEventListener('change', (): void => {
        refreshBundleFormatVisibility();
        clearResult();
    });
}
bundleFormat.addEventListener('change', clearResult);
optionsJson.addEventListener('input', (): void => {
    optionsState?.setJsonText(optionsJson.value);
    optionsError.textContent = '';
});
applyOptionsButton.addEventListener('click', (): void => {
    if (optionsState?.applyJson()) {
        refreshOptionControls();
    } else {
        updateOptionsJson();
    }
});
obfuscateButton.addEventListener('click', (): void => { void startObfuscation(); });
cancelButton.addEventListener('click', (): void => {
    if (workerClient.cancel()) {
        isRunning = false;
        progress.textContent = 'Idle';
        refreshOptionControls();
        updateObfuscateAvailability();
        setProcessingMotion(false);
    }
});
copyResultButton.addEventListener('click', (): void => {
    void navigator.clipboard.writeText(currentPreview).catch((error: unknown): void => {
        showError(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    });
});
downloadResultButton.addEventListener('click', (): void => {
    if (currentArtifacts.length > 0) {
        triggerArtifactDownload(currentArtifacts[0], artifactUrls[0]);
    }
});
downloadAllButton.addEventListener('click', (): void => {
    const archiveEntries: Zippable = {};

    for (const artifact of currentArtifacts) {
        archiveEntries[artifact.name] = typeof artifact.data === 'string'
            ? strToU8(artifact.data)
            : artifact.data;
    }

    triggerArtifactDownload({
        name: 'obfuscated-output.zip',
        data: zipSync(archiveEntries),
        mimeType: 'application/zip'
    });
});
window.addEventListener('beforeunload', (): void => {
    revokeArtifactUrls();
    workerClient.dispose();
});

void loadPreset('default');
