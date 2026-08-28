import { readFileSync } from 'fs';
import * as path from 'path';

import { assert } from 'chai';
import * as esbuild from 'esbuild-wasm';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';
import { IOptions } from '../../../src/interfaces/options/IOptions';
import {
    buildUploadedProject,
    createProjectFileMap,
    normalizeProjectPath,
    resolveProjectImport
} from '../../../web/src/project-files';
import { IProjectFile, TWorkerRequest } from '../../../web/src/protocol';

type TProjectRequest = Extract<TWorkerRequest, { type: 'obfuscate-project' }>;

const defaultOptions: IOptions = JavaScriptObfuscator.getOptionsByPreset('default') as IOptions;

function createRequest(files: IProjectFile[], entryPath: string = 'main.js'): TProjectRequest {
    return {
        id: 1,
        type: 'obfuscate-project',
        entryPath,
        files,
        outputMode: 'bundle',
        bundleFormat: 'esm',
        wasmUrl: '',
        options: defaultOptions
    };
}

describe('ProjectFiles', () => {
    describe('normalizeProjectPath', () => {
        it('normalizes folder paths and Windows separators', () => {
            assert.equal(normalizeProjectPath('./folder\\main.js'), 'folder/main.js');
        });

        for (const invalidPath of ['../main.js', '/main.js', 'C:\\main.js', 'a/../main.js', 'a//main.js']) {
            it(`rejects invalid path ${invalidPath}`, () => {
                assert.throws(() => normalizeProjectPath(invalidPath), 'Invalid project path');
            });
        }

        it('rejects unsupported file extensions', () => {
            assert.throws(
                () => normalizeProjectPath('notes.txt'),
                'Unsupported project file type: "notes.txt".'
            );
        });
    });

    describe('createProjectFileMap', () => {
        it('rejects duplicate normalized paths', () => {
            assert.throws(
                () => createProjectFileMap([
                    { path: './main.js', contents: 'one' },
                    { path: 'main.js', contents: 'two' }
                ]),
                'Duplicate project path: "main.js".'
            );
        });
    });

    describe('resolveProjectImport', () => {
        const fileMap: ReadonlyMap<string, string> = createProjectFileMap([
            { path: 'exact.mjs', contents: '' },
            { path: 'extension.js', contents: '' },
            { path: 'folder/index.cjs', contents: '' },
            { path: 'nested/importer.js', contents: '' }
        ]);

        it('resolves exact paths', () => {
            assert.equal(resolveProjectImport(fileMap, 'main.js', './exact.mjs'), 'exact.mjs');
        });

        it('resolves extension candidates', () => {
            assert.equal(resolveProjectImport(fileMap, 'main.js', './extension'), 'extension.js');
        });

        it('resolves index candidates', () => {
            assert.equal(resolveProjectImport(fileMap, 'main.js', './folder'), 'folder/index.cjs');
        });

        it('resolves parent paths inside the project', () => {
            assert.equal(resolveProjectImport(fileMap, 'nested/importer.js', '../exact.mjs'), 'exact.mjs');
        });

        it('returns the concrete missing-relative error', () => {
            assert.throws(
                () => resolveProjectImport(fileMap, 'main.js', './missing'),
                'Cannot resolve "./missing" imported by "main.js".'
            );
        });

        it('returns the concrete bare-package error', () => {
            assert.throws(
                () => resolveProjectImport(fileMap, 'main.js', 'react'),
                'Package import "react" cannot be resolved in the browser.'
            );
        });
    });

    describe('buildUploadedProject', () => {
        it('allows cycles and reports deterministic reachable and ignored paths', async () => {
            const result = await buildUploadedProject(createRequest([
                { path: 'main.js', contents: 'import { value } from "./cycle.js"; console.log(value);' },
                { path: 'cycle.js', contents: 'import "./main.js"; export const value = 42;' },
                { path: 'unused.js', contents: 'throw new Error("unused");' }
            ]), esbuild.build);

            assert.deepEqual(result.reachablePaths, ['cycle.js', 'main.js']);
            assert.deepEqual(result.manifest.includedPaths, ['cycle.js', 'main.js']);
            assert.deepEqual(result.manifest.ignoredPaths, ['unused.js']);
        });

        it('builds the fixture dependency graph without the unused file', async () => {
            const fixtureDirectory: string = path.resolve(
                __dirname,
                '../../fixtures/web-interface-project'
            );
            const files: IProjectFile[] = ['main.js', 'math.js', 'unused.js'].map(
                (fileName: string): IProjectFile => ({
                    path: fileName,
                    contents: readFileSync(path.join(fixtureDirectory, fileName), 'utf8')
                })
            );
            const result = await buildUploadedProject(createRequest(files), esbuild.build);

            assert.deepEqual(result.manifest.includedPaths, ['main.js', 'math.js']);
            assert.deepEqual(result.manifest.ignoredPaths, ['unused.js']);
            assert.notInclude(result.bundledCode, './math.js');
        });
    });
});
