import { assert } from 'chai';

import { JavaScriptObfuscator } from '../../../src/JavaScriptObfuscatorFacade';
import { IOptions } from '../../../src/interfaces/options/IOptions';
import {
    advancedOnlyOptionNames,
    maximalCompatibleVMOptions,
    optionControls
} from '../../../web/src/options-schema';
import { OptionsState } from '../../../web/src/options-state';

const defaultOptions: IOptions = JavaScriptObfuscator.getOptionsByPreset('default') as IOptions;
const allowedOptionNames: string[] = Object.keys(defaultOptions);

function createState(): OptionsState {
    return new OptionsState({ options: defaultOptions, allowedOptionNames });
}

describe('OptionsState', () => {
    it('represents every serializable option in forms or advanced JSON', () => {
        const representedOptionNames: string[] = [
            ...optionControls.map((control): string => control.key),
            ...advancedOnlyOptionNames
        ];
        const configurableOptionNames: string[] = Object.keys(defaultOptions)
            .filter((optionName: string): boolean => optionName !== 'config' && optionName !== 'exclude');

        assert.lengthOf(new Set(representedOptionNames), representedOptionNames.length);
        assert.deepEqual(representedOptionNames.sort(), configurableOptionNames.sort());
    });

    it('replaces every prior edit when applying a preset', () => {
        const state: OptionsState = createState();
        const lowOptions: IOptions = JavaScriptObfuscator.getOptionsByPreset('low-obfuscation') as IOptions;

        state.setFormValue('compact', false);
        state.replaceFromPreset(lowOptions);

        assert.deepEqual(state.options, lowOptions);
        assert.equal(state.jsonText, JSON.stringify(lowOptions, null, 2));
        assert.isFalse(state.jsonDirty);
        assert.equal(state.jsonError, '');
    });

    it('synchronizes form edits into normalized JSON', () => {
        const state: OptionsState = createState();

        state.setFormValue('compact', false);

        assert.isFalse(state.options.compact);
        assert.isFalse((JSON.parse(state.jsonText) as IOptions).compact);
    });

    it('applies the maximal compatible VM profile transactionally', () => {
        const state: OptionsState = createState();
        const vmBooleanOptionNames: (keyof IOptions)[] = optionControls
            .filter((control): boolean => control.group === 'VM' && control.kind === 'boolean')
            .map((control): keyof IOptions => control.key);

        state.setJsonText('{');
        state.setFormValues(maximalCompatibleVMOptions);

        for (const optionName of vmBooleanOptionNames) {
            assert.equal(
                state.options[optionName],
                optionName === 'vmAsyncExecutor' ? false : true,
                optionName
            );
        }
        assert.isTrue(state.options.stringArray);
        assert.deepEqual(state.options.vmTargetFunctions, []);
        assert.equal(state.options.vmTargetFunctionsMode, 'root');
        assert.equal(state.options.vmObfuscationThreshold, 1);
        assert.isFalse(state.jsonDirty);
        assert.equal(state.jsonError, '');
        assert.deepEqual(JSON.parse(state.jsonText), state.options);
    });

    it('synchronizes valid JSON edits into form state', () => {
        const state: OptionsState = createState();
        const editedOptions: IOptions = {
            ...state.options,
            controlFlowFlatteningThreshold: 0.25
        };

        state.setJsonText(JSON.stringify(editedOptions));

        assert.isTrue(state.applyJson());
        assert.equal(state.options.controlFlowFlatteningThreshold, 0.25);
        assert.equal(state.jsonText, JSON.stringify(editedOptions, null, 2));
        assert.isFalse(state.jsonDirty);
    });

    it('rejects non-object JSON without replacing valid options', () => {
        const state: OptionsState = createState();
        const validOptions: IOptions = state.options;

        state.setJsonText('[]');

        assert.isFalse(state.applyJson());
        assert.equal(state.jsonError, 'Options JSON must be an object.');
        assert.deepEqual(state.options, validOptions);
        assert.isTrue(state.jsonDirty);
    });

    it('rejects malformed JSON without replacing valid options', () => {
        const state: OptionsState = createState();
        const validOptions: IOptions = state.options;

        state.setJsonText('{');

        assert.isFalse(state.applyJson());
        assert.match(state.jsonError, /^Invalid JSON:/);
        assert.deepEqual(state.options, validOptions);
        assert.isTrue(state.jsonDirty);
    });

    it('rejects unknown keys without replacing valid options', () => {
        const state: OptionsState = createState();
        const validOptions: IOptions = state.options;

        state.setJsonText(JSON.stringify({ ...state.options, inventedOption: true }));

        assert.isFalse(state.applyJson());
        assert.equal(state.jsonError, 'Unknown option: "inventedOption".');
        assert.deepEqual(state.options, validOptions);
        assert.isTrue(state.jsonDirty);
    });
});
