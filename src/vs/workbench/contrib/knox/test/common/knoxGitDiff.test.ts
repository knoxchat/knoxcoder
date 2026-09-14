/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxBuildGitDisplayPaths,
	knoxFinalizeGitDiffFiles,
	knoxGitDiffTotals,
	knoxGitFileType,
	knoxParseDiffList,
	knoxParseDiffStats,
	knoxParseGitChangedFiles,
	knoxSortGitDiffFiles,
} from '../../common/knoxGitDiff.js';

suite('knox git diff (T5.11)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies file types', () => {
		assert.strictEqual(knoxGitFileType('src/foo.ts'), 'TS');
		assert.strictEqual(knoxGitFileType('go.mod'), 'MOD');
		assert.strictEqual(knoxGitFileType('.env.local'), 'ENV');
		assert.strictEqual(knoxGitFileType('README'), 'FILE');
	});

	test('parses unified diffs and sums hunks', () => {
		const parsed = knoxParseDiffStats([
			'diff --git a/src/a.ts b/src/a.ts',
			'index 111..222 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,2 +1,3 @@',
			' keep',
			'-old',
			'+new',
			'+more',
		].join('\n'));
		assert.ok(parsed);
		assert.strictEqual(parsed.filepath, 'src/a.ts');
		assert.strictEqual(parsed.additions, 2);
		assert.strictEqual(parsed.deletions, 1);
		assert.strictEqual(parsed.status, 'modified');
	});

	test('merges split diffs and disambiguates display paths', () => {
		const files = knoxParseDiffList([
			['diff --git a/pkg/a.ts b/pkg/a.ts', '@@ -1 +1 @@', '+one'].join('\n'),
			['diff --git a/lib/a.ts b/lib/a.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n'),
		]);
		const display = knoxBuildGitDisplayPaths(files);
		assert.deepStrictEqual(display.map(f => f.displayPath).sort(), ['lib/a.ts', 'pkg/a.ts']);
		const sorted = knoxSortGitDiffFiles(display);
		assert.strictEqual(sorted[0].filepath, 'lib/a.ts');
	});

	test('parses getGitChangedFiles payloads and totals', () => {
		const files = knoxFinalizeGitDiffFiles(knoxParseGitChangedFiles([
			{ filepath: 'src/a.ts', uri: 'file:///ws/src/a.ts', status: 'modified', additions: 3, deletions: 1 },
			{ filepath: 'bin.wasm', status: 'added', isBinary: true },
		]));
		assert.strictEqual(files.length, 2);
		assert.strictEqual(files[0].filepath, 'src/a.ts');
		assert.strictEqual(files[1].isBinary, true);
		assert.deepStrictEqual(knoxGitDiffTotals(files), { additions: 3, deletions: 1 });
	});
});
