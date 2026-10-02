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

	test('streamRequest ignores chunks that arrive after done', async () => {
		const incoming = new Emitter<IKnoxGuiMessage>();
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(message: IKnoxGuiMessage): Promise<void> {
				incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: false, status: 'success', content: [{ content: 'Hello' }] } });
				incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: true, status: 'success', content: undefined } });
				incoming.fire({ messageType: message.messageType, messageId: message.messageId, data: { done: false, status: 'success', content: [{ content: 'Hello' }] } });
			}
		};
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const seen: string[] = [];
		for await (const batch of messenger.streamRequest<{ content: string }>('llm/streamChat', {})) {
			seen.push(...batch.map(item => item.content));
		}
		assert.deepStrictEqual(seen, ['Hello']);
	});

	test('subscribeHost ignores request/stream envelopes so extra editors cannot re-handle tokens', async () => {
		const incoming = new Emitter<IKnoxGuiMessage>();
		const knoxService = new class extends mock<IKnoxService>() {
			override onDidReceiveGuiMessage = incoming.event;
			override async guiPost(): Promise<void> { }
		};
		const messenger = disposables.add(new KnoxGuiMessenger(knoxService));
		const seen: string[] = [];
		messenger.subscribeHost(message => seen.push(message.messageType));
		incoming.fire({ messageType: 'llm/streamChat', messageId: 's1', data: { done: false, status: 'success', content: [{ content: 'Since' }] } });
		incoming.fire({ messageType: 'configUpdate', messageId: 'c1', data: { result: { config: {} } } });
		incoming.fire({ messageType: 'setEditStatus', messageId: 'e1', data: { status: 'accepting' } });
		assert.deepStrictEqual(seen, ['configUpdate', 'setEditStatus']);
	});

	test('KnoxService ignores a second live delegate instead of throwing', () => {
		const service = disposables.add(new KnoxService(new NullLogService()));
		const first = disposables.add(service.setDelegate(new class extends mock<IKnoxExtensionDelegate>() {
			override async guiPost(): Promise<void> { }
		}));
		const second = service.setDelegate(new class extends mock<IKnoxExtensionDelegate>() {
			override async guiPost(): Promise<void> { }
		});
		second.dispose();
		assert.ok(first);
		first.dispose();
		const third = disposables.add(service.setDelegate(new class extends mock<IKnoxExtensionDelegate>() {
			override async guiPost(): Promise<void> { }
		}));
		assert.ok(third);
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
