/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { knoxIsCompactionBannerVisible, knoxParseLastCompaction } from '../../common/knoxCompaction.js';

suite('knox compaction (T5.10)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hides empty or no-op compaction payloads', () => {
		assert.strictEqual(knoxParseLastCompaction(null), null);
		assert.strictEqual(knoxParseLastCompaction({
			tokensSaved: 0,
			originalMessageCount: 4,
			compactedMessageCount: 4,
			summarized: false,
			deduplicated: false,
			summarizationMethod: 'none',
		}), null);
		assert.strictEqual(knoxIsCompactionBannerVisible(null), false);
	});

	test('keeps a real compaction with stats and summary', () => {
		const parsed = knoxParseLastCompaction({
			tokensSaved: 1200,
			originalMessageCount: 40,
			compactedMessageCount: 18,
			summarized: true,
			deduplicated: true,
			summarizationMethod: 'llm',
			summaryText: 'Kept the kernel plan.',
		});
		assert.ok(parsed);
		assert.strictEqual(parsed.summarizationMethod, 'llm');
		assert.strictEqual(parsed.summaryText, 'Kept the kernel plan.');
		assert.ok(knoxIsCompactionBannerVisible(parsed));
	});
});
