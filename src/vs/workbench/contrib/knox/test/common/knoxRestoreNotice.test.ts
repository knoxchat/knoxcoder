/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KnoxRestoreNoticeCache,
	knoxFormatRestoreNotice,
} from '../../common/knoxRestoreNotice.js';

suite('knox restore notice (T2.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formats the restore notice exactly like Core formatRestoreNotice', () => {
		const notice = knoxFormatRestoreNotice({
			checkpointId: 'cp-1',
			description: 'before refactor',
			restoredFiles: ['src/a.ts', 'src/b.ts'],
			memoryRewound: false,
		});
		assert.ok(notice.startsWith('## Workspace restore'));
		assert.ok(notice.includes('restored to checkpoint cp-1 (before refactor).'));
		assert.ok(notice.includes('Restored files: src/a.ts, src/b.ts'));
		assert.ok(notice.includes('Memory was not rewound.'));
		assert.ok(notice.includes('rewind_memory=true'));
		assert.ok(notice.endsWith('Do not assume later edits still exist. Re-read files before editing.'));
	});

	test('uses the checkpoint-details fallback when no files are listed', () => {
		const notice = knoxFormatRestoreNotice({
			checkpointId: 'cp-2',
			restoredFiles: [],
			memoryRewound: true,
			memoryMessage: 'rewound to turn 3',
		});
		assert.ok(notice.includes('Restored files: (see checkpoint details)'));
		assert.ok(notice.includes('Working memory was rewound to this checkpoint. rewound to turn 3'));
	});

	test('caps the file list at 20 and reports the remainder', () => {
		const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
		const notice = knoxFormatRestoreNotice({ checkpointId: 'cp-3', restoredFiles: files });
		assert.ok(notice.includes('src/f19.ts'));
		assert.ok(!notice.includes('src/f20.ts'));
		assert.ok(notice.includes('(+5 more)'));
	});

	test('omits the description parenthetical when absent', () => {
		const notice = knoxFormatRestoreNotice({ checkpointId: 'cp-4', restoredFiles: ['a.ts'] });
		assert.ok(notice.includes('restored to checkpoint cp-4.'));
		assert.ok(!notice.includes('cp-4 ('));
	});

	test('cache returns the notice once for the matching session', () => {
		const cache = new KnoxRestoreNoticeCache();
		assert.strictEqual(cache.get('s1'), null);
		assert.strictEqual(cache.pending, false);

		cache.set('s1', 'notice');
		assert.strictEqual(cache.get('s2'), null, 'a different session must not see it');
		assert.strictEqual(cache.get('s1'), 'notice');
		assert.strictEqual(cache.pending, true);

		cache.clear();
		assert.strictEqual(cache.get('s1'), null);
		assert.strictEqual(cache.pending, false);
	});

	test('a second restore overwrites the pending notice', () => {
		const cache = new KnoxRestoreNoticeCache();
		cache.set('s1', 'first');
		cache.set('s1', 'second');
		assert.strictEqual(cache.get('s1'), 'second');
	});
});