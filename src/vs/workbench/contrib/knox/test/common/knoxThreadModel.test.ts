/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import {
	buildKnoxThreadRows,
	isDuplicateKnoxAssistantReply,
	isLastKnoxUserInput,
	knoxTurnHasVisibleProgress,
} from '../../common/knoxThreadModel.js';

function user(content = 'hello', id = 'u1'): IKnoxChatHistoryItem {
	return { message: { role: 'user', content, id }, contextItems: [] };
}

function assistant(content: string, id = 'a1', extra?: Partial<IKnoxChatHistoryItem>): IKnoxChatHistoryItem {
	return {
		message: { role: 'assistant', content, id },
		contextItems: [],
		...extra,
	};
}

function toolState(name: string = KnoxBuiltInToolName.ReadFile): IKnoxToolCallState {
	return {
		toolCallId: 't1',
		status: 'done',
		parsedArgs: { filepath: 'a.ts' },
		toolCall: { id: 't1', type: 'function', function: { name, arguments: '{}' } },
	};
}

suite('knox thread flatten', () => {
	test('detects duplicate assistant replies skipping thinking', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			assistant('done', 'a1'),
			{ message: { role: 'thinking', content: 'hmm', id: 'th' }, contextItems: [] },
			assistant('done', 'a2'),
		];
		assert.strictEqual(isDuplicateKnoxAssistantReply(history, 1), false);
		assert.strictEqual(isDuplicateKnoxAssistantReply(history, 3), true);
	});

	test('chat-mode loading appears only on the last user turn with no progress', () => {
		const history = [user()];
		assert.strictEqual(knoxTurnHasVisibleProgress(history, 0), false);
		const rows = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: true });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'loading']);
	});

	test('agent mode shows a timeline on completed turns, not the current one', () => {
		const history: IKnoxChatHistoryItem[] = [
			user('first', 'u1'),
			assistant('ok', 'a1', {
				toolCallState: toolState(),
				toolCallStates: [toolState()],
				message: {
					role: 'assistant',
					content: '',
					id: 'a1',
					toolCalls: [toolState().toolCall],
				},
			}),
			user('second', 'u2'),
		];
		assert.strictEqual(isLastKnoxUserInput(history, 0), false);
		assert.strictEqual(isLastKnoxUserInput(history, 2), true);
		const rows = buildKnoxThreadRows(history, { mode: 'agent', isStreaming: false });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'timeline', 'tool', 'user']);
	});

	test('skips duplicate assistant bodies and keeps unique replies', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			assistant('hello', 'a1'),
			assistant('hello', 'a2'),
			assistant('next', 'a3'),
		];
		const rows = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'assistant', 'assistant']);
		assert.strictEqual(rows[1].item?.message.id, 'a1');
		assert.strictEqual(rows[2].item?.message.id, 'a3');
	});

	test('assistant tool calls emit a compact tool stub plus reply when present', () => {
		const state = toolState(KnoxBuiltInToolName.EditFile);
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{
				message: {
					role: 'assistant',
					content: 'edited',
					id: 'a1',
					toolCalls: [state.toolCall],
				},
				contextItems: [],
				toolCallState: state,
				toolCallStates: [state],
			},
		];
		const rows = buildKnoxThreadRows(history, { mode: 'agent', isStreaming: true });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'assistant', 'tool']);
		assert.strictEqual(rows[2].toolState?.toolCall.function.name, KnoxBuiltInToolName.EditFile);
	});

	test('skips empty tool-role rows that only carry a durable plan', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{
				message: { role: 'tool', content: 'plan', id: 't1', toolCallId: 'p1' },
				contextItems: [{
					name: 'Plan',
					description: 'created',
					content: 'Task Execution Plan\n1. [ ] Do it',
				}],
			},
			{
				message: { role: 'tool', content: 'file', id: 't2', toolCallId: 'r1' },
				contextItems: [{ name: 'a.ts', description: 'a.ts', content: 'hi' }],
			},
		];
		const rows = buildKnoxThreadRows(history, { mode: 'agent', isStreaming: false });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'tool']);
		assert.strictEqual(rows[1].item?.message.id, 't2');
	});
});
