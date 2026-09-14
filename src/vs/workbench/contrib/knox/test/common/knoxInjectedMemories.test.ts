/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxInjectedMemoryItem } from '../../common/knoxChatTypes.js';
import {
	knoxInjectedMemoryIsActionable,
	knoxInjectedMemoryIsTimeout,
	knoxParseMemoryMode,
	knoxPartitionInjectedMemories,
} from '../../common/knoxInjectedMemories.js';

suite('knox injected memories (T5.12)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const semantic = (id: number, score: number, pinned = false): IKnoxInjectedMemoryItem => ({
		id,
		kind: 'semantic',
		title: `m${id}`,
		reason: 'hit',
		score,
		pinned,
	});

	test('parses brain/getConfig memory_mode', () => {
		assert.strictEqual(knoxParseMemoryMode({ config: { memory_mode: 'selective' } }), 'selective');
		assert.strictEqual(knoxParseMemoryMode({}), 'summarized');
	});

	test('collapses low scores only in selective mode', () => {
		const items = [semantic(1, 0.9), semantic(2, 0.4), { id: null, kind: 'goal', title: 'ship', reason: 'c' }];
		const all = knoxPartitionInjectedMemories(items, 'summarized');
		assert.strictEqual(all.visible.length, 3);
		assert.strictEqual(all.collapsed.length, 0);
		const selective = knoxPartitionInjectedMemories(items, 'selective');
		assert.strictEqual(selective.visible.length, 2);
		assert.strictEqual(selective.collapsed.length, 1);
		assert.strictEqual(selective.collapsed[0].id, 2);
	});

	test('timeout notices and actionable semantic items', () => {
		assert.ok(knoxInjectedMemoryIsTimeout([{ id: null, kind: 'timeout', title: '', reason: '' }]));
		assert.ok(knoxInjectedMemoryIsActionable(semantic(1, 0.8)));
		assert.ok(!knoxInjectedMemoryIsActionable({ id: 1, kind: 'goal', title: 'g', reason: '' }));
	});
});
