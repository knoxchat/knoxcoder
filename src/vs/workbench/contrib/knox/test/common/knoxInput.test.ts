/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import {
	KNOX_DEFAULT_INPUT_FONT_SIZE,
	KNOX_INPUT_LANGUAGE_ID,
	KNOX_INPUT_MAX_LINES,
	KNOX_INPUT_MIN_LINES,
	KNOX_INPUT_SCHEME,
	KNOX_INPUT_VERTICAL_PADDING,
	KNOX_INPUT_WORD_WRAP,
	KNOX_MAX_INPUT_FONT_SIZE,
	KNOX_MIN_INPUT_FONT_SIZE,
	knoxInputContentHeight,
	knoxInputEditorFontOptions,
	knoxInputFontSize,
	knoxInputLineHeight,
	knoxInputPlaceholder,
} from '../../common/knoxInput.js';
import {
	knoxInputKeyAction,
	knoxSubmitNoContext,
	knoxUseActiveFile,
} from '../../common/knoxInputKeys.js';

suite('knox input (T4.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('locks markdown language, wrap, and in-memory scheme', () => {
		assert.strictEqual(KNOX_INPUT_LANGUAGE_ID, 'markdown');
		assert.strictEqual(KNOX_INPUT_WORD_WRAP, 'on');
		assert.strictEqual(KNOX_INPUT_SCHEME, 'knox-input');
	});

	test('uses empty-thread vs follow-up placeholder, and edit-mode copy', () => {
		assert.ok(knoxInputPlaceholder(0).includes('@'));
		assert.notStrictEqual(knoxInputPlaceholder(0), knoxInputPlaceholder(1));
		assert.strictEqual(knoxInputPlaceholder(1), knoxInputPlaceholder(12));
		assert.ok(knoxInputPlaceholder(0, 'edit').includes('#'));
		assert.notStrictEqual(knoxInputPlaceholder(0), knoxInputPlaceholder(0, 'edit'));
	});

	test('reads font size from config.ui with GUI min/max', () => {
		assert.strictEqual(knoxInputFontSize(undefined), KNOX_DEFAULT_INPUT_FONT_SIZE);
		assert.strictEqual(knoxInputFontSize({}), KNOX_DEFAULT_INPUT_FONT_SIZE);
		assert.strictEqual(knoxInputFontSize({ fontSize: '14' }), KNOX_DEFAULT_INPUT_FONT_SIZE);
		assert.strictEqual(knoxInputFontSize({ fontSize: 18 }), 18);
		assert.strictEqual(knoxInputFontSize({ fontSize: 18.6 }), 19);
		assert.strictEqual(knoxInputFontSize({ fontSize: 1 }), KNOX_MIN_INPUT_FONT_SIZE);
		assert.strictEqual(knoxInputFontSize({ fontSize: 99 }), KNOX_MAX_INPUT_FONT_SIZE);
	});

	test('editor font options always wrap and match line height', () => {
		const options = knoxInputEditorFontOptions({ fontSize: 16 });
		assert.strictEqual(options.wordWrap, 'on');
		assert.strictEqual(options.fontSize, 16);
		assert.strictEqual(options.lineHeight, knoxInputLineHeight(16));
		assert.strictEqual(knoxInputLineHeight(14), 21);
	});

	test('clamps editor height between min and max lines', () => {
		const fontSize = 14;
		const lineHeight = knoxInputLineHeight(fontSize);
		const min = KNOX_INPUT_MIN_LINES * lineHeight + KNOX_INPUT_VERTICAL_PADDING * 2;
		const max = KNOX_INPUT_MAX_LINES * lineHeight + KNOX_INPUT_VERTICAL_PADDING * 2;
		assert.strictEqual(knoxInputContentHeight(0, fontSize), min);
		assert.strictEqual(knoxInputContentHeight(min + 10, fontSize), min + 10);
		assert.strictEqual(knoxInputContentHeight(max + 80, fontSize), max);
	});
});

suite('knox input keys (T4.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const idle = {
		atStart: false,
		atEnd: false,
		streaming: false,
		useActiveFile: false,
		suggestVisible: false,
	};

	function key(partial: Partial<{ keyCode: KeyCode; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }>) {
		return {
			keyCode: KeyCode.Unknown,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			...partial,
		};
	}

	test('toggles current-file context with Alt-Enter', () => {
		assert.strictEqual(knoxUseActiveFile(undefined), false);
		assert.strictEqual(knoxUseActiveFile({ defaultContext: ['activeFile'] }), true);
		assert.strictEqual(knoxSubmitNoContext(false, false), true);
		assert.strictEqual(knoxSubmitNoContext(false, true), false);
		assert.strictEqual(knoxSubmitNoContext(true, false), false);
		assert.strictEqual(knoxSubmitNoContext(true, true), true);
	});

	test('Enter and Mod-Enter send; Shift-Enter is a newline', () => {
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Enter }), idle),
			{ kind: 'submit', noContext: true },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Enter, metaKey: true }), idle),
			{ kind: 'submit', noContext: true },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Enter, shiftKey: true }), idle),
			{ kind: 'newline' },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Enter, altKey: true }), { ...idle, useActiveFile: true }),
			{ kind: 'submit', noContext: true },
		);
	});

	test('Enter is a no-op while streaming; Mod-Backspace cancels', () => {
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Enter }), { ...idle, streaming: true }),
			{ kind: 'ignore', consume: true },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Backspace, metaKey: true }), { ...idle, streaming: true }),
			{ kind: 'cancelStream', consume: true },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Backspace, ctrlKey: true }), idle),
			{ kind: 'cancelStream', consume: false },
		);
	});

	test('ArrowUp/Down only at the document edges', () => {
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.UpArrow }), { ...idle, atStart: true }),
			{ kind: 'historyPrev' },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.UpArrow }), idle),
			{ kind: 'none' },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.DownArrow }), { ...idle, atEnd: true }),
			{ kind: 'historyNext' },
		);
		assert.deepStrictEqual(
			knoxInputKeyAction(key({ keyCode: KeyCode.Escape }), idle),
			{ kind: 'escape' },
		);
	});

	test('leaves Enter/arrows/Escape to suggest when it is open', () => {
		const suggest = { ...idle, suggestVisible: true, atStart: true, atEnd: true };
		assert.deepStrictEqual(knoxInputKeyAction(key({ keyCode: KeyCode.Enter }), suggest), { kind: 'none' });
		assert.deepStrictEqual(knoxInputKeyAction(key({ keyCode: KeyCode.UpArrow }), suggest), { kind: 'none' });
		assert.deepStrictEqual(knoxInputKeyAction(key({ keyCode: KeyCode.Escape }), suggest), { kind: 'none' });
	});
});
