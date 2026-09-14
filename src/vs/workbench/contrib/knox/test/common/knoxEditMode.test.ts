/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxAddCodeToEdit,
	knoxApplyEditStatus,
	knoxCanSubmitEdit,
	knoxCodeToEditBasename,
	knoxCodeToEditCardTitle,
	knoxCodeToEditHasRange,
	knoxCodeToEditItemLabel,
	knoxCodeToEditPath,
	knoxEditContextProviders,
	knoxFocusEditState,
	knoxGetMultifileEditPrompt,
	knoxHashTriggerAt,
	knoxHasCodeToEdit,
	knoxIsCodeToEditEqual,
	knoxIsEditModeAndNoCodeToEdit,
	knoxIsSingleRangeEditOrInsertion,
	knoxParseCodeToEdit,
	knoxParseCodeToEditList,
	knoxParseEditStatusPayload,
	knoxRelativeEditPath,
	knoxRemoveCodeToEdit,
	knoxSetEditDone,
	knoxSubmitEdit,
	KNOX_DEFAULT_EDIT_MODE_STATE,
	KNOX_EDIT_DISALLOWED_CONTEXT_PROVIDERS,
	type IKnoxCodeToEdit,
	type IKnoxEditModeState,
} from '../../common/knoxEditMode.js';

suite('knox edit mode (T4.8)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const ranged: IKnoxCodeToEdit = {
		filepath: 'file:///ws/a.ts',
		contents: 'const a = 1;',
		range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
	};
	const file: IKnoxCodeToEdit = {
		filepath: 'file:///ws/b.ts',
		contents: 'export {}',
	};

	test('equals by path, contents, and optional range', () => {
		assert.ok(knoxIsCodeToEditEqual(ranged, { ...ranged }));
		assert.ok(!knoxIsCodeToEditEqual(ranged, file));
		assert.ok(!knoxIsCodeToEditEqual(ranged, { ...ranged, range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } } }));
		assert.ok(knoxIsCodeToEditEqual(file, { ...file }));
		assert.ok(knoxCodeToEditHasRange(ranged));
		assert.ok(!knoxCodeToEditHasRange(file));
	});

	test('add skips duplicates and remove matches by equality', () => {
		const once = knoxAddCodeToEdit([], ranged);
		assert.strictEqual(knoxAddCodeToEdit(once, ranged).length, 1);
		assert.strictEqual(knoxAddCodeToEdit(once, [file, ranged]).length, 2);
		assert.deepStrictEqual(knoxRemoveCodeToEdit([ranged, file], ranged), [file]);
	});

	test('single-range or empty insertion; multifile is not', () => {
		assert.strictEqual(knoxIsSingleRangeEditOrInsertion('agent', [ranged]), false);
		assert.strictEqual(knoxIsSingleRangeEditOrInsertion('edit', []), true);
		assert.strictEqual(knoxIsSingleRangeEditOrInsertion('edit', [ranged]), true);
		assert.strictEqual(knoxIsSingleRangeEditOrInsertion('edit', [file]), false);
		assert.strictEqual(knoxIsSingleRangeEditOrInsertion('edit', [ranged, file]), false);
	});

	test('blocks send in edit mode until a file is attached', () => {
		assert.strictEqual(knoxIsEditModeAndNoCodeToEdit('edit', []), true);
		assert.strictEqual(knoxIsEditModeAndNoCodeToEdit('edit', [file]), false);
		assert.strictEqual(knoxCanSubmitEdit('edit', [], false), false);
		assert.strictEqual(knoxCanSubmitEdit('edit', [file], false), true);
		assert.strictEqual(knoxCanSubmitEdit('edit', [file], true), false);
		assert.strictEqual(knoxCanSubmitEdit('agent', [], false), true);
		assert.ok(knoxHasCodeToEdit([file]));
	});

	test('allows only the GUI edit-status transitions', () => {
		let state: IKnoxEditModeState = { ...KNOX_DEFAULT_EDIT_MODE_STATE };
		assert.strictEqual(knoxApplyEditStatus(state, 'accepting').editStatus, 'not-started');
		state = knoxSubmitEdit(state, 'fix the type');
		assert.strictEqual(state.editStatus, 'streaming');
		assert.deepStrictEqual(state.previousInputs, ['fix the type']);
		state = knoxApplyEditStatus(state, 'accepting', 'file:///ws/a.ts');
		assert.strictEqual(state.editStatus, 'accepting');
		assert.strictEqual(state.fileAfterEdit, 'file:///ws/a.ts');
		state = knoxApplyEditStatus(state, 'accepting:full-diff');
		assert.strictEqual(state.editStatus, 'accepting:full-diff');
		state = knoxApplyEditStatus(state, 'accepting');
		assert.strictEqual(state.editStatus, 'accepting');
		state = knoxSetEditDone();
		assert.strictEqual(state.editStatus, 'done');
		assert.deepStrictEqual(state.previousInputs, []);
		assert.strictEqual(knoxFocusEditState().editStatus, 'not-started');
	});

	test('parses code-to-edit payloads and status from the protocol', () => {
		assert.deepStrictEqual(knoxParseCodeToEdit(ranged), ranged);
		assert.deepStrictEqual(knoxParseCodeToEditList([file, { nope: true }]), [file]);
		assert.strictEqual(knoxParseCodeToEdit({ filepath: '' }), undefined);
		assert.deepStrictEqual(
			knoxParseEditStatusPayload({ status: 'accepting', fileAfterEdit: 'a.ts' }),
			{ status: 'accepting', fileAfterEdit: 'a.ts' },
		);
		assert.strictEqual(knoxParseEditStatusPayload({ status: 'nope' }), undefined);
	});

	test('multifile prompt embeds relative paths and contents', () => {
		const prompt = knoxGetMultifileEditPrompt([file], ['/ws']);
		assert.ok(prompt.includes('b.ts'));
		assert.ok(prompt.includes('export {}'));
		assert.ok(prompt.includes('<files>'));
		assert.strictEqual(knoxRelativeEditPath('file:///ws/src/a.ts', ['/ws']), 'src/a.ts');
		assert.strictEqual(knoxCodeToEditBasename('file:///ws/src/a.ts'), 'a.ts');
		assert.ok(knoxCodeToEditPath('file:///tmp/x.ts').includes('x.ts'));
	});

	test('card title and item labels match GUI copy', () => {
		assert.ok(knoxCodeToEditCardTitle(0).length > 0);
		assert.ok(knoxCodeToEditCardTitle(2).includes('2'));
		assert.ok(knoxCodeToEditItemLabel(ranged).title.includes('1'));
		assert.ok(knoxCodeToEditItemLabel({
			filepath: 'a.ts',
			contents: '',
			range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
		}).isInsertion);
	});

	test('hash trigger does not cross spaces; edit filters providers', () => {
		assert.deepStrictEqual(knoxHashTriggerAt('#foo', 4), { at: 0, query: 'foo' });
		assert.strictEqual(knoxHashTriggerAt('x #a', 2), undefined);
		assert.ok(KNOX_EDIT_DISALLOWED_CONTEXT_PROVIDERS.has('diff'));
		assert.deepStrictEqual(
			knoxEditContextProviders([
				{ title: 'file', displayTitle: 'File', description: '', type: 'submenu' },
				{ title: 'diff', displayTitle: 'Diff', description: '', type: 'normal' },
			]).map(p => p.title),
			['file'],
		);
	});
});
