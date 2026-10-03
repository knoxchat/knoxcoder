/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IKnoxGuiQueuedMessage, KNOX_QUEUE_MAX, knoxGuiDequeue, knoxGuiEnqueue, knoxGuiNextToDrain, knoxGuiParseQueue, knoxGuiPromoteQueued, knoxGuiQueueForSession, knoxGuiSerializeQueue } from './knoxGuiQueue.js';

const msg = (id: string, text: string, sessionId = 's1'): IKnoxGuiQueuedMessage => ({ id, sessionId, text, createdAt: 1 });
const idle = { aborted: false, blockedByPendingTool: false, hasError: false, isStreaming: false };

suite('Knox GUI message queue (K-042)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('enqueue keeps order, ignores empty messages and caps the length', () => {
		let queue: IKnoxGuiQueuedMessage[] = [];
		queue = knoxGuiEnqueue(queue, msg('a', 'one'));
		queue = knoxGuiEnqueue(queue, msg('b', '   '));
		queue = knoxGuiEnqueue(queue, msg('c', 'two'));
		assert.deepStrictEqual(queue.map(m => m.id), ['a', 'c']);
		for (let i = 0; i < KNOX_QUEUE_MAX + 5; i++) {
			queue = knoxGuiEnqueue(queue, msg(`n${i}`, `m${i}`));
		}
		assert.strictEqual(queue.length, KNOX_QUEUE_MAX);
		assert.strictEqual(queue[queue.length - 1].id, `n${KNOX_QUEUE_MAX + 4}`);
	});

	test('messages drain per session in order, and only when the turn ended by itself', () => {
		const queue = [msg('a', 'one', 's2'), msg('b', 'two'), msg('c', 'three')];
		assert.strictEqual(knoxGuiNextToDrain(queue, 's1', idle)?.id, 'b');
		assert.strictEqual(knoxGuiNextToDrain(queue, 's1', { ...idle, aborted: true }), undefined, 'Stop never sends behind the user');
		assert.strictEqual(knoxGuiNextToDrain(queue, 's1', { ...idle, blockedByPendingTool: true }), undefined);
		assert.strictEqual(knoxGuiNextToDrain(queue, 's1', { ...idle, hasError: true }), undefined);
		assert.strictEqual(knoxGuiNextToDrain(queue, 's1', { ...idle, isStreaming: true }), undefined);
		assert.strictEqual(knoxGuiNextToDrain(queue, 's3', idle), undefined);
		assert.deepStrictEqual(knoxGuiQueueForSession(queue, 's1').map(m => m.id), ['b', 'c']);
	});

	test('dequeue and promote', () => {
		const queue = [msg('a', '1'), msg('b', '2'), msg('c', '3')];
		assert.deepStrictEqual(knoxGuiDequeue(queue, 'b').map(m => m.id), ['a', 'c']);
		assert.deepStrictEqual(knoxGuiPromoteQueued(queue, 'c').map(m => m.id), ['c', 'a', 'b']);
		assert.deepStrictEqual(knoxGuiPromoteQueued(queue, 'zzz').map(m => m.id), ['a', 'b', 'c']);
	});

	test('the queue survives a restart and drops corrupt entries', () => {
		const queue = [msg('a', 'one'), { ...msg('b', 'with image'), images: ['data:image/png;base64,AAA'] }];
		assert.deepStrictEqual(knoxGuiParseQueue(knoxGuiSerializeQueue(queue)), queue.map(m => ({ ...m, images: m.images })));
		assert.deepStrictEqual(knoxGuiParseQueue('{not json'), []);
		assert.deepStrictEqual(knoxGuiParseQueue(undefined), []);
		assert.deepStrictEqual(knoxGuiParseQueue(JSON.stringify([null, 3, { id: 'x' }, { id: 'y', sessionId: 's', text: '  ' }, { id: 'ok', sessionId: 's', text: 'hi', createdAt: 5 }])), [{ id: 'ok', sessionId: 's', text: 'hi', images: undefined, createdAt: 5 }]);
	});
});
