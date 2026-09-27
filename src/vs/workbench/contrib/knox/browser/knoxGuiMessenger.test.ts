/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IKnoxGuiMessage } from '../common/knoxGuiProtocol.js';
import { IKnoxService } from '../common/knoxService.js';
import { KnoxGuiMessenger } from './knoxGuiMessenger.js';

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
});
