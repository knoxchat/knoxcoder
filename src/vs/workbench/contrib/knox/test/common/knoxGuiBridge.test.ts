/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KnoxGuiBridge } from '../../common/knoxGuiBridge.js';
import { IKnoxGuiExtHost, IKnoxGuiMessage } from '../../common/knoxGuiProtocol.js';

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
});
