/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IKnoxGuiMessage } from '../common/knoxGuiProtocol.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { IKnoxExtensionDelegate, IKnoxService } from '../common/knoxService.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';
import { KnoxService } from './knoxService.js';

suite('KnoxGuiMessenger', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('request resolves content from matching messageId envelope', async () => {
		const incoming = new Emitter<IKnoxGuiMessage>();
		const posted: IKnoxGuiMessage[] = [];
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				posted.push(message);
				incoming.fire({
					messageType: message.messageType,
					messageId: message.messageId,
					data: { done: true, status: 'success', content: { ok: true } },
				});
			}
		};
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const result = await messenger.request<{ ok: boolean }>('history/list', {});
		assert.strictEqual(result.ok, true);
		assert.strictEqual(posted[0].messageType, 'history/list');
	});

	test('streamRequest yields chunks then returns', async () => {
		const incoming = new Emitter<IKnoxGuiMessage>();
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: false, status: 'success', content: [{ content: 'Hello' }] } });
				await timeout(0);
				incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: true, status: 'success', content: undefined } });
			}
		};
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const seen: string[] = [];
		for await (const batch of messenger.streamRequest<{ content: string }>('llm/streamChat', {})) {
			seen.push(...batch.map(item => item.content));
		}
		assert.deepStrictEqual(seen, ['Hello']);
	});

	test('KnoxService tracks setActiveChatSession and broadcasts changes synchronously', async () => {
		const service = disposables.add(new KnoxService(new NullLogService()));
		const forwarded: IKnoxGuiMessage[] = [];
		disposables.add(service.setDelegate(new class extends mock<IKnoxExtensionDelegate>() {
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				forwarded.push(message);
			}
		}));
		const seen: unknown[] = [];
		disposables.add(service.onDidReceiveGuiMessage(message => {
			if (message.messageType === 'activeChatSessionChanged') {
				seen.push(message.data);
			}
		}));
		const messenger = disposables.add(new KnoxGuiMessenger(service));
		assert.strictEqual(messenger.activeChatSessionId, null);

		messenger.post('setActiveChatSession', { sessionId: 'a' });
		assert.deepStrictEqual(seen, [{ sessionId: 'a' }]);
		assert.strictEqual(messenger.activeChatSessionId, 'a');
		messenger.post('setActiveChatSession', { sessionId: 'a' });
		messenger.post('setActiveChatSession', { sessionId: null });
		assert.deepStrictEqual(seen, [{ sessionId: 'a' }, { sessionId: null }]);
		await timeout(0);
		assert.strictEqual(forwarded.filter(message => message.messageType === 'setActiveChatSession').length, 3, 'the host still gets every post');
	});
});
