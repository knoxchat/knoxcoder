/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	mergeToolCallDeltas,
	primaryToolCallState,
	syncToolCallStatesFromDeltas,
} from '../../common/knoxMergeToolCalls.js';
import {
	findCurrentToolCall,
	findPendingGeneratedToolCalls,
	hasUnsettledToolCalls,
} from '../../common/knoxChatHistory.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';

suite('mergeToolCallDeltas', () => {
	test('appends argument fragments onto the same index', () => {
		const first = mergeToolCallDeltas([], [
			{
				index: 0,
				id: 'c1',
				type: 'function',
				function: { name: 'builtin_read_file', arguments: '{"file' },
			},
		]);
		const second = mergeToolCallDeltas(first, [
			{ index: 0, function: { arguments: 'path":"a.ts"}' } },
		]);
		assert.strictEqual(second.length, 1);
		assert.strictEqual(second[0]?.function?.arguments, '{"filepath":"a.ts"}');
		assert.strictEqual(second[0]?.function?.name, 'builtin_read_file');
	});

	test('keeps a second tool call on index 1 instead of concatenating onto [0]', () => {
		const first = mergeToolCallDeltas([], [
			{
				index: 0,
				id: 'c1',
				type: 'function',
				function: { name: 'builtin_read_file', arguments: '{"filepath":"a.ts"}' },
			},
		]);
		const second = mergeToolCallDeltas(first, [
			{
				index: 1,
				id: 'c2',
				type: 'function',
				function: { name: 'builtin_glob', arguments: '{"pattern":"*.ts"}' },
			},
		]);
		assert.strictEqual(second.length, 2);
		assert.strictEqual(second[0]?.id, 'c1');
		assert.strictEqual(second[1]?.id, 'c2');
		assert.strictEqual(second[0]?.function?.arguments, '{"filepath":"a.ts"}');
	});

	test('merges Anthropic-style deltas by id', () => {
		const first = mergeToolCallDeltas([], [
			{ id: 'toolu_1', type: 'function', function: { name: 'read', arguments: '{' } },
		]);
		const second = mergeToolCallDeltas(first, [
			{ id: 'toolu_1', function: { arguments: '}' } },
		]);
		assert.strictEqual(second.length, 1);
		assert.strictEqual(second[0]?.function?.arguments, '{}');
	});
});

suite('toolCallDeltaToState name canonicalization', () => {
	test('maps read_file_line onto builtin_read_file so the card is not Agent Tool Usage', () => {
		const states = syncToolCallStatesFromDeltas(
			[
				{
					id: 'c2',
					type: 'function',
					function: {
						name: 'read_file_line',
						arguments: '{"filepath":"tetris/src/main.rs","startLine":760,"endLine":840}',
					},
				},
			],
			undefined,
		);
		assert.strictEqual(states[0]?.toolCall.function.name, 'builtin_read_file');
	});

	test('maps read_file onto builtin_read_file so permissions and routing match', () => {
		const states = syncToolCallStatesFromDeltas(
			[
				{
					id: 'c1',
					type: 'function',
					function: {
						name: 'read_file',
						arguments: '{"filepath":"a.ts"}',
					},
				},
			],
			undefined,
		);
		assert.strictEqual(states[0]?.toolCall.function.name, 'builtin_read_file');
	});
});

suite('syncToolCallStatesFromDeltas', () => {
	test('preserves status when arguments grow', () => {
		const states = syncToolCallStatesFromDeltas(
			[{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{' } }],
			undefined,
		);
		states[0].status = 'generated';
		const next = syncToolCallStatesFromDeltas(
			[{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }],
			states,
		);
		assert.strictEqual(next[0]?.status, 'generated');
		assert.strictEqual(next[0]?.toolCall.function.arguments, '{}');
	});
});

suite('primaryToolCallState', () => {
	test('prefers the first unfinished state', () => {
		const primary = primaryToolCallState([
			{
				toolCallId: 'a',
				status: 'done',
				parsedArgs: {},
				toolCall: { id: 'a', type: 'function', function: { name: 'r', arguments: '{}' } },
			},
			{
				toolCallId: 'b',
				status: 'generated',
				parsedArgs: {},
				toolCall: { id: 'b', type: 'function', function: { name: 'w', arguments: '{}' } },
			},
		]);
		assert.strictEqual(primary?.toolCallId, 'b');
	});
});

suite('tool call batch helpers', () => {
	function item(states: Array<{ id: string; status: IKnoxToolCallState['status'] }>): IKnoxChatHistoryItem {
		const toolCallStates: IKnoxToolCallState[] = states.map(state => ({
			toolCallId: state.id,
			status: state.status,
			parsedArgs: {},
			toolCall: {
				id: state.id,
				type: 'function',
				function: { name: 'builtin_read_file', arguments: '{}' },
			},
		}));
		return {
			message: { role: 'assistant', content: '', toolCalls: [] },
			contextItems: [],
			toolCallStates,
			toolCallState: toolCallStates[0],
		};
	}

	test('finds pending generated calls on the latest assistant turn', () => {
		const history = [
			item([
				{ id: 'a', status: 'done' },
				{ id: 'b', status: 'generated' },
			]),
		];
		assert.deepStrictEqual(findPendingGeneratedToolCalls(history).map(s => s.toolCallId), ['b']);
		assert.strictEqual(findCurrentToolCall(history)?.toolCallId, 'b');
		assert.strictEqual(hasUnsettledToolCalls(history), true);
	});

	test('treats only done/canceled as settled', () => {
		const history = [
			item([
				{ id: 'a', status: 'done' },
				{ id: 'b', status: 'canceled' },
			]),
		];
		assert.strictEqual(hasUnsettledToolCalls(history), false);
		assert.deepStrictEqual(findPendingGeneratedToolCalls(history), []);
	});
});
