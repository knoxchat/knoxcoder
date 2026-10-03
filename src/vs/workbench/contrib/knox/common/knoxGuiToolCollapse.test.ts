/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IKnoxGuiToolCall } from './knoxGuiState.js';
import { knoxGuiToolAutoCollapses, knoxGuiToolBodyCollapsed, knoxGuiToolToggle } from './knoxGuiToolCollapse.js';

function call(name: string, output: string, extra: Partial<IKnoxGuiToolCall> = {}): IKnoxGuiToolCall {
	return { id: 't', name, arguments: '{}', parsedArgs: {}, status: 'done', output, ...extra };
}

const LONG = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');

suite('Knox GUI tool result collapse (K-041)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('long read and search results collapse once done; short ones and edits stay open', () => {
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_read_file', LONG)), true);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_exact_search', LONG)), true);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_read_file', 'one\ntwo')), false);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_edit_file', LONG)), false);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_run_terminal_command', LONG, { parsedArgs: { command: 'ls' } })), false);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_ask_user', LONG)), false);
	});

	test('running or failed calls never auto-collapse', () => {
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_read_file', LONG, { status: 'calling' })), false);
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_read_file', LONG, { status: 'errored' })), false);
	});

	test('a very long single line collapses by size', () => {
		assert.strictEqual(knoxGuiToolAutoCollapses(call('builtin_read_file', 'x'.repeat(5000))), true);
	});

	test('the user choice wins over the automatic rule', () => {
		const long = call('builtin_read_file', LONG);
		assert.strictEqual(knoxGuiToolBodyCollapsed(long, { expanded: false, collapsed: false }), true);
		assert.strictEqual(knoxGuiToolBodyCollapsed(long, { expanded: true, collapsed: false }), false);
		const short = call('builtin_read_file', 'a');
		assert.strictEqual(knoxGuiToolBodyCollapsed(short, { expanded: false, collapsed: true }), true);
		assert.deepStrictEqual(knoxGuiToolToggle(true), { expanded: false, collapsed: true });
		assert.deepStrictEqual(knoxGuiToolToggle(false), { expanded: true, collapsed: false });
	});
});
