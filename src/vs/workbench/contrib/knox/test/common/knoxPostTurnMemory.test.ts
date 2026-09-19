/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import {
	KNOX_POST_TURN_MIN_CHARS,
	knoxCollectTurnToolSummary,
	knoxExtractSoulFiles,
	knoxFormatSettledToolSummary,
	knoxLastAssistantContent,
	knoxPostTurnMemoryFor,
	knoxPostTurnMinChars,
	knoxTurnToolStates,
} from '../../common/knoxPostTurnMemory.js';

function user(content: string, id = 'u1'): IKnoxChatHistoryItem {
	return { message: { role: 'user', content, id }, contextItems: [] };
}

function assistant(content: string, id = 'a1', extra?: Partial<IKnoxChatHistoryItem>): IKnoxChatHistoryItem {
	return { message: { role: 'assistant', content, id }, contextItems: [], ...extra };
}

function toolState(name: string, status: IKnoxToolCallState['status'], args: unknown): IKnoxToolCallState {
	return {
		toolCallId: 't1',
		status,
		parsedArgs: args,
		toolCall: { id: 't1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
	};
}

suite('knox post-turn memory (T2.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('extractSoulFiles pulls path keys and paths array', () => {
		assert.deepStrictEqual(
			knoxExtractSoulFiles('builtin_read_file', { filepath: 'src/a.ts' }),
			['src/a.ts'],
		);
		assert.deepStrictEqual(
			knoxExtractSoulFiles('builtin_x', { target_file: 'b.ts', paths: ['c.ts', 'd.ts'] }),
			['b.ts', 'c.ts', 'd.ts'],
		);
		assert.deepStrictEqual(knoxExtractSoulFiles('builtin_x', '{"file_path":"e.ts"}'), ['e.ts']);
		assert.deepStrictEqual(knoxExtractSoulFiles('builtin_x', undefined), []);
	});

	test('formatSettledToolSummary matches the Core copy', () => {
		assert.strictEqual(knoxFormatSettledToolSummary([]), '');
		const summary = knoxFormatSettledToolSummary([
			{ name: 'builtin_edit_file', status: 'done', files: ['a.ts'] },
			{ name: 'builtin_run_terminal_command', status: 'canceled', files: [] },
		]);
		assert.strictEqual(summary, [
			'## Tools this turn',
			'- builtin_edit_file ok files=a.ts',
			'- builtin_run_terminal_command fail status=canceled',
		].join('\n'));
	});

	test('formatSettledToolSummary caps files at 8', () => {
		const files = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
		const summary = knoxFormatSettledToolSummary([{ name: 'x', status: 'done', files }]);
		assert.ok(summary.includes('files=f0.ts, f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, f7.ts'));
		assert.ok(!summary.includes('f8.ts'));
	});

	test('collectTurnToolSummary only sees the last turn', () => {
		const history: IKnoxChatHistoryItem[] = [
			user('old', 'u0'),
			assistant('ok', 'a0', {
				toolCallState: toolState('builtin_read_file', 'done', { filepath: 'old.ts' }),
			}),
			user('new', 'u1'),
			assistant('done', 'a1', {
				toolCallState: toolState('builtin_edit_file', 'done', { filepath: 'new.ts' }),
			}),
		];
		const summary = knoxCollectTurnToolSummary(history);
		assert.ok(summary.includes('builtin_edit_file'));
		assert.ok(summary.includes('new.ts'));
		assert.ok(!summary.includes('old.ts'));
	});

	test('turn tool states include unsettled tools (GUI parity)', () => {
		const history: IKnoxChatHistoryItem[] = [
			user('hi', 'u1'),
			assistant('', 'a1', { toolCallState: toolState('builtin_read_file', 'generated', { filepath: 'a.ts' }) }),
		];
		assert.deepStrictEqual(knoxTurnToolStates(history).map(s => s.status), ['generated']);
	});

	test('knoxPostTurnMinChars defaults to 80 and reads the config value', () => {
		assert.strictEqual(KNOX_POST_TURN_MIN_CHARS, 80);
		assert.strictEqual(knoxPostTurnMinChars(undefined), 80);
		assert.strictEqual(knoxPostTurnMinChars({ config: { post_turn_min_chars: 200 } }), 200);
		assert.strictEqual(knoxPostTurnMinChars({ config: { post_turn_min_chars: 0 } }), 0);
		assert.strictEqual(knoxPostTurnMinChars({ config: { post_turn_min_chars: -5 } }), 80);
		assert.strictEqual(knoxPostTurnMinChars({ config: { post_turn_min_chars: 'x' } }), 80);
	});

	test('substantial turns are decided by length or a tool running', () => {
		const short = [user('hi', 'u1'), assistant('ok', 'a1')];
		assert.strictEqual(knoxPostTurnMemoryFor(short, 80), undefined, 'short prose without tools is not substantial');

		const long = [user('x'.repeat(50), 'u1'), assistant('y'.repeat(50), 'a1')];
		const longTurn = knoxPostTurnMemoryFor(long, 80);
		assert.ok(longTurn);
		assert.strictEqual(longTurn.substantial, true);

		const withTool = [user('hi', 'u1'), assistant('', 'a1', {
			toolCallState: toolState('builtin_read_file', 'done', { filepath: 'a.ts' }),
		})];
		const toolTurn = knoxPostTurnMemoryFor(withTool, 80);
		assert.ok(toolTurn?.substantial);
		assert.ok(toolTurn.toolSummary.includes('## Tools this turn'));
	});

	test('a zero threshold makes any non-empty turn substantial', () => {
		const history = [user('hi', 'u1'), assistant('ok', 'a1')];
		assert.ok(knoxPostTurnMemoryFor(history, 0));
	});

	test('an empty turn is never stored even with tools', () => {
		assert.strictEqual(knoxPostTurnMemoryFor([], 0), undefined);
	});

	test('knoxLastAssistantContent returns the newest assistant reply', () => {
		const history = [user('hi', 'u1'), assistant('first', 'a1'), assistant('second', 'a2')];
		assert.strictEqual(knoxLastAssistantContent(history), 'second');
		assert.strictEqual(knoxLastAssistantContent([]), '');
	});
});