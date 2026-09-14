/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { createKnoxChatServiceForTest } from './knoxChatTestUtils.js';

function userItem(content: string, id = 'u1'): IKnoxChatHistoryItem {
	return {
		message: { role: 'user', content, id },
		contextItems: [],
		editorState: { type: 'doc', content: [] },
	};
}

function assistantItem(
	content: string,
	opts?: { id?: string; toolStatus?: IKnoxToolCallState['status'] },
): IKnoxChatHistoryItem {
	const id = opts?.id ?? 'a1';
	const item: IKnoxChatHistoryItem = {
		message: {
			role: 'assistant',
			content,
			id,
			...(opts?.toolStatus
				? {
					toolCalls: [{
						id: 'tc1',
						type: 'function' as const,
						function: { name: 'builtin_create_new_file', arguments: '{}' },
					}],
				}
				: {}),
		},
		contextItems: [],
	};
	if (opts?.toolStatus) {
		item.toolCallState = {
			status: opts.toolStatus,
			toolCallId: 'tc1',
			parsedArgs: {},
			toolCall: {
				id: 'tc1',
				type: 'function',
				function: { name: 'builtin_create_new_file', arguments: '{}' },
			},
		};
	}
	return item;
}

function toolItem(content: string): IKnoxChatHistoryItem {
	return {
		message: {
			role: 'tool',
			content,
			id: 't1',
			toolCallId: 'tc1',
		},
		contextItems: [],
	};
}

suite('clearDanglingMessages', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('rolls empty user+assistant pair back into the editor', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([userItem('hello'), assistantItem('')]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history.length, 0);
		assert.ok(service.mainEditorContentTrigger);
	});

	test('keeps prior tool result and drops empty trailing assistant', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([
			userItem('do it'),
			assistantItem('working', { toolStatus: 'done' }),
			toolItem('ok'),
			assistantItem(''),
		]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history.length, 3);
		assert.strictEqual(service.history.at(-1)?.message.role, 'tool');
	});

	test('cancels generating tool call when assistant already has content', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([
			userItem('edit'),
			assistantItem('I\'ll edit', { toolStatus: 'generating' }),
		]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history.length, 2);
		assert.strictEqual(service.history[1].toolCallState?.status, 'canceled');
	});

	test('cancels mid-flight calling tool so UI is not left dangling', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([
			userItem('run it'),
			assistantItem('Running terminal', { toolStatus: 'calling' }),
		]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history.length, 2);
		assert.strictEqual(service.history[1].toolCallState?.status, 'canceled');
	});

	test('cancels generated-but-not-started tool on abort', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([
			userItem('edit'),
			assistantItem('I\'ll edit', { toolStatus: 'generated' }),
		]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history[1].toolCallState?.status, 'canceled');
	});

	test('cancels a calling tool even after a sibling tool result', () => {
		const { service } = createKnoxChatServiceForTest(store);
		const taskState: IKnoxToolCallState = {
			status: 'calling',
			toolCallId: 'task1',
			parsedArgs: { prompt: 'resolve conflicts', profile: 'general' },
			toolCall: {
				id: 'task1',
				type: 'function',
				function: { name: 'builtin_task', arguments: '{}' },
			},
		};
		const grepState: IKnoxToolCallState = {
			status: 'done',
			toolCallId: 'grep1',
			parsedArgs: {},
			toolCall: {
				id: 'grep1',
				type: 'function',
				function: { name: 'builtin_grep_search', arguments: '{}' },
			},
		};
		service.replaceHistory([
			userItem('go'),
			{
				message: {
					role: 'assistant',
					content: 'working',
					id: 'a1',
					toolCalls: [taskState.toolCall, grepState.toolCall],
				},
				contextItems: [],
				toolCallStates: [taskState, grepState],
				toolCallState: taskState,
			},
			toolItem('grep ok'),
		]);
		service.clearDanglingMessages();
		assert.strictEqual(service.history[1].toolCallStates?.[0]?.status, 'canceled');
		assert.strictEqual(service.history[1].toolCallStates?.[1]?.status, 'done');
	});
});

suite('submitEditorAndInitAtIndex checkpoint index', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('points curCheckpointIndex at the new user message', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.submitEditorAndInitAtIndex(0, { type: 'doc', content: [] });
		assert.strictEqual(service.history.length, 2);
		assert.deepStrictEqual(service.history[0].checkpoint, {});
	});

	test('stays on the resubmitted user index even with longer history', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.replaceHistory([
			userItem('a', 'u0'),
			assistantItem('b', { id: 'a0' }),
			userItem('c', 'u1'),
			assistantItem('d', { id: 'a1' }),
		]);
		service.submitEditorAndInitAtIndex(2, { type: 'doc', content: [] });
		assert.strictEqual(service.history.length, 4);
		assert.strictEqual(service.history[2].message.role, 'user');
		assert.strictEqual(service.history[3].message.role, 'assistant');
		assert.strictEqual(service.history[3].message.content, '');
	});
});

suite('tool state machine', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('generated → calling → done', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.submitEditorAndInitAtIndex(0);
		service.streamUpdate([{
			role: 'assistant',
			content: '',
			toolCalls: [{
				id: 'tc1',
				type: 'function',
				function: { name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}' },
			}],
		}]);
		assert.strictEqual(service.history.at(-1)?.toolCallState?.status, 'generating');
		service.setToolGenerated();
		assert.strictEqual(service.history.at(-1)?.toolCallState?.status, 'generated');
		assert.strictEqual(service.toolPending, true);
		service.setCalling('tc1');
		assert.strictEqual(service.history.at(-1)?.toolCallState?.status, 'calling');
		service.setToolCallOutput({ toolCallId: 'tc1', output: [{ name: 'ok', description: 'ok', content: 'ok' }] });
		service.acceptToolCall('tc1');
		assert.strictEqual(service.history.at(-1)?.toolCallState?.status, 'done');
		assert.strictEqual(service.toolPending, false);
	});

	test('updateApplyState upserts by streamId and advances on done', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.updateApplyState({ streamId: 's1', status: 'streaming', filepath: '/tmp/a.ts' });
		service.updateApplyState({ streamId: 's1', status: 'done', numDiffs: 2 });
		assert.strictEqual(service.applyStates.length, 1);
		assert.strictEqual(service.applyStates[0].status, 'done');
		assert.strictEqual(service.applyStates[0].numDiffs, 2);
		assert.strictEqual(service.applyStates[0].filepath, '/tmp/a.ts');
	});

	test('pin and remove injected memories', () => {
		const { service } = createKnoxChatServiceForTest(store);
		service.setLastInjectedMemories([
			{ id: 1, kind: 'semantic', title: 'a', reason: 'r', pinned: false },
			{ id: 2, kind: 'semantic', title: 'b', reason: 'r' },
		]);
		service.setLastInjectedMemories(service.injectedMemories.map(item => item.id === 1 ? { ...item, pinned: true } : item));
		assert.strictEqual(service.injectedMemories[0].pinned, true);
		service.setLastInjectedMemories(service.injectedMemories.filter(item => item.id !== 2));
		assert.strictEqual(service.injectedMemories.length, 1);
	});
});
