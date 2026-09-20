/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	buildKnoxAgentActivitySteps,
	classifyKnoxToolKind,
	collectKnoxTurnPromptLogs,
	currentKnoxActivityStep,
	estimateKnoxTokensFromPromptLogs,
	extractKnoxSoulCheckpointId,
	findLastKnoxUserIndex,
	formatKnoxDurationMs,
	formatKnoxElapsed,
	formatKnoxTokenCount,
	knoxActivityAnchorId,
	knoxToolStepDetail,
	knoxTurnElapsedMs,
	mapKnoxToolStatus,
	summarizeJevPromptLogs,
	summarizeKnoxActivity,
	visibleKnoxActivitySteps,
} from '../../common/knoxAgentActivity.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';

function toolState(
	name: string,
	status: IKnoxToolCallState['status'],
	args: Record<string, unknown> = {},
	id = name,
	output?: IKnoxToolCallState['output'],
): IKnoxToolCallState {
	return {
		toolCallId: id,
		status,
		parsedArgs: args,
		toolCall: {
			id,
			type: 'function',
			function: { name, arguments: JSON.stringify(args) },
		},
		output,
	};
}

function user(id = 'u1'): IKnoxChatHistoryItem {
	return {
		message: { role: 'user', content: 'do the thing', id },
		contextItems: [],
	};
}

function assistantTools(states: IKnoxToolCallState[], id = 'a1'): IKnoxChatHistoryItem {
	return {
		message: {
			role: 'assistant',
			content: '',
			id,
			toolCalls: states.map(s => s.toolCall),
		},
		contextItems: [],
		toolCallStates: states,
		toolCallState: states[0],
	};
}

suite('classifyKnoxToolKind', () => {
	test('maps reads, edits, search, git, task, ask', () => {
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.ReadFile), 'read');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.Glob), 'read');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.EditFile), 'edit');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.ApplyPatch), 'edit');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.ExactSearch), 'search');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.GitStatus), 'git');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.GitBlame), 'git');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.GitBisect), 'git');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.Task), 'task');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.PtyStart, {
			command: 'qemu-system-x86_64 -kernel bzImage',
		}), 'shell');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.AskUser), 'ask');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.WorkspaceCheckpoint), 'edit');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.Build, {
			action: 'check',
			extraArgs: '--release',
		}), 'shell');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.Build, { action: 'test' }), 'test');
	});

	test('treats generate_tests and test-runner shell as test', () => {
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.GenerateTests), 'test');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.RunTerminalCommand, {
			command: 'pnpm test',
		}), 'test');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.RunTerminalCommand, {
			command: 'cd packages/core && npx vitest run',
		}), 'test');
		assert.strictEqual(classifyKnoxToolKind(KnoxBuiltInToolName.RunTerminalCommand, {
			command: "git commit -m 'add tests'",
		}), 'shell');
	});
});

suite('knoxToolStepDetail', () => {
	test('uses basename for paths and truncates commands', () => {
		assert.strictEqual(knoxToolStepDetail(KnoxBuiltInToolName.EditFile, {
			filepath: 'src/redux/util/agentActivity.ts',
		}), 'agentActivity.ts');
		assert.strictEqual(knoxToolStepDetail(KnoxBuiltInToolName.RunTerminalCommand, {
			command: 'ls -la',
		}), 'ls -la');
		assert.strictEqual(knoxToolStepDetail(KnoxBuiltInToolName.ApplyPatch, {
			patch: '*** Begin Patch\n*** Update File: gui/src/pages/gui/Chat.tsx\n',
		}), 'Chat.tsx');
		assert.strictEqual(knoxToolStepDetail(KnoxBuiltInToolName.WorkspaceCheckpoint, {
			action: 'diff',
			checkpoint_id: 'cp_550e8400-e29b-41d4-a716-446655440000',
		}), 'cp_550e8400-e29…');
		assert.strictEqual(knoxToolStepDetail(KnoxBuiltInToolName.Build, {
			action: 'check',
			extraArgs: '--release',
		}), 'check --release');
	});
});

suite('mapKnoxToolStatus / anchors', () => {
	test('maps tool statuses and sanitizes ids', () => {
		assert.strictEqual(mapKnoxToolStatus('calling'), 'running');
		assert.strictEqual(mapKnoxToolStatus('generated'), 'pending');
		assert.strictEqual(mapKnoxToolStatus('done'), 'done');
		assert.strictEqual(knoxActivityAnchorId('tool:abc:1'), 'agent-activity-tool_abc_1');
	});
});

suite('buildKnoxAgentActivitySteps', () => {
	test('walks thinking → tools → reply for one user turn', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{
				message: { role: 'thinking', content: 'plan', id: 't1' },
				contextItems: [],
			},
			assistantTools([
				toolState(KnoxBuiltInToolName.ReadFile, 'done', { filepath: 'a.ts' }, 'r1'),
				toolState(KnoxBuiltInToolName.EditFile, 'calling', { filepath: 'b.ts' }, 'e1'),
			]),
			{
				message: { role: 'tool', content: 'ok', id: 'out', toolCallId: 'r1' },
				contextItems: [],
			},
			{
				message: { role: 'assistant', content: 'done', id: 'final' },
				contextItems: [],
			},
			user('u2'),
		];

		const steps = buildKnoxAgentActivitySteps(history, 0, { inProgress: true });
		assert.deepStrictEqual(steps.map(s => [s.kind, s.status, s.detail]), [
			['thinking', 'done', undefined],
			['read', 'done', 'a.ts'],
			['edit', 'running', 'b.ts'],
			['reply', 'done', undefined],
		]);
		assert.strictEqual(findLastKnoxUserIndex(history), 5);
		assert.deepStrictEqual(buildKnoxAgentActivitySteps(history, 5), []);
	});

	test('includes assistant reasoning as thinking', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{
				message: { role: 'assistant', content: '', id: 'a' },
				contextItems: [],
				reasoning: { active: true, text: 'hmm', startAt: 1 },
			},
		];
		const steps = buildKnoxAgentActivitySteps(history, 0);
		assert.deepStrictEqual(steps, [{
			id: 'reasoning:a',
			kind: 'thinking',
			status: 'running',
			historyIndex: 1,
		}]);
	});

	test('returns empty for a non-user index', () => {
		assert.deepStrictEqual(buildKnoxAgentActivitySteps([user()], 1), []);
	});

	test('attaches a workspace checkpoint id from the soul stamp', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			assistantTools([
				toolState(
					KnoxBuiltInToolName.EditFile,
					'done',
					{ filepath: 'b.ts' },
					'e1',
					[{ name: 'soul', description: 'checkpoint', content: '[soul checkpoint=cp-turn-1]' }],
				),
			]),
		];
		const steps = buildKnoxAgentActivitySteps(history, 0);
		assert.strictEqual(steps[0].workspaceCheckpointId, 'cp-turn-1');
		assert.strictEqual(extractKnoxSoulCheckpointId('[soul checkpoint=cp-turn-1]'), 'cp-turn-1');
	});

	test('marks trailing thinking as running only while the turn is in progress', () => {
		const history: IKnoxChatHistoryItem[] = [
			user(),
			{
				message: { role: 'thinking', content: '…', id: 't1' },
				contextItems: [],
			},
		];
		assert.strictEqual(buildKnoxAgentActivitySteps(history, 0)[0].status, 'done');
		assert.strictEqual(buildKnoxAgentActivitySteps(history, 0, { inProgress: true })[0].status, 'running');
	});
});

suite('summarize / visible / current', () => {
	test('counts kinds and hides older steps when collapsed', () => {
		const steps = [
			{ id: '1', kind: 'thinking' as const, status: 'done' as const, historyIndex: 0 },
			{ id: '2', kind: 'read' as const, status: 'done' as const, historyIndex: 1 },
			{ id: '3', kind: 'edit' as const, status: 'running' as const, historyIndex: 2 },
			{ id: '4', kind: 'test' as const, status: 'pending' as const, historyIndex: 3 },
		];
		assert.deepStrictEqual(summarizeKnoxActivity(steps), {
			thinking: 1,
			reads: 1,
			searches: 0,
			edits: 1,
			tests: 1,
			other: 0,
			running: true,
		});
		assert.strictEqual(currentKnoxActivityStep(steps)?.id, '3');
		const collapsed = visibleKnoxActivitySteps(steps, false, 2);
		assert.strictEqual(collapsed.hiddenCount, 2);
		assert.deepStrictEqual(collapsed.visible.map(s => s.id), ['3', '4']);
	});
});

suite('turn meter helpers', () => {
	test('estimates tokens from prompt logs and formats counts', () => {
		assert.strictEqual(estimateKnoxTokensFromPromptLogs([
			{ modelTitle: 'm', prompt: 'abcd', completion: 'efgh' },
		]), 2);
		assert.strictEqual(formatKnoxTokenCount(420), '420');
		assert.strictEqual(formatKnoxTokenCount(4200), '4.2k');
		assert.strictEqual(formatKnoxTokenCount(42_000), '42k');
		assert.strictEqual(formatKnoxTokenCount(1_356_000), '1.4m');
	});

	test('collects prompt logs for the current turn only', () => {
		const history: IKnoxChatHistoryItem[] = [
			{
				...user(),
				promptLogs: [{ modelTitle: 'm', prompt: 'aa', completion: 'bb' }],
			},
			{
				message: { role: 'assistant', content: 'x', id: 'a' },
				contextItems: [],
				promptLogs: [{ modelTitle: 'm', prompt: 'cc', completion: 'dd' }],
			},
			user('u2'),
		];
		assert.strictEqual(collectKnoxTurnPromptLogs(history, 0).length, 2);
		assert.strictEqual(collectKnoxTurnPromptLogs(history, 2).length, 0);
	});

	test('formats duration and measures turn elapsed time', () => {
		assert.strictEqual(formatKnoxDurationMs(1500), '1s');
		assert.strictEqual(formatKnoxDurationMs(65_000), '1m 5s');
		assert.strictEqual(formatKnoxDurationMs(3_600_000), '1h');
		assert.strictEqual(formatKnoxElapsed(3.2), '3.2s');
		assert.strictEqual(formatKnoxElapsed(75.4), '1m 15.4s');
		assert.strictEqual(formatKnoxElapsed(-1), '0.0s');

		const start = '2026-08-16T00:00:00.000Z';
		const mid = '2026-08-16T00:00:10.000Z';
		const history: IKnoxChatHistoryItem[] = [
			{
				message: { role: 'user', content: 'hi', id: 'u', createdAt: start },
				contextItems: [],
			},
			{
				message: { role: 'assistant', content: 'ok', id: 'a', createdAt: mid },
				contextItems: [],
			},
		];
		assert.strictEqual(knoxTurnElapsedMs(history, 0, Date.parse(mid), false), 10_000);
		assert.strictEqual(knoxTurnElapsedMs(history, 0, Date.parse(start) + 25_000, true), 25_000);
	});

	test('summarizes Jev prompt-log route/skill (T9.2)', () => {
		assert.deepStrictEqual(summarizeJevPromptLogs([
			{ modelTitle: 'm', prompt: 'p', completion: 'c' },
			{
				modelTitle: 'm',
				prompt: 'p',
				completion: 'c',
				jev: { turn: { source: 'jev', route: 'code', skill: 'rust', confidence: 0.9, reason: 'ok' } },
			},
		]), { route: 'code', skill: 'rust', source: 'jev' });
		assert.strictEqual(summarizeJevPromptLogs([]), undefined);
	});
});
