/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { KNOX_FTC_DIALOG_AT, KNOX_FTC_STORAGE_KEY, knoxFtcShouldPrompt } from '../../common/knoxChat.js';
import { KnoxChatService } from '../../common/knoxChatService.js';
import { knoxIsGuiReverseReply } from '../../common/knoxGuiProtocol.js';
import { createFakeWorkspace, createKnoxChatServiceForTest, FakeKnoxGuiBridge } from './knoxChatTestUtils.js';

async function reverseQuery(bridge: FakeKnoxGuiBridge, messageType: string): Promise<unknown> {
	const result = await bridge.handlePush({
		messageType,
		messageId: `req-${messageType}`,
		data: undefined,
	});
	if (!knoxIsGuiReverseReply(result)) {
		assert.fail(`expected reverse reply for ${messageType}`);
	}
	return result.data;
}

suite('Knox reverse RPC (T1.2)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('getDefaultModelTitle answers the selected chat model', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		assert.strictEqual(await reverseQuery(bridge, 'getDefaultModelTitle'), undefined);

		await service.loadConfig();
		assert.strictEqual(await reverseQuery(bridge, 'getDefaultModelTitle'), 'TestModel');
	});

	test('getCurrentSessionId and getWebviewHistoryLength track the session', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		assert.strictEqual(await reverseQuery(bridge, 'getCurrentSessionId'), service.sessionId);
		assert.strictEqual(await reverseQuery(bridge, 'getWebviewHistoryLength'), 0);

		service.replaceHistory([
			{ message: { role: 'user', content: 'hi', id: 'u1' }, contextItems: [] },
			{ message: { role: 'assistant', content: 'hello', id: 'a1' }, contextItems: [] },
		]);
		assert.strictEqual(await reverseQuery(bridge, 'getWebviewHistoryLength'), 2);

		const previous = service.sessionId;
		service.newSession();
		const next = await reverseQuery(bridge, 'getCurrentSessionId');
		assert.strictEqual(next, service.sessionId);
		assert.notStrictEqual(next, previous);
		assert.strictEqual(await reverseQuery(bridge, 'getWebviewHistoryLength'), 0);
	});

	test('isKnoxInputFocused follows setKnoxInputFocused', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		assert.strictEqual(await reverseQuery(bridge, 'isKnoxInputFocused'), false);
		service.setKnoxInputFocused(true);
		assert.strictEqual(await reverseQuery(bridge, 'isKnoxInputFocused'), true);
		service.setKnoxInputFocused(false);
		assert.strictEqual(await reverseQuery(bridge, 'isKnoxInputFocused'), false);
	});

	test('incrementFtc persists via IStorageService and still replies', async () => {
		const storage = store.add(new TestStorageService());
		const bridge = store.add(new FakeKnoxGuiBridge());
		const first = store.add(new KnoxChatService(bridge, createFakeWorkspace(), storage));
		assert.strictEqual(first.ftc, 0);

		assert.strictEqual(await reverseQuery(bridge, 'incrementFtc'), undefined);
		assert.strictEqual(first.ftc, 1);
		assert.strictEqual(storage.getNumber(KNOX_FTC_STORAGE_KEY, StorageScope.PROFILE, 0), 1);

		assert.strictEqual(await reverseQuery(bridge, 'incrementFtc'), undefined);
		assert.strictEqual(first.ftc, 2);

		const second = store.add(new KnoxChatService(store.add(new FakeKnoxGuiBridge()), createFakeWorkspace(), storage));
		assert.strictEqual(second.ftc, 2);
	});

	test('the 300-send dialog fires on the 300th increment (T3.6)', () => {
		assert.strictEqual(knoxFtcShouldPrompt(KNOX_FTC_DIALOG_AT - 1), false);
		assert.strictEqual(knoxFtcShouldPrompt(KNOX_FTC_DIALOG_AT), true);
		assert.strictEqual(knoxFtcShouldPrompt(KNOX_FTC_DIALOG_AT + 1), false);

		const storage = store.add(new TestStorageService());
		storage.store(KNOX_FTC_STORAGE_KEY, 299, StorageScope.PROFILE, StorageTarget.USER);
		const counted = store.add(new KnoxChatService(store.add(new FakeKnoxGuiBridge()), createFakeWorkspace(), storage));
		assert.strictEqual(counted.ftc, 299);
		assert.strictEqual(counted.incrementFtc(), 300);
		assert.strictEqual(knoxFtcShouldPrompt(counted.ftc), true);
	});
});
