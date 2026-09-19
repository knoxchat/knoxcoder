/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KNOX_NEW_CHAT_TITLE } from '../../common/knoxChat.js';
import { mergeAssistantText } from '../../common/knoxChatTypes.js';
import type { IKnoxChatHistoryItem, IKnoxChatMessage } from '../../common/knoxChatTypes.js';
import { createKnoxChatServiceForTest } from './knoxChatTestUtils.js';

const REPLY = 'The `cargo info` shows the pre-release. Let me check the latest stable release';

const TOOL_CALL = {
	id: 'call_1',
	type: 'function' as const,
	function: {
		name: 'builtin_run_terminal_command',
		arguments: '{"command":"cargo info dioxus"}',
	},
};

function assistantItems(history: readonly IKnoxChatHistoryItem[]) {
	return history.filter(item => item.message.role === 'assistant');
}

suite('KnoxChatService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('newSession resets id, history, and streaming', () => {
		const { service } = createKnoxChatServiceForTest(store);
		const firstId = service.sessionId;
		let changes = 0;
		store.add(service.onDidChange(() => changes++));

		service.setStreaming(true);
		service.setToolPending(true);
		service.setMode('chat');
		assert.strictEqual(service.isStreaming, true);
		assert.strictEqual(service.mode, 'chat');

		service.newSession();

		assert.notStrictEqual(service.sessionId, firstId);
		assert.strictEqual(service.lastSessionId, firstId);
		assert.strictEqual(service.isStreaming, false);
		assert.strictEqual(service.toolPending, false);
		assert.strictEqual(service.history.length, 0);
		assert.strictEqual(service.title, KNOX_NEW_CHAT_TITLE);
		assert.strictEqual(service.mode, 'chat');
		assert.ok(changes >= 2);
	});

	test('abortStream clears streaming and pending tool', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.setStreaming(true);
		service.setToolPending(true);
		const firstAborter = service.streamAborter;

		service.abortStream();

		assert.strictEqual(service.isStreaming, false);
		assert.strictEqual(service.toolPending, false);
		assert.strictEqual(firstAborter.signal.aborted, true);
		assert.notStrictEqual(service.streamAborter, firstAborter);
		assert.strictEqual(service.streamAborter.signal.aborted, false);
	});
});

suite('mergeAssistantText', () => {
	test('ignores a repeated snapshot of the same sentence', () => {
		assert.strictEqual(mergeAssistantText(REPLY, REPLY), REPLY);
	});

	test('replaces with a longer snapshot instead of concatenating', () => {
		assert.strictEqual(mergeAssistantText('Hello', 'Hello world'), 'Hello world');
	});

	test('appends a true delta', () => {
		assert.strictEqual(mergeAssistantText('Hello', ' world'), 'Hello world');
	});
});

suite('streamUpdate tool-call split', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function sessionWithAssistantPlaceholder() {
		const { service } = createKnoxChatServiceForTest(store);
		service.submitEditorAndInitAtIndex(0, { type: 'doc', content: [] });
		return service;
	}

	test('does not copy the streamed reply onto the new tool-call item', () => {
		const service = sessionWithAssistantPlaceholder();
		service.streamUpdate([
			{ role: 'assistant', content: '', reasoning: 'check crates.io' } as IKnoxChatMessage,
		]);
		service.streamUpdate([{ role: 'assistant', content: REPLY }]);
		service.streamUpdate([
			{
				role: 'assistant',
				content: REPLY,
				toolCalls: [TOOL_CALL],
			},
		]);

		const assistants = assistantItems(service.history);
		assert.strictEqual(assistants.length, 2);
		assert.strictEqual(assistants[0].message.content, REPLY);
		assert.strictEqual(assistants[0].reasoning?.text, 'check crates.io');
		assert.strictEqual(assistants[1].message.content, '');
		assert.strictEqual(assistants[1].message.toolCalls?.[0]?.id, 'call_1');
	});

	test('hydrateLastAssistant keeps text on the pre-tool assistant', () => {
		const service = sessionWithAssistantPlaceholder();
		service.streamUpdate([{ role: 'assistant', content: REPLY }]);
		service.streamUpdate([
			{
				role: 'assistant',
				content: '',
				toolCalls: [TOOL_CALL],
			},
		]);
		service.hydrateLastAssistant({
			role: 'assistant',
			content: REPLY,
			toolCalls: [TOOL_CALL],
		});

		const assistants = assistantItems(service.history);
		assert.strictEqual(assistants[0].message.content, REPLY);
		assert.strictEqual(assistants[1].message.content, '');
		assert.strictEqual(
			assistants[1].message.toolCalls?.[0]?.function?.name,
			'builtin_run_terminal_command',
		);
	});

	test('does not concatenate when the same reply chunk arrives twice', () => {
		const service = sessionWithAssistantPlaceholder();
		service.streamUpdate([{ role: 'assistant', content: REPLY }]);
		service.streamUpdate([{ role: 'assistant', content: REPLY }]);

		const assistant = service.history.find(item => item.message.role === 'assistant');
		assert.strictEqual(assistant?.message.content, REPLY);
	});

	test('hydrateLastAssistant still writes content onto an unsplit tool item', () => {
		const service = sessionWithAssistantPlaceholder();
		service.streamUpdate([
			{
				role: 'assistant',
				content: REPLY,
				toolCalls: [TOOL_CALL],
			},
		]);
		service.hydrateLastAssistant({
			role: 'assistant',
			content: REPLY,
			toolCalls: [TOOL_CALL],
		});

		const assistants = assistantItems(service.history);
		assert.strictEqual(assistants.length, 2);
		assert.strictEqual(assistants[0].message.content, REPLY);
		assert.strictEqual(assistants[1].message.content, '');
		assert.strictEqual(assistants[1].message.toolCalls?.[0]?.id, 'call_1');
	});

	test('exitEditMode leaves edit, rejects diffs, and posts edit/exit', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.setMode('edit');
		service.addCodeToEdit({
			filepath: 'file:///ws/a.ts',
			contents: 'x',
			range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
		});
		await service.exitEditMode();
		assert.strictEqual(service.mode, 'chat');
		assert.strictEqual(service.codeToEdit.length, 0);
		assert.strictEqual(service.editStatus, 'done');
		assert.ok(bridge.posts.some(post => post.messageType === 'rejectDiff' && (post.data as { filepath: string }).filepath === 'file:///ws/a.ts'));
		assert.deepStrictEqual(bridge.posts.at(-1), { messageType: 'edit/exit', data: { shouldFocusEditor: true } });
		await service.exitEditMode();
		assert.strictEqual(bridge.posts.filter(post => post.messageType === 'edit/exit').length, 1);
	});

	test('focusEdit starts a new edit session; WithoutClear keeps codeToEdit', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		bridge.streamChunks = [[{ role: 'assistant', content: 'ok' }]];
		await service.streamResponse({ content: 'hi', modifiers: { noContext: true } });
		const previousId = service.sessionId;
		service.addCodeToEdit({ filepath: 'file:///ws/a.ts', contents: 'x' });

		await service.focusEdit();
		assert.notStrictEqual(service.sessionId, previousId);
		assert.strictEqual(service.mode, 'edit');
		assert.strictEqual(service.editStatus, 'not-started');
		assert.strictEqual(service.history.length, 0);
		assert.strictEqual(service.codeToEdit.length, 1);

		await service.focusEditWithoutClear();
		assert.strictEqual(service.mode, 'edit');
		assert.strictEqual(service.codeToEdit.length, 1);
	});

	test('addCodeToEdit and setEditStatus arrive over the native sink', () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlePush({
			messageType: 'addCodeToEdit',
			messageId: '1',
			data: { filepath: 'file:///ws/a.ts', contents: 'hello', range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } } },
		});
		assert.strictEqual(service.codeToEdit.length, 1);
		service.setMode('edit');
		service.setEditStatus('streaming');
		bridge.handlePush({
			messageType: 'setEditStatus',
			messageId: '2',
			data: { status: 'accepting', fileAfterEdit: 'file:///ws/a.ts' },
		});
		assert.strictEqual(service.editStatus, 'accepting');
		assert.strictEqual(service.fileAfterEdit, 'file:///ws/a.ts');
	});

	test('sendEditPrompt posts edit/sendPrompt for a single range', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		service.setMode('edit');
		service.addCodeToEdit({
			filepath: 'file:///ws/a.ts',
			contents: 'const x = 1;',
			range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
		});
		await service.sendEditPrompt({ content: 'rename x', editorState: { mentions: [] } });
		assert.strictEqual(service.editStatus, 'streaming');
		const sent = bridge.posts.find(post => post.messageType === 'edit/sendPrompt');
		assert.ok(sent);
		const data = sent!.data as { prompt: string; range: { filepath: string }; selectedModelTitle: string };
		assert.ok(data.prompt.includes('rename x'));
		assert.strictEqual(data.range.filepath, 'file:///ws/a.ts');
		assert.strictEqual(data.selectedModelTitle, 'TestModel');
	});

	test('focusEditor posts the protocol name', () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.focusEditor();
		assert.deepStrictEqual(bridge.posts.at(-1), { messageType: 'focusEditor', data: undefined });
	});

	test('tool presets, group toggles, bookmarks, and add-prompt post protocol names', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlers.set('config/getSerializedProfileInfo', () => ({
			status: 'success',
			content: {
				result: {
					config: {
						models: [{ title: 'TestModel', provider: 'test' }],
						slashCommands: [{ name: 'commit', description: 'Commit' }, { name: 'review', description: 'Review' }],
						tools: [
							{ function: { name: 'builtin_edit_file' }, readonly: false, group: 'Built-in' },
							{ function: { name: 'builtin_read_file' }, readonly: true, group: 'Built-in' },
						],
						rules: ['Be concise'],
						selectedModelByRole: { chat: { title: 'TestModel' } },
						experimental: {},
					},
				},
				profileId: 'local',
			},
		}));
		await service.loadConfig();

		assert.strictEqual(service.config?.rules?.[0], 'Be concise');
		assert.strictEqual(service.config?.tools?.[0]?.function.name, 'builtin_edit_file');
		service.applyToolPermissionPreset('safe');
		assert.strictEqual(service.toolSettings['builtin_edit_file'], 'allowedWithPermission');
		service.applyToolPermissionPreset('yolo');
		assert.strictEqual(service.toolSettings['builtin_edit_file'], 'allowedWithoutPermission');

		service.toggleToolGroupSetting('Built-in');
		assert.strictEqual(service.toolGroupSettings['Built-in'], 'exclude');

		service.addSessionToolAllowlist('builtin_edit_file');
		assert.deepStrictEqual([...service.sessionToolAllowlist], ['builtin_edit_file']);
		service.removeSessionToolAllowlist('builtin_edit_file');
		assert.deepStrictEqual([...service.sessionToolAllowlist], []);

		assert.deepStrictEqual(service.slashBookmarks(), ['commit', 'review']);
		service.toggleSlashBookmark('commit');
		assert.deepStrictEqual(service.slashBookmarks(), ['review']);

		service.addPrompt({ name: 'check', description: 'Check code', prompt: 'Look for bugs' });
		assert.deepStrictEqual(bridge.posts.at(-1), {
			messageType: 'config/addPrompt',
			data: { name: '/check', description: 'Check code', prompt: 'Look for bugs' },
		});

		service.setAgentPolicy({
			paths: 'deny ~/.ssh/**',
			commands: 'ask git *',
			externalDirectory: 'allow',
			sandboxDestructive: false,
		});
		assert.strictEqual(service.config?.experimental?.agentPolicy?.externalDirectory, 'allow');
		const shared = bridge.posts.find(post => post.messageType === 'config/updateSharedConfig');
		assert.ok(shared);
		assert.strictEqual((shared!.data as { agentPolicyExternalDirectory?: string }).agentPolicyExternalDirectory, 'allow');
	});

	test('updates shared config, language, profiles, and incoming IDE events', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		bridge.handlePush({
			messageType: 'configUpdate',
			messageId: '1',
			data: {
				result: {
					config: { models: [{ title: 'A' }], ui: { fontSize: 16 } },
					errors: [{ message: 'missing key', fatal: true }],
				},
			},
		});
		assert.strictEqual(service.hasFatalConfigError, true);
		assert.strictEqual(service.configError[0].message, 'missing key');

		service.updateSharedConfig({ showSessionTabs: true, fontSize: 18 });
		assert.strictEqual(service.config?.ui?.showSessionTabs, true);
		assert.strictEqual(service.config?.ui?.fontSize, 18);
		assert.ok(bridge.posts.some(post => post.messageType === 'config/updateSharedConfig'));

		service.setLanguage('zh');
		assert.strictEqual(service.language, 'zh');

		bridge.handlePush({
			messageType: 'didChangeAvailableProfiles',
			messageId: '2',
			data: { profiles: [{ id: 'local' }, { id: 'hub', title: 'Hub' }], selectedProfileId: 'local' },
		});
		service.cycleProfile();
		assert.strictEqual(service.profileId, 'hub');
		assert.ok(bridge.posts.some(post => post.messageType === 'didChangeSelectedProfile'));

		service.addModel({ title: 'New', provider: 'knoxchat' });
		assert.ok(bridge.posts.some(post => post.messageType === 'config/addModel'));
		assert.strictEqual(service.defaultModelTitle, 'New');

		const previous = service.defaultModelTitle;
		service.addModel({ title: 'Edit Only', provider: 'knoxchat', roles: ['edit'] }, 'inlineEdit');
		assert.strictEqual(service.defaultModelTitle, previous);
		service.deleteModel('Edit Only');
		assert.ok(bridge.posts.some(post => post.messageType === 'config/deleteModel'));
		service.openConfigProfile();
		assert.ok(bridge.posts.some(post => post.messageType === 'config/openProfile'));

		service.showToast('info', 'hi');
		service.copyText('clip');
		assert.ok(bridge.posts.some(post => post.messageType === 'showToast'));
		const copy = bridge.posts.find(post => post.messageType === 'copyText');
		assert.deepStrictEqual(copy?.data, { text: 'clip' });

		bridge.handlePush({
			messageType: 'agentModeChanged',
			messageId: '3',
			data: { active: false },
		});
		await Promise.resolve();
		assert.ok(service.mode === 'chat' || service.mode === 'agent');
	});

	test('focusKnoxInput saves history without starting a new session (T1.3)', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		service.submitEditorAndInitAtIndex(0);
		service.updateHistoryItemAtIndex(0, { message: { role: 'user', content: 'keep me', id: 'u1' } });
		service.addCodeToEdit({ filepath: 'file:///tmp/ws/a.ts', contents: 'const a = 1;' });

		const sessionId = service.sessionId;
		await service.focusKnoxInput();

		assert.strictEqual(service.sessionId, sessionId, 'focusKnoxInput must not open a new session');
		assert.strictEqual(service.history.length, 2, 'the thread must survive');
		assert.strictEqual(service.codeToEdit.length, 0, 'code-to-edit is cleared');
		assert.ok(bridge.requests.some(item => item.messageType === 'history/save'));
	});

	test('focusKnoxInput on an empty thread is a no-op save (T1.3)', async () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		await service.loadConfig();
		const sessionId = service.sessionId;

		await service.focusKnoxInput();

		assert.strictEqual(service.sessionId, sessionId);
		assert.ok(!bridge.requests.some(item => item.messageType === 'history/save'));
	});

	test('copyText posts { text } per ideWebview.ts (T2.3)', () => {
		const { service, bridge } = createKnoxChatServiceForTest(store);
		service.copyText('hello');
		assert.deepStrictEqual(
			bridge.posts.find(post => post.messageType === 'copyText')?.data,
			{ text: 'hello' },
		);
	});
});
