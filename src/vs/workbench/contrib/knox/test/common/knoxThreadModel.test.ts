/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import {
	buildKnoxThreadRows,
	diffKnoxThreadRows,
	IKnoxThreadRow,
	isDuplicateKnoxAssistantReply,
	isLastKnoxUserInput,
	knoxLastRevealIndex,
	knoxThreadDynamicHeight,
	knoxThreadSpacerRow,
	knoxThreadSpacerSync,
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

	test('skips duplicate redacted thinking blocks (T3.3)', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{ message: { role: 'thinking', content: '', id: 't1', redactedThinking: 'aaa' }, contextItems: [] },
			{ message: { role: 'thinking', content: '', id: 't2', redactedThinking: 'bbb' }, contextItems: [] },
			assistant('ok', 'a1'),
		];
		const rows = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false });
		assert.deepStrictEqual(rows.map(r => r.kind), ['user', 'thinking', 'assistant']);
		assert.strictEqual(rows[1].item?.message.id, 't1');
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

suite('knox thread row diff (T1.6)', () => {
	function rows(ids: string[]): IKnoxThreadRow[] {
		return ids.map(id => ({ id, kind: 'assistant' as const, historyIndex: 0, measuredHeight: undefined }));
	}

	test('reports unchanged order when only row contents change (streaming token)', () => {
		const before = rows(['user:u1', 'assistant:a1']);
		const after = rows(['user:u1', 'assistant:a1']);
		after[1] = { ...after[1], item: assistant('longer text'), isLast: true };
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.unchangedOrder, true);
		assert.deepStrictEqual(diff.splices, []);
		assert.deepStrictEqual(diff.changedIndices, [1]);
	});

	test('identical rows report no changed indices', () => {
		const before = rows(['user:u1', 'assistant:a1']);
		const after = rows(['user:u1', 'assistant:a1']);
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.unchangedOrder, true);
		assert.deepStrictEqual(diff.changedIndices, []);
	});

	test('appends a new row with a single splice at the tail', () => {
		const diff = diffKnoxThreadRows(rows(['user:u1']), rows(['user:u1', 'assistant:a1']));
		assert.strictEqual(diff.unchangedOrder, false);
		assert.strictEqual(diff.splices.length, 1);
		assert.strictEqual(diff.splices[0].start, 1);
		assert.strictEqual(diff.splices[0].deleteCount, 0);
		assert.deepStrictEqual(diff.splices[0].rows.map(r => r.id), ['assistant:a1']);
	});

	test('splices only the changed middle when a load row becomes progress rows', () => {
		const before = rows(['user:u1', 'loading:0', 'assistant:a1']);
		const after = rows(['user:u1', 'assistant:a1', 'tool:t1']);
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.unchangedOrder, false);
		assert.strictEqual(diff.splices.length, 1);
		// The shared `user:u1` prefix is preserved; the whole tail is replaced
		// because the loading row is gone and a tool row is appended.
		assert.strictEqual(diff.splices[0].start, 1);
		assert.strictEqual(diff.splices[0].deleteCount, 2);
		assert.deepStrictEqual(diff.splices[0].rows.map(r => r.id), ['assistant:a1', 'tool:t1']);
	});

	test('keeps a shared tail and only inserts the new middle row', () => {
		const before = rows(['user:u1', 'assistant:a1']);
		const after = rows(['user:u1', 'tool:t1', 'assistant:a1']);
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.splices.length, 1);
		assert.strictEqual(diff.splices[0].start, 1);
		assert.strictEqual(diff.splices[0].deleteCount, 0);
		assert.deepStrictEqual(diff.splices[0].rows.map(r => r.id), ['tool:t1']);
	});

	test('removes trailing rows without touching the kept prefix', () => {
		const diff = diffKnoxThreadRows(rows(['user:u1', 'assistant:a1', 'tool:t1']), rows(['user:u1']));
		assert.strictEqual(diff.unchangedOrder, false);
		assert.strictEqual(diff.splices[0].start, 1);
		assert.strictEqual(diff.splices[0].deleteCount, 2);
		assert.deepStrictEqual(diff.splices[0].rows, []);
	});

	test('an unchanged list is a no-op', () => {
		const diff = diffKnoxThreadRows(rows([]), rows([]));
		assert.strictEqual(diff.unchangedOrder, true);
		assert.deepStrictEqual(diff.splices, []);
	});

	test('a new session (all ids change) replaces the whole span', () => {
		const diff = diffKnoxThreadRows(rows(['user:u1', 'assistant:a1']), rows(['user:u2']));
		assert.strictEqual(diff.unchangedOrder, false);
		assert.strictEqual(diff.splices[0].start, 0);
		assert.strictEqual(diff.splices[0].deleteCount, 2);
		assert.deepStrictEqual(diff.splices[0].rows.map(r => r.id), ['user:u2']);
	});

	test('streaming tokens keep row identity so the list never full-splices (T1.6)', () => {
		const base = [user('hello', 'u1')];
		const options = { mode: 'chat' as const, isStreaming: true };
		// Start from an already-streaming turn so only reply text changes.
		let previous = buildKnoxThreadRows([...base, assistant('H', 'a1')], options);

		for (const token of ['He', 'Hel', 'Hell', 'Hello']) {
			const next = buildKnoxThreadRows(
				[...base, assistant(token, 'a1')],
				options,
			);
			const diff = diffKnoxThreadRows(previous, next);
			assert.strictEqual(diff.unchangedOrder, true, `token "${token}" must not reshuffle rows`);
			assert.deepStrictEqual(diff.splices, [], `token "${token}" must not add/remove rows`);
			// Only the streaming assistant row is re-rendered.
			assert.deepStrictEqual(diff.changedIndices, [1], `token "${token}" must only touch the assistant row`);
			previous = next;
		}
		assert.deepStrictEqual(previous.map(row => row.id), ['user:u1', 'assistant:a1']);
	});

	test('the loading row is replaced by the assistant row exactly once (T1.6)', () => {
		const history = [user('hello', 'u1')];
		const loading = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: true });
		assert.deepStrictEqual(loading.map(row => row.id), ['user:u1', 'loading:0']);

		const streaming = buildKnoxThreadRows([...history, assistant('Hi', 'a1')], { mode: 'chat', isStreaming: true });
		const diff = diffKnoxThreadRows(loading, streaming);
		assert.strictEqual(diff.unchangedOrder, false);
		assert.strictEqual(diff.splices.length, 1);
		assert.deepStrictEqual(diff.splices[0].rows.map(row => row.id), ['assistant:a1']);
		// Subsequent tokens against the assistant row are a no-op order change.
		const grown = buildKnoxThreadRows([...history, assistant('Hi there', 'a1')], { mode: 'chat', isStreaming: true });
		assert.strictEqual(diffKnoxThreadRows(streaming, grown).unchangedOrder, true);
	});

	test('tool row identity survives live output so collapse maps stay (T4.4)', () => {
		const before: IKnoxThreadRow[] = [{
			id: 'tool:tc1',
			kind: 'tool',
			historyIndex: 1,
			measuredHeight: 120,
			toolState: {
				toolCallId: 'tc1',
				status: 'calling',
				parsedArgs: { command: 'ls' },
				toolCall: { id: 'tc1', type: 'function', function: { name: 'builtin_run_terminal_command', arguments: '{}' } },
				output: [{ name: 'Terminal', description: '', content: 'a' }],
			},
		}];
		const after: IKnoxThreadRow[] = [{
			...before[0],
			toolState: {
				...before[0].toolState!,
				output: [{ name: 'Terminal', description: '', content: 'a\nb' }],
			},
		}];
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.unchangedOrder, true);
		assert.deepStrictEqual(diff.splices, []);
		assert.deepStrictEqual(diff.changedIndices, [0]);
	});

	test('in-place history mutations still dirty the painted row (T4.1)', () => {
		const reply = assistant('He', 'a1');
		const before = buildKnoxThreadRows([user(), reply], { mode: 'chat', isStreaming: true });
		reply.message.content = 'Hello';
		const after = buildKnoxThreadRows([user(), reply], { mode: 'chat', isStreaming: true });
		const diff = diffKnoxThreadRows(before, after);
		assert.strictEqual(diff.unchangedOrder, true);
		assert.deepStrictEqual(diff.changedIndices, [1]);

		const state = toolState(KnoxBuiltInToolName.RunTerminalCommand);
		state.status = 'calling';
		state.output = [{ name: 'Terminal', description: '', content: 'a' }];
		const toolItem: IKnoxChatHistoryItem = {
			message: {
				role: 'assistant',
				content: '',
				id: 'a2',
				toolCalls: [state.toolCall],
			},
			contextItems: [],
			toolCallState: state,
			toolCallStates: [state],
		};
		const toolBefore = buildKnoxThreadRows([user(), toolItem], { mode: 'agent', isStreaming: true });
		state.output = [{ name: 'Terminal', description: '', content: 'a\nb' }];
		const toolAfter = buildKnoxThreadRows([user(), toolItem], { mode: 'agent', isStreaming: true });
		const toolDiff = diffKnoxThreadRows(toolBefore, toolAfter);
		assert.strictEqual(toolDiff.unchangedOrder, true);
		assert.ok(toolDiff.changedIndices.length > 0);
	});

	test('dynamic height skips the spacer cache so streaming rows remeasure', () => {
		assert.strictEqual(knoxThreadDynamicHeight({
			id: 'knox-thread-spacer',
			kind: 'spacer',
			historyIndex: -1,
			measuredHeight: 240,
		}), 240);
		assert.strictEqual(knoxThreadDynamicHeight({
			id: 'assistant:a1',
			kind: 'assistant',
			historyIndex: 1,
			measuredHeight: 88,
		}), null);
		assert.strictEqual(knoxThreadDynamicHeight({
			id: 'thinking:t1',
			kind: 'thinking',
			historyIndex: 1,
			measuredHeight: 64,
		}), null);
	});
});

suite('knox thread spacer / reveal (ListError Invalid index)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function assistantRow(): IKnoxThreadRow {
		return { id: 'assistant:a1', kind: 'assistant', historyIndex: 1, measuredHeight: 88 };
	}

	test('reveal index is the last list index, not _rows.length - 1', () => {
		assert.strictEqual(knoxLastRevealIndex(0), undefined);
		assert.strictEqual(knoxLastRevealIndex(1), 0);
		assert.strictEqual(knoxLastRevealIndex(2), 1);
		// Phantom spacer in `_rows` (length 2) while the list still has 1 row.
		assert.notStrictEqual(knoxLastRevealIndex(1), 2 - 1);
	});

	test('short content without a list spacer emits insert, not a silent _rows prepend', () => {
		const sync = knoxThreadSpacerSync({
			viewport: 400,
			rows: [assistantRow()],
			listHasSpacer: false,
		});
		assert.strictEqual(sync.op.type, 'insert');
		assert.strictEqual(sync.rows.length, 2);
		assert.strictEqual(sync.rows[0].kind, 'spacer');
		assert.strictEqual(knoxLastRevealIndex(1), 0);
	});

	test('rows that already contain a spacer still insert when the list does not', () => {
		const sync = knoxThreadSpacerSync({
			viewport: 400,
			rows: [knoxThreadSpacerRow(312), assistantRow()],
			listHasSpacer: false,
		});
		assert.strictEqual(sync.op.type, 'insert');
		assert.strictEqual(sync.rows[0].kind, 'spacer');
		assert.strictEqual(sync.rows[1].id, 'assistant:a1');
	});

	test('existing list spacer is resized, not inserted a second time', () => {
		const sync = knoxThreadSpacerSync({
			viewport: 400,
			rows: [assistantRow()],
			listHasSpacer: true,
		});
		assert.strictEqual(sync.op.type, 'update');
		assert.ok(sync.op.type === 'update' && sync.op.pad > 0);
		assert.strictEqual(sync.rows.length, 2);
	});

	test('zero viewport strips a phantom spacer instead of keeping it in _rows', () => {
		const sync = knoxThreadSpacerSync({
			viewport: 0,
			rows: [knoxThreadSpacerRow(200), assistantRow()],
			listHasSpacer: false,
		});
		assert.strictEqual(sync.op.type, 'none');
		assert.deepStrictEqual(sync.rows.map(row => row.id), ['assistant:a1']);
	});

	test('content that fills the viewport removes the list spacer', () => {
		const tall: IKnoxThreadRow = { id: 'assistant:a1', kind: 'assistant', historyIndex: 1, measuredHeight: 400 };
		const sync = knoxThreadSpacerSync({
			viewport: 400,
			rows: [tall],
			listHasSpacer: true,
		});
		assert.strictEqual(sync.op.type, 'remove');
		assert.deepStrictEqual(sync.rows.map(row => row.id), ['assistant:a1']);
	});
});
