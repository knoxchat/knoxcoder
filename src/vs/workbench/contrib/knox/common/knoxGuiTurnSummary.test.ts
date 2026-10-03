/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IKnoxGuiHistoryItem, IKnoxGuiToolCall } from './knoxGuiState.js';
import { formatTurnDuration, formatTurnTokens, summarizeTurn } from './knoxGuiTurnSummary.js';

function call(id: string, name: string, args: Record<string, unknown>, extra: Partial<IKnoxGuiToolCall> = {}): IKnoxGuiToolCall {
	return { id, name, arguments: JSON.stringify(args), parsedArgs: args, status: 'done', ...extra };
}

function user(at: string): IKnoxGuiHistoryItem {
	return { id: 'u', role: 'user', content: 'do it', createdAt: at };
}

suite('Knox GUI turn summary (K-040)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('counts files, +/- lines, commands, tests and the oracle line', () => {
		const history: IKnoxGuiHistoryItem[] = [
			user('2026-10-03T10:00:00.000Z'),
			{
				id: 'a1', role: 'assistant', content: '', createdAt: '2026-10-03T10:00:05.000Z',
				toolCalls: [
					call('1', 'builtin_edit_file', { filepath: 'src/a.ts', old_string: 'one\ntwo\nthree', new_string: 'one\nTWO\nthree\nfour' }, { output: '[soul checkpoint=cp-first]' }),
					call('2', 'builtin_edit_file', { filepath: 'src/a.ts', old_string: 'x', new_string: 'y' }, { output: '[soul checkpoint=cp-second]\noracle: tsc --noEmit -> fail (3 errors)' }),
					call('3', 'builtin_write_file', { filepath: 'src/b.ts', content: 'a\nb\nc\n' }),
					call('4', 'builtin_run_terminal_command', { command: 'npm test' }, { status: 'errored' }),
					call('5', 'builtin_run_terminal_command', { command: 'ls' }),
					call('6', 'builtin_edit_file', { filepath: 'src/c.ts', old_string: 'q', new_string: 'r' }, { status: 'errored' }),
				],
				promptLogs: [{ modelTitle: 'm', usage: { promptTokens: 1000, completionTokens: 200 } } as never],
			},
			{ id: 'a2', role: 'assistant', content: 'done', createdAt: '2026-10-03T10:01:10.000Z', promptLogs: [{ usage: { promptTokens: 300, completionTokens: 50 } } as never] },
		];
		const summary = summarizeTurn(history, 0)!;
		assert.deepStrictEqual(summary.files.map(f => [f.path, f.additions, f.deletions]), [['src/a.ts', 4, 3], ['src/b.ts', 3, 0]]);
		assert.strictEqual(summary.totalAdditions, 7);
		assert.strictEqual(summary.totalDeletions, 3);
		assert.deepStrictEqual(summary.commands.map(c => [c.command, c.status, c.isTest]), [['npm test', 'errored', true], ['ls', 'done', false]]);
		assert.strictEqual(summary.testsRun, 1);
		assert.strictEqual(summary.testsFailed, 1);
		assert.deepStrictEqual(summary.oracle, { command: 'tsc --noEmit', passed: false, errors: 3 });
		assert.strictEqual(summary.toolCalls, 6);
		assert.strictEqual(summary.failedToolCalls, 2);
		assert.strictEqual(summary.tokens, 1550);
		assert.strictEqual(summary.elapsedMs, 70_000);
		// First checkpoint of the turn = state before the first mutation.
		assert.strictEqual(summary.checkpointId, 'cp-first');
	});

	test('apply_patch counts per file and kind', () => {
		const patch = ['*** Begin Patch', '*** Update File: src/x.ts', '@@', ' keep', '-old', '+new1', '+new2', '*** Add File: src/y.ts', '+hello', '*** Delete File: src/z.ts', '*** End Patch'].join('\n');
		const summary = summarizeTurn([user('2026-10-03T10:00:00.000Z'), { id: 'a', role: 'assistant', content: '', toolCalls: [call('1', 'builtin_apply_patch', { patch })] }], 0)!;
		assert.deepStrictEqual(summary.files.map(f => [f.path, f.additions, f.deletions, f.kind]), [['src/x.ts', 2, 1, 'edit'], ['src/y.ts', 1, 0, 'create'], ['src/z.ts', 0, 0, 'delete']]);
	});

	test('multi-edit sums every edit and unchanged lines are not counted', () => {
		const summary = summarizeTurn([user('2026-10-03T10:00:00.000Z'), {
			id: 'a', role: 'assistant', content: '', toolCalls: [call('1', 'builtin_edit_file', { filepath: 'f.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'same\nx', new_string: 'same\ny\nz' }] })],
		}], 0)!;
		assert.deepStrictEqual([summary.files[0].additions, summary.files[0].deletions], [3, 2]);
	});

	test('a turn without tool calls has no summary; only the requested turn is read', () => {
		assert.strictEqual(summarizeTurn([user('2026-10-03T10:00:00.000Z'), { id: 'a', role: 'assistant', content: 'hi' }], 0), undefined);
		assert.strictEqual(summarizeTurn([{ id: 'a', role: 'assistant', content: 'hi' }], 0), undefined);
		const two: IKnoxGuiHistoryItem[] = [
			user('2026-10-03T10:00:00.000Z'),
			{ id: 'a', role: 'assistant', content: '', toolCalls: [call('1', 'builtin_write_file', { filepath: 'one.ts', content: 'x' })] },
			user('2026-10-03T10:05:00.000Z'),
			{ id: 'b', role: 'assistant', content: '', toolCalls: [call('2', 'builtin_write_file', { filepath: 'two.ts', content: 'x' })] },
		];
		assert.deepStrictEqual(summarizeTurn(two, 2)!.files.map(f => f.path), ['two.ts']);
	});

	test('formatting', () => {
		assert.strictEqual(formatTurnDuration(450), '450ms');
		assert.strictEqual(formatTurnDuration(42_000), '42s');
		assert.strictEqual(formatTurnDuration(125_000), '2m 5s');
		assert.strictEqual(formatTurnTokens(950), '950');
		assert.strictEqual(formatTurnTokens(1550), '1.6k');
		assert.strictEqual(formatTurnTokens(48_000), '48k');
	});
});
