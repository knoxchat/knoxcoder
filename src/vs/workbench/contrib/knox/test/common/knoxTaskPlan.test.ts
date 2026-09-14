/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import {
	knoxApplyLivePlanProgress,
	knoxCollectLatestTaskPlan,
	knoxExtractPathHints,
	knoxFormatPlanText,
	knoxIsTaskPlanUpdating,
	knoxIsVisibleTaskPlanPeekItem,
	knoxScoreStepEvent,
	knoxStepIntent,
	knoxTaskPlanFingerprint,
	IKnoxTaskPlan,
} from '../../common/knoxTaskPlan.js';

const SAMPLE: IKnoxTaskPlan = {
	title: 'Build Snake Game with Dioxus 0.8',
	updatedAt: 1,
	steps: [
		{ id: '1-create-cargo', title: 'Create Cargo.toml', status: 'pending' },
		{ id: '2-write-main', title: 'Write src/main.rs', status: 'in_progress' },
		{ id: '3-add-tests', title: 'Add unit tests', status: 'done' },
	],
};

const SNAKE: IKnoxTaskPlan = {
	title: 'Snake game with Dioxus 0.8',
	updatedAt: 1,
	steps: [
		{ id: '1-cargo', title: 'Create snake/Cargo.toml with dioxus 0.8 deps', status: 'pending' },
		{ id: '2-main', title: 'Write snake/src/main.rs game logic + UI', status: 'pending' },
		{ id: '3-css', title: 'Add style.css', status: 'pending' },
		{ id: '4-check', title: 'cargo check / build to verify', status: 'pending' },
	],
};

function planToolItem(content: string, description = 'created'): IKnoxChatHistoryItem {
	return {
		message: { role: 'tool', content, toolCallId: 'p1', id: 't1' },
		contextItems: [{
			name: 'Plan',
			description,
			content,
			id: { providerTitle: 'toolCall', itemId: 'p1' },
		}],
	};
}

function fileTool(name: string, filepath: string, status: IKnoxToolCallState['status'] = 'done', id = filepath): IKnoxChatHistoryItem {
	return {
		message: {
			role: 'assistant',
			content: '',
			id,
			toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify({ filepath }) } }],
		},
		contextItems: [],
		toolCallStates: [{
			toolCallId: id,
			status,
			parsedArgs: { filepath },
			toolCall: { id, type: 'function', function: { name, arguments: JSON.stringify({ filepath }) } },
		}],
	};
}

function shellTool(command: string, status: IKnoxToolCallState['status'] = 'done', id = command): IKnoxChatHistoryItem {
	return {
		message: {
			role: 'assistant',
			content: '',
			id,
			toolCalls: [{
				id,
				type: 'function',
				function: { name: KnoxBuiltInToolName.RunTerminalCommand, arguments: JSON.stringify({ command }) },
			}],
		},
		contextItems: [],
		toolCallStates: [{
			toolCallId: id,
			status,
			parsedArgs: { command },
			toolCall: {
				id,
				type: 'function',
				function: { name: KnoxBuiltInToolName.RunTerminalCommand, arguments: JSON.stringify({ command }) },
			},
		}],
	};
}

suite('knox task plan (T5.9)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the newest formatted plan from tool output', () => {
		const history: IKnoxChatHistoryItem[] = [
			{ message: { role: 'user', content: 'build snake', id: 'u' }, contextItems: [] },
			planToolItem(knoxFormatPlanText(SAMPLE)),
		];
		const plan = knoxCollectLatestTaskPlan(history);
		assert.strictEqual(plan?.title, SAMPLE.title);
		assert.deepStrictEqual(plan?.steps.map(s => s.status), ['pending', 'in_progress', 'done']);
	});

	test('hides after a later clear', () => {
		const history = [
			planToolItem(knoxFormatPlanText(SAMPLE)),
			planToolItem('Task Execution Plan cleared.', 'cleared'),
		];
		assert.strictEqual(knoxCollectLatestTaskPlan(history), undefined);
	});

	test('is updating while builtin_plan is in flight', () => {
		const history: IKnoxChatHistoryItem[] = [{
			message: {
				role: 'assistant',
				content: '',
				id: 'a',
				toolCalls: [{ id: 'p2', type: 'function', function: { name: KnoxBuiltInToolName.Plan, arguments: '{}' } }],
			},
			contextItems: [],
			toolCallStates: [{
				toolCallId: 'p2',
				status: 'calling',
				parsedArgs: { action: 'complete' },
				toolCall: { id: 'p2', type: 'function', function: { name: KnoxBuiltInToolName.Plan, arguments: '{}' } },
			}],
		}];
		assert.strictEqual(knoxIsTaskPlanUpdating(history), true);
	});

	test('keeps errors in the stream and hides successful plan dumps', () => {
		assert.strictEqual(knoxIsVisibleTaskPlanPeekItem({
			name: 'Plan',
			description: 'created',
			content: knoxFormatPlanText(SAMPLE),
		}), false);
		assert.strictEqual(knoxIsVisibleTaskPlanPeekItem({
			name: 'Plan',
			description: 'error',
			content: 'No plan step matching 9.',
		}), true);
	});

	test('fingerprint changes when a step status changes', () => {
		const next: IKnoxTaskPlan = {
			...SAMPLE,
			steps: SAMPLE.steps.map(s => s.id === '2-write-main' ? { ...s, status: 'done' } : s),
		};
		assert.notStrictEqual(knoxTaskPlanFingerprint(next), knoxTaskPlanFingerprint(SAMPLE));
	});

	test('picks file paths and ignores version numbers', () => {
		assert.deepStrictEqual(
			knoxExtractPathHints('Create snake/Cargo.toml with dioxus 0.8.0-alpha.1'),
			['snake/Cargo.toml'],
		);
		assert.strictEqual(knoxStepIntent('Create snake/Cargo.toml with dioxus 0.8 deps'), 'write');
		assert.strictEqual(knoxStepIntent('cargo check / build to verify'), 'shell');
		assert.strictEqual(knoxStepIntent('Add unit tests for game logic'), 'test');
	});

	test('scores Cargo.toml writes onto the cargo step, not main.rs', () => {
		const cargo = SNAKE.steps[0];
		const main = SNAKE.steps[1];
		const event = {
			kind: 'edit' as const,
			toolName: KnoxBuiltInToolName.CreateNewFile,
			path: 'snake/Cargo.toml',
			running: false,
			failed: false,
		};
		assert.ok(knoxScoreStepEvent(cargo, event) > knoxScoreStepEvent(main, event));
		assert.ok(knoxScoreStepEvent(cargo, event) >= 8);
	});

	test('marks a created file done and a later write in progress', () => {
		const history = [
			planToolItem(knoxFormatPlanText(SNAKE)),
			fileTool(KnoxBuiltInToolName.CreateNewFile, 'snake/Cargo.toml'),
			fileTool(KnoxBuiltInToolName.WriteFile, 'snake/src/main.rs', 'calling'),
		];
		const live = knoxApplyLivePlanProgress(SNAKE, history, 0);
		assert.deepStrictEqual(live.steps.map(s => s.status), ['done', 'in_progress', 'pending', 'pending']);
		assert.strictEqual(live.doneCount, 1);
		assert.strictEqual(live.remaining, 3);
		assert.strictEqual(live.current?.id, '2-main');
		assert.strictEqual(live.updating, true);
	});

	test('does not complete a write step from a mere file read', () => {
		const history = [
			planToolItem(knoxFormatPlanText(SNAKE)),
			fileTool(KnoxBuiltInToolName.ReadFile, 'snake/Cargo.toml'),
		];
		const live = knoxApplyLivePlanProgress(SNAKE, history, 0);
		assert.strictEqual(live.steps[0].status, 'pending');
	});

	test('matches cargo check onto the verify step', () => {
		const history = [
			planToolItem(knoxFormatPlanText(SNAKE)),
			fileTool(KnoxBuiltInToolName.CreateNewFile, 'snake/Cargo.toml'),
			shellTool('cd snake && cargo check'),
		];
		const live = knoxApplyLivePlanProgress(SNAKE, history, 0);
		assert.strictEqual(live.steps[0].status, 'done');
		assert.strictEqual(live.steps[3].status, 'done');
	});

	test('does not mark done when the matching tool failed', () => {
		const created = fileTool(KnoxBuiltInToolName.CreateNewFile, 'snake/Cargo.toml');
		created.toolCallStates = [{
			toolCallId: 'snake/Cargo.toml',
			status: 'done',
			parsedArgs: { filepath: 'snake/Cargo.toml' },
			output: [{
				name: 'Tool Call Error',
				description: 'error',
				content: 'Tool call "builtin_create_new_file" failed',
			}],
			toolCall: {
				id: 'snake/Cargo.toml',
				type: 'function',
				function: { name: KnoxBuiltInToolName.CreateNewFile, arguments: '{}' },
			},
		}];
		const live = knoxApplyLivePlanProgress(SNAKE, [planToolItem(knoxFormatPlanText(SNAKE)), created], 0);
		assert.strictEqual(live.steps[0].status, 'pending');
	});
});
