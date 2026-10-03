/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { toolDisplayKind } from './knoxGuiChat.js';
import { knoxGuiParseToolSearch } from './knoxGuiToolSearch.js';

suite('Knox GUI tool search card (K-021)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses loaded, already available and no-match results', () => {
		const loaded = knoxGuiParseToolSearch({ names: ['git_log', 'git_blame'] }, 'Loaded: builtin_git_log, builtin_git_blame. Call them on your next step.');
		assert.deepStrictEqual(loaded.loaded, ['builtin_git_log', 'builtin_git_blame']);
		assert.strictEqual(loaded.requested, 'git_log, git_blame');

		const mixed = knoxGuiParseToolSearch({ query: 'git' }, 'Loaded: builtin_git_log. Call them on your next step.\nAlready available: builtin_git_diff.');
		assert.deepStrictEqual(mixed.already, ['builtin_git_diff']);
		assert.strictEqual(mixed.requested, 'git');

		const none = knoxGuiParseToolSearch({ query: 'zzz' }, 'No tool matched. Available to load: builtin_a, builtin_b.');
		assert.strictEqual(none.noMatch, true);
		assert.deepStrictEqual(none.loaded, []);
	});

	test('tool search has its own card kind', () => {
		assert.strictEqual(toolDisplayKind('builtin_tool_search'), 'tool-search');
	});
});
