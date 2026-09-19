/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KnoxGuiBridge } from '../../common/knoxGuiBridge.js';
import { IKnoxGuiMessage } from '../../common/knoxGuiProtocol.js';

/**
 * T0.3: protocol assertions carry **names and payloads**, not just ids.
 * `knoxParityMatrix.test.ts` string equality is a wiring inventory, not a tick.
 * Payload expectations mirror `knox/core/protocol/ideWebview.ts`.
 */
suite('Knox protocol payloads (T0.3)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function captureBridge(posts: IKnoxGuiMessage[]): KnoxGuiBridge {
		const bridge = store.add(new KnoxGuiBridge());
		bridge.bindExtHost({
			async $request() { return undefined; },
			async $post(message) { posts.push(message); },
		});
		return bridge;
	}

	/** Wait until `posts` contains a message of `messageType` (post is async). */
	async function waitForPost(posts: IKnoxGuiMessage[], messageType: string): Promise<IKnoxGuiMessage> {
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline) {
			const found = posts.find(item => item.messageType === messageType);
			if (found) {
				return found;
			}
			await new Promise(resolve => setTimeout(resolve, 1));
		}
		assert.fail(`${messageType} was never posted`);
	}

	test('abort reuses the llm/streamChat messageId and sends no payload', async () => {
		const posts: IKnoxGuiMessage[] = [];
		const bridge = captureBridge(posts);

		const source = store.add(new CancellationTokenSource());
		const chunks = (async () => {
			const out: unknown[] = [];
			for await (const chunk of bridge.streamRequest('llm/streamChat', { messages: [] }, source.token)) {
				out.push(chunk);
			}
			return out;
		})();

		const stream = await waitForPost(posts, 'llm/streamChat');
		source.cancel();
		assert.deepStrictEqual(await chunks, []);

		const abort = await waitForPost(posts, 'abort');
		assert.strictEqual(abort.messageId, stream.messageId);
		assert.strictEqual(abort.data, undefined, 'abort payload is undefined per ideWebview.ts');
	});

	test('insertAtCursor and showLines payloads match the protocol tuples', async () => {
		const posts: IKnoxGuiMessage[] = [];
		const bridge = captureBridge(posts);

		await bridge.post('insertAtCursor', { text: 'const a = 1;' });
		await bridge.post('showLines', { filepath: 'file:///ws/a.ts', startLine: 1, endLine: 3 });
		await bridge.post('showFile', { filepath: 'file:///ws/a.ts' });

		assert.deepStrictEqual(posts.find(item => item.messageType === 'insertAtCursor')?.data, { text: 'const a = 1;' });
		assert.deepStrictEqual(posts.find(item => item.messageType === 'showLines')?.data, {
			filepath: 'file:///ws/a.ts',
			startLine: 1,
			endLine: 3,
		});
		assert.deepStrictEqual(posts.find(item => item.messageType === 'showFile')?.data, { filepath: 'file:///ws/a.ts' });
	});

	test('copyText payload is { text } not a raw string (T2.3)', async () => {
		const posts: IKnoxGuiMessage[] = [];
		const bridge = captureBridge(posts);

		await bridge.post('copyText', { text: 'clip' });

		assert.deepStrictEqual(posts.find(item => item.messageType === 'copyText')?.data, { text: 'clip' });
		assert.notStrictEqual(typeof posts.find(item => item.messageType === 'copyText')?.data, 'string');
	});

	test('llm/streamChat payload carries model title, messages, and completion options', async () => {
		const posts: IKnoxGuiMessage[] = [];
		const bridge = captureBridge(posts);

		const streamed = (async () => {
			for await (const _chunk of bridge.streamRequest('llm/streamChat', {
				completionOptions: { reasoningEffort: 'high' },
				title: 'TestModel',
				messages: [{ role: 'user', content: 'hi' }],
				legacySlashCommandData: undefined,
			})) {
				// Drain.
			}
		})();
		const stream = await waitForPost(posts, 'llm/streamChat');
		bridge.handlePush({ messageType: 'llm/streamChat', messageId: stream.messageId, data: { done: true } });
		await streamed;

		assert.deepStrictEqual(stream.data, {
			completionOptions: { reasoningEffort: 'high' },
			title: 'TestModel',
			messages: [{ role: 'user', content: 'hi' }],
			legacySlashCommandData: undefined,
		});
	});

	test('reverse replies answer the IDE queries the extension awaits', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		store.add(bridge.registerRequestHandler('getDefaultModelTitle', () => 'TestModel'));
		store.add(bridge.registerRequestHandler('isKnoxInputFocused', () => true));
		store.add(bridge.registerRequestHandler('getCurrentSessionId', () => 'session-1'));
		store.add(bridge.registerRequestHandler('incrementFtc', () => undefined));

		for (const messageType of ['getDefaultModelTitle', 'isKnoxInputFocused', 'getCurrentSessionId', 'incrementFtc']) {
			const reply = await bridge.handlePush({ messageType, messageId: `req-${messageType}`, data: undefined });
			assert.ok(reply && typeof reply === 'object' && '__knoxGuiReply' in reply, `${messageType} must reverse-reply`);
		}
	});
});
