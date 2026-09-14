/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import {
	DEFAULT_DOOM_LOOP_THRESHOLD,
	buildDoomLoopSummaryInstruction,
	canonicalizeToolArgs,
	collectTurnToolCalls,
	detectDoomLoop,
	fingerprintToolCall,
	isFailedToolCall,
	resolveDoomLoopThreshold,
} from '../../common/knoxDoomLoop.js';

function toolState(opts: {
	name: string;
	args?: unknown;
	status?: IKnoxToolCallState['status'];
	failed?: boolean;
	id?: string;
}): IKnoxToolCallState {
	const args = opts.args ?? {};
	const argsJson = JSON.stringify(args);
	return {
		toolCallId: opts.id ?? 'tc-1',
		status: opts.status ?? 'done',
		parsedArgs: args,
		toolCall: {
			id: opts.id ?? 'tc-1',
			type: 'function',
			function: { name: opts.name, arguments: argsJson },
		},
		output: opts.failed
			? [{
				name: 'Tool Call Error',
				description: 'failed',
				content: `Tool call "${opts.name}" failed:\n\nbad`,
				icon: 'problems',
			}]
			: [{ name: 'ok', description: 'ok', content: 'ok' }],
	};
}

function assistant(states: IKnoxToolCallState[]): IKnoxChatHistoryItem {
	return {
		message: { role: 'assistant', content: '', toolCalls: [] },
		contextItems: [],
		toolCallStates: states,
		toolCallState: states[0],
	};
}

function user(text = 'go'): IKnoxChatHistoryItem {
	return {
		message: { role: 'user', content: text },
		contextItems: [],
	};
}

suite('canonicalizeToolArgs', () => {
	test('normalizes key order and JSON strings', () => {
		assert.strictEqual(
			canonicalizeToolArgs({ b: 2, a: 1 }),
			canonicalizeToolArgs('{"a":1,"b":2}'),
		);
		assert.strictEqual(canonicalizeToolArgs(''), '{}');
		assert.strictEqual(canonicalizeToolArgs(undefined), '{}');
	});
});

suite('fingerprintToolCall', () => {
	test('is stable across arg key order', () => {
		const a = toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' } });
		const b = toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' } });
		assert.strictEqual(fingerprintToolCall(a), fingerprintToolCall(b));
	});

	test('differs when args differ', () => {
		const a = toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' } });
		const b = toolState({ name: 'builtin_read_file', args: { filepath: 'b.ts' } });
		assert.notStrictEqual(fingerprintToolCall(a), fingerprintToolCall(b));
	});
});

suite('isFailedToolCall', () => {
	test('detects tool-call error output', () => {
		assert.strictEqual(isFailedToolCall(toolState({ name: 'x', failed: true })), true);
		assert.strictEqual(isFailedToolCall(toolState({ name: 'x' })), false);
	});
});

suite('collectTurnToolCalls', () => {
	test('only includes settled calls after the latest user message', () => {
		const history = [
			user('first'),
			assistant([toolState({ name: 'old', id: 'old', args: { n: 1 } })]),
			user('second'),
			assistant([
				toolState({ name: 'new', id: 'a', args: { n: 2 } }),
				toolState({
					name: 'pending',
					id: 'b',
					status: 'generated',
					args: { n: 3 },
				}),
			]),
		];
		const collected = collectTurnToolCalls(history);
		assert.deepStrictEqual(collected.map(c => c.toolCallId), ['a']);
	});
});

suite('resolveDoomLoopThreshold', () => {
	test('defaults to 3, treats 0 as disabled, rejects 1', () => {
		assert.strictEqual(resolveDoomLoopThreshold(undefined), DEFAULT_DOOM_LOOP_THRESHOLD);
		assert.strictEqual(resolveDoomLoopThreshold(0), null);
		assert.strictEqual(resolveDoomLoopThreshold(1), DEFAULT_DOOM_LOOP_THRESHOLD);
		assert.strictEqual(resolveDoomLoopThreshold(5), 5);
		assert.strictEqual(resolveDoomLoopThreshold(undefined, 'systems'), 5);
	});
});

suite('detectDoomLoop', () => {
	test('returns null below the threshold', () => {
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' }, id: '1' }),
				toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' }, id: '2' }),
			]),
		];
		assert.strictEqual(detectDoomLoop(history), null);
	});

	test('detects the same call repeated to the threshold', () => {
		const same = { filepath: 'a.ts' };
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_read_file', args: same, id: '1' }),
				toolState({ name: 'builtin_read_file', args: same, id: '2' }),
				toolState({ name: 'builtin_read_file', args: same, id: '3' }),
			]),
		];
		const hit = detectDoomLoop(history);
		assert.strictEqual(hit?.kind, 'repeat');
		assert.strictEqual(hit?.toolName, 'builtin_read_file');
		assert.strictEqual(hit?.count, 3);
	});

	test('counts a pending call toward the threshold', () => {
		const same = { filepath: 'a.ts' };
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_read_file', args: same, id: '1' }),
				toolState({ name: 'builtin_read_file', args: same, id: '2' }),
			]),
		];
		const pending = toolState({
			name: 'builtin_read_file',
			args: same,
			id: '3',
			status: 'generated',
		});
		assert.strictEqual(detectDoomLoop(history), null);
		assert.strictEqual(detectDoomLoop(history, { pending: [pending] })?.kind, 'repeat');
	});

	test('detects a failure streak', () => {
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_edit_file', args: { n: 1 }, id: '1', failed: true }),
				toolState({ name: 'builtin_edit_file', args: { n: 2 }, id: '2', failed: true }),
				toolState({ name: 'builtin_write_file', args: { n: 3 }, id: '3', failed: true }),
			]),
		];
		const hit = detectDoomLoop(history);
		assert.strictEqual(hit?.kind, 'fail_streak');
		assert.strictEqual(hit?.count, 3);
	});

	test('does not treat distinct successful calls as a loop', () => {
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_read_file', args: { filepath: 'a.ts' }, id: '1' }),
				toolState({ name: 'builtin_read_file', args: { filepath: 'b.ts' }, id: '2' }),
				toolState({ name: 'builtin_read_file', args: { filepath: 'c.ts' }, id: '3' }),
			]),
		];
		assert.strictEqual(detectDoomLoop(history), null);
	});

	test('does not doom-loop edit + make + edit + make + edit + make', () => {
		const makeArgs = { command: 'make -j8' };
		const gcc = (fn: string) =>
			`Command: make -j8\nExit: 1\nsrc/foo.c:12:5: error: implicit declaration of function '${fn}'\nmake: *** [src/foo.o] Error 1`;
		const makeState = (id: string, fn: string): IKnoxToolCallState => ({
			...toolState({
				name: 'builtin_run_terminal_command',
				args: makeArgs,
				id,
			}),
			output: [{ name: 'Terminal', description: 'exited', content: gcc(fn) }],
		});
		const history = [
			user(),
			assistant([
				makeState('m1', 'bar'),
				toolState({
					name: 'builtin_edit_file',
					args: { filepath: 'src/foo.c', old_string: 'a', new_string: 'b' },
					id: 'e1',
				}),
				makeState('m2', 'bar'),
				toolState({
					name: 'builtin_edit_file',
					args: { filepath: 'src/foo.c', old_string: 'b', new_string: 'c' },
					id: 'e2',
				}),
				makeState('m3', 'bar'),
			]),
		];
		assert.strictEqual(detectDoomLoop(history), null);
	});

	test('does not doom-loop identical make args when the gcc error changes', () => {
		const makeArgs = { command: 'make' };
		const makeState = (id: string, log: string): IKnoxToolCallState => ({
			...toolState({
				name: 'builtin_run_terminal_command',
				args: makeArgs,
				id,
			}),
			output: [{ name: 'Terminal', description: 'exited', content: log }],
		});
		const history = [
			user(),
			assistant([
				makeState('1', 'src/foo.c:1:1: error: implicit declaration of function \'a\'\n'),
				makeState('2', 'src/foo.c:1:1: error: implicit declaration of function \'b\'\n'),
				makeState('3', 'src/foo.c:1:1: error: implicit declaration of function \'c\'\n'),
			]),
		];
		assert.strictEqual(detectDoomLoop(history), null);
	});

	test('still doom-loops three identical greps', () => {
		const same = { query: 'copy_to_user' };
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_exact_search', args: same, id: '1' }),
				toolState({ name: 'builtin_exact_search', args: same, id: '2' }),
				toolState({ name: 'builtin_exact_search', args: same, id: '3' }),
			]),
		];
		assert.strictEqual(detectDoomLoop(history)?.kind, 'repeat');
	});

	test('does not doom-loop identical qemu boots when the oops RIP changes', () => {
		const qemuArgs = { action: 'status', job_id: 'pty_1' };
		const qemuState = (id: string, rip: string): IKnoxToolCallState => ({
			...toolState({
				name: 'builtin_qemu',
				args: qemuArgs,
				id,
			}),
			output: [{
				name: 'QEMU',
				description: 'panic',
				content: [
					'Kernel panic - not syncing: Fatal exception',
					`RIP: 0010:${rip}+0x10/0x20`,
					'Call Trace:',
					` ${rip}+0x10/0x20 mm/filemap.c:42`,
				].join('\n'),
			}],
		});
		const history = [
			user(),
			assistant([
				qemuState('1', 'copy_to_user'),
				qemuState('2', 'copy_from_user'),
				qemuState('3', 'do_fault'),
			]),
		];
		assert.strictEqual(detectDoomLoop(history), null);
	});

	test('doom-loops three identical qemu boots with the same RIP', () => {
		const log = [
			'Kernel panic - not syncing: Fatal exception',
			'RIP: 0010:copy_to_user+0x10/0x20',
			'Call Trace:',
			' copy_to_user+0x10/0x20 mm/filemap.c:42',
		].join('\n');
		const qemuState = (id: string): IKnoxToolCallState => ({
			...toolState({
				name: 'builtin_qemu',
				args: { action: 'status', job_id: 'pty_1' },
				id,
			}),
			output: [{ name: 'QEMU', description: 'panic', content: log }],
		});
		const history = [
			user(),
			assistant([qemuState('1'), qemuState('2'), qemuState('3')]),
		];
		assert.strictEqual(detectDoomLoop(history)?.kind, 'repeat');
		assert.strictEqual(detectDoomLoop(history)?.toolName, 'builtin_qemu');
	});

	test('doom-loops three identical makes with the same error and no edits', () => {
		const log =
			'src/foo.c:12:5: error: implicit declaration of function \'bar\'\nmake: *** Error 1';
		const makeState = (id: string): IKnoxToolCallState => ({
			...toolState({
				name: 'builtin_run_terminal_command',
				args: { command: 'make' },
				id,
			}),
			output: [{ name: 'Terminal', description: 'exited', content: log }],
		});
		const history = [
			user(),
			assistant([makeState('1'), makeState('2'), makeState('3')]),
		];
		assert.strictEqual(detectDoomLoop(history)?.kind, 'repeat');
		assert.strictEqual(detectDoomLoop(history)?.toolName, 'builtin_run_terminal_command');
	});

	test('can be disabled', () => {
		const same = { filepath: 'a.ts' };
		const history = [
			user(),
			assistant([
				toolState({ name: 'builtin_read_file', args: same, id: '1' }),
				toolState({ name: 'builtin_read_file', args: same, id: '2' }),
				toolState({ name: 'builtin_read_file', args: same, id: '3' }),
			]),
		];
		assert.strictEqual(detectDoomLoop(history, { threshold: null }), null);
	});
});

suite('buildDoomLoopSummaryInstruction', () => {
	test('forbids further tools', () => {
		const text = buildDoomLoopSummaryInstruction({
			kind: 'repeat',
			threshold: 3,
			count: 3,
			toolName: 'builtin_read_file',
		});
		assert.ok(text.toLowerCase().includes('do not call any tools'));
		assert.ok(text.includes('builtin_read_file'));
	});
});
