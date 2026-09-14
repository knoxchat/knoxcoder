/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_INPUT_HISTORY_LIMIT,
	knoxCreateInputHistory,
	knoxInputHistoryAdd,
	knoxInputHistoryNext,
	knoxInputHistoryPrev,
	knoxParseInputHistory,
	knoxSerializeInputHistory,
} from '../../common/knoxInputHistory.js';

suite('knox input history', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses and serializes string entries', () => {
		assert.deepStrictEqual(knoxParseInputHistory(undefined), []);
		assert.deepStrictEqual(knoxParseInputHistory('["a","","b"]'), ['a', 'b']);
		assert.deepStrictEqual(knoxParseInputHistory('{'), []);
		assert.strictEqual(knoxSerializeInputHistory(['x', 'y']), '["x","y"]');
	});

	test('ArrowUp walks back and restores the draft', () => {
		let state = knoxCreateInputHistory(['one', 'two']);
		const first = knoxInputHistoryPrev(state, 'draft');
		assert.strictEqual(first.value, 'two');
		state = first.state;
		const second = knoxInputHistoryPrev(state, 'ignored');
		assert.strictEqual(second.value, 'one');
		const back = knoxInputHistoryNext(second.state);
		assert.strictEqual(back.value, 'two');
		const draft = knoxInputHistoryNext(back.state);
		assert.strictEqual(draft.value, 'draft');
	});

	test('does not wrap past the oldest entry', () => {
		const state = knoxCreateInputHistory(['only']);
		const prev = knoxInputHistoryPrev(state, 'now');
		const again = knoxInputHistoryPrev(prev.state, 'now');
		assert.strictEqual(again.value, undefined);
		assert.strictEqual(again.state.index, 0);
	});

	test('add skips duplicates of the last entry and empty values', () => {
		let state = knoxCreateInputHistory(['hello']);
		state = knoxInputHistoryAdd(state, 'hello');
		assert.deepStrictEqual(state.entries, ['hello']);
		state = knoxInputHistoryAdd(state, '');
		assert.deepStrictEqual(state.entries, ['hello']);
		state = knoxInputHistoryAdd(state, 'next');
		assert.deepStrictEqual(state.entries, ['hello', 'next']);
		assert.strictEqual(state.index, 2);
	});

	test('caps stored entries', () => {
		const entries = Array.from({ length: KNOX_INPUT_HISTORY_LIMIT + 5 }, (_, i) => `e${i}`);
		const state = knoxCreateInputHistory(entries);
		assert.strictEqual(state.entries.length, KNOX_INPUT_HISTORY_LIMIT);
		assert.strictEqual(state.entries[0], 'e5');
	});
});
