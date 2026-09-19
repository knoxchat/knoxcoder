/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KnoxGuiBridge } from '../../common/knoxGuiBridge.js';
import { IKnoxGuiExtHost, IKnoxGuiMessage, knoxGuiReverseReply } from '../../common/knoxGuiProtocol.js';

suite('KnoxGuiBridge', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('request waits for ExtHost then forwards protocol names', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		const seen: IKnoxGuiMessage[] = [];
		const proxy: IKnoxGuiExtHost = {
			async $request(message) {
				seen.push(message);
				return { done: true, content: 'ok', status: 'success' };
			},
			async $post() { },
		};

		const pending = bridge.request('config/getSerializedProfileInfo', { x: 1 });
		bridge.bindExtHost(proxy);
		const result = await pending;

		assert.deepStrictEqual(result, { done: true, content: 'ok', status: 'success' });
		assert.strictEqual(seen.length, 1);
		assert.strictEqual(seen[0].messageType, 'config/getSerializedProfileInfo');
		assert.deepStrictEqual(seen[0].data, { x: 1 });
		assert.ok(seen[0].messageId);
	});

	test('streamRequest yields $push chunks for the same message id', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		let resolvePosted: (message: IKnoxGuiMessage) => void;
		const posted = new Promise<IKnoxGuiMessage>(resolve => { resolvePosted = resolve; });
		bridge.bindExtHost({
			async $request() { return undefined; },
			async $post(message) {
				resolvePosted(message);
			},
		});

		const chunksPromise = (async () => {
			const out: unknown[] = [];
			for await (const chunk of bridge.streamRequest('llm/streamChat', { prompt: 'hi' })) {
				out.push(chunk);
			}
			return out;
		})();

		const message = await posted;
		bridge.handlePush({
			messageType: message.messageType,
			messageId: message.messageId,
			data: { done: false, content: 'Hel', status: 'success' },
		});
		bridge.handlePush({
			messageType: message.messageType,
			messageId: message.messageId,
			data: { done: true, content: 'lo', status: 'success' },
		});

		assert.deepStrictEqual(await chunksPromise, ['Hel', 'lo']);
	});

	test('streamRequest posts abort with the stream messageId when cancelled', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		const posts: IKnoxGuiMessage[] = [];
		let resolveStream: (message: IKnoxGuiMessage) => void;
		const streamed = new Promise<IKnoxGuiMessage>(resolve => { resolveStream = resolve; });
		bridge.bindExtHost({
			async $request() { return undefined; },
			async $post(message) {
				posts.push(message);
				if (message.messageType === 'llm/streamChat') {
					resolveStream(message);
				}
			},
		});

		const source = store.add(new CancellationTokenSource());
		const chunksPromise = (async () => {
			const out: unknown[] = [];
			for await (const chunk of bridge.streamRequest('llm/streamChat', { prompt: 'hi' }, source.token)) {
				out.push(chunk);
			}
			return out;
		})();

		const stream = await streamed;
		source.cancel();
		assert.deepStrictEqual(await chunksPromise, []);

		const abort = posts.find(item => item.messageType === 'abort');
		assert.ok(abort);
		assert.strictEqual(abort.messageId, stream.messageId);
		assert.strictEqual(abort.data, undefined);
	});

	test('streamRequest does not start Core when already cancelled', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		const posts: IKnoxGuiMessage[] = [];
		bridge.bindExtHost({
			async $request() { return undefined; },
			async $post(message) { posts.push(message); },
		});

		const source = store.add(new CancellationTokenSource());
		source.cancel();
		const out: unknown[] = [];
		for await (const chunk of bridge.streamRequest('llm/streamChat', { prompt: 'hi' }, source.token)) {
			out.push(chunk);
		}
		assert.deepStrictEqual(out, []);
		assert.strictEqual(posts.length, 0);
	});

	test('handlePush returns a reverse reply for registered IDE→GUI queries', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		store.add(bridge.registerRequestHandler('getDefaultModelTitle', () => 'MyModel'));

		const reply = await bridge.handlePush({
			messageType: 'getDefaultModelTitle',
			messageId: 'req-1',
			data: undefined,
		});

		assert.deepStrictEqual(reply, knoxGuiReverseReply('MyModel'));
	});

	test('handlePush still replies when the answer is undefined so request() cannot hang', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		store.add(bridge.registerRequestHandler('getDefaultModelTitle', () => undefined));

		const reply = await bridge.handlePush({
			messageType: 'getDefaultModelTitle',
			messageId: 'req-2',
			data: undefined,
		});

		assert.deepStrictEqual(reply, knoxGuiReverseReply(undefined));
	});

	test('handlePush does not reverse-reply stream chunks', async () => {
		const bridge = store.add(new KnoxGuiBridge());
		const reply = await bridge.handlePush({
			messageType: 'llm/streamChat',
			messageId: 'stream-1',
			data: { done: false, content: 'Hel', status: 'success' },
		});
		assert.strictEqual(reply, undefined);
	});
});
