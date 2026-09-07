/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import {
	applyDebugAdapterMessage,
	createThrottledRefresher,
} from '../debug/debugTrackerLogic';

suite('applyDebugAdapterMessage', () => {
	test('marks thread stopped and continued', () => {
		const map = new Map<number, boolean>();
		assert.strictEqual(
			applyDebugAdapterMessage(map, {
				type: 'event',
				event: 'stopped',
				body: { threadId: 1 },
			}),
			true,
		);
		assert.strictEqual(map.get(1), true);

		assert.strictEqual(
			applyDebugAdapterMessage(map, {
				type: 'event',
				event: 'continued',
				body: { threadId: 1 },
			}),
			true,
		);
		assert.strictEqual(map.get(1), false);
	});

	test('allThreadsContinued clears stopped flags', () => {
		const map = new Map<number, boolean>([
			[1, true],
			[2, true],
		]);
		assert.strictEqual(
			applyDebugAdapterMessage(map, {
				type: 'event',
				event: 'continued',
				body: { allThreadsContinued: true },
			}),
			true,
		);
		assert.strictEqual(map.get(1), false);
		assert.strictEqual(map.get(2), false);
	});

	test('thread exited removes entry', () => {
		const map = new Map<number, boolean>([[3, true]]);
		assert.strictEqual(
			applyDebugAdapterMessage(map, {
				type: 'event',
				event: 'thread',
				body: { threadId: 3, reason: 'exited' },
			}),
			true,
		);
		assert.strictEqual(map.has(3), false);
	});

	test('ignores unrelated messages and no-op duplicates', () => {
		const map = new Map<number, boolean>([[1, true]]);
		assert.strictEqual(
			applyDebugAdapterMessage(map, { type: 'response' }),
			false,
		);
		assert.strictEqual(
			applyDebugAdapterMessage(map, {
				type: 'event',
				event: 'stopped',
				body: { threadId: 1 },
			}),
			false,
		);
	});
});

suite('createThrottledRefresher', () => {
	test('coalesces rapid schedule calls into one refresh', async () => {
		let count = 0;
		const refresher = createThrottledRefresher(() => {
			count += 1;
		}, 40);

		refresher.schedule();
		refresher.schedule();
		refresher.schedule();
		assert.strictEqual(count, 0);

		await new Promise((r) => setTimeout(r, 60));
		assert.strictEqual(count, 1);
		refresher.dispose();
	});

	test('flush runs pending refresh immediately', () => {
		let count = 0;
		const refresher = createThrottledRefresher(() => {
			count += 1;
		}, 5000);
		refresher.schedule();
		refresher.flush();
		assert.strictEqual(count, 1);
		refresher.dispose();
	});
});
