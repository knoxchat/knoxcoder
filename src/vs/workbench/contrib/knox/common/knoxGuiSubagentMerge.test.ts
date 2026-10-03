/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiParseSubagentMerges } from './knoxGuiSubagentMerge.js';

suite('Knox GUI subagent merge badges (K-025)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses applied, conflict and no-change children', () => {
		const out = [
			'### Child 1', '## Subagent (general)', 'Merge: applied to workspace (a.ts, b.ts).', '',
			'### Child 2', 'Merge: CONFLICT — patch not applied (a.ts). Patch kept at /tmp/x/two-ab12.patch. Reason:', 'error: patch failed', '',
			'### Child 3', 'Merge: child made no file changes.',
		].join('\n');
		const merges = knoxGuiParseSubagentMerges(out);
		assert.deepStrictEqual(merges.map(m => [m.label, m.status]), [['Child 1', 'applied'], ['Child 2', 'conflict'], ['Child 3', 'no-changes']]);
		assert.deepStrictEqual(merges[0].files, ['a.ts', 'b.ts']);
		assert.strictEqual(merges[1].patchPath, '/tmp/x/two-ab12.patch');
	});

	test('returns nothing for output without merge lines', () => {
		assert.deepStrictEqual(knoxGuiParseSubagentMerges('## Subagent (explore)\nok'), []);
		assert.deepStrictEqual(knoxGuiParseSubagentMerges(undefined), []);
	});
});
