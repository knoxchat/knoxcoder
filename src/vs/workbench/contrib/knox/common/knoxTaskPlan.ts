/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifyKnoxToolKind, knoxToolStepDetail, KnoxAgentActivityKind } from './knoxAgentActivity.js';
import { getHistoryToolStates } from './knoxChatHistory.js';
import {
	IKnoxChatHistoryItem,
	IKnoxContextItem,
	IKnoxToolCallState,
	renderKnoxChatMessage,
} from './knoxChatTypes.js';
import { isFailedToolOutput } from './knoxDoomLoop.js';
import { KnoxBuiltInToolName } from './knoxToolNames.js';

export const KNOX_TASK_EXECUTION_PLAN_MARKER = 'Task Execution Plan';
export const KNOX_PLAN_CLEARED_TEXT = 'Task Execution Plan cleared.';

export type KnoxPlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface IKnoxPlanStep {
	id: string;
	title: string;
	status: KnoxPlanStepStatus;
}

export interface IKnoxTaskPlan {
	title: string;
	steps: IKnoxPlanStep[];
	updatedAt: number;
}

export interface IKnoxLivePlanStep extends IKnoxPlanStep {
	activity?: string;
	live?: boolean;
}

export interface IKnoxLiveTaskPlan extends IKnoxTaskPlan {
	steps: IKnoxLivePlanStep[];
	remaining: number;
	doneCount: number;
	current?: IKnoxLivePlanStep;
	updating: boolean;
}

export interface IKnoxTaskPlanSnapshot {
	plan: IKnoxTaskPlan;
	historyIndex: number;
}

export type KnoxStepIntent = 'write' | 'shell' | 'test' | 'read' | 'any';

const PLAN_OUTPUT_DESCRIPTIONS = new Set([
	'created',
	'updated',
	'listed',
	'cleared',
	'empty',
	'error',
]);

const WRITE_TOOLS = new Set<string>([
	KnoxBuiltInToolName.EditFile,
	KnoxBuiltInToolName.WriteFile,
	KnoxBuiltInToolName.ApplyPatch,
	KnoxBuiltInToolName.CreateNewFile,
	'composite_smart_edit',
]);

const SHELL_TOOLS = new Set<string>([
	KnoxBuiltInToolName.RunTerminalCommand,
	KnoxBuiltInToolName.AwaitShell,
	KnoxBuiltInToolName.PtyStart,
	KnoxBuiltInToolName.Build,
	KnoxBuiltInToolName.Qemu,
]);

const TEST_TOOLS = new Set<string>([KnoxBuiltInToolName.GenerateTests]);

const READ_TOOLS = new Set<string>([
	KnoxBuiltInToolName.ReadFile,
	KnoxBuiltInToolName.ReadCurrentlyOpenFile,
	KnoxBuiltInToolName.ViewSubdirectory,
	KnoxBuiltInToolName.Glob,
	KnoxBuiltInToolName.ExactSearch,
	KnoxBuiltInToolName.EnhancedSearch,
]);

const PATH_HINT_RE = /[A-Za-z0-9_./+-]+\.[A-Za-z][A-Za-z0-9]{0,7}/g;
const MATCH_THRESHOLD = 8;

function statusMark(status: KnoxPlanStepStatus): string {
	switch (status) {
		case 'done': return 'x';
		case 'in_progress': return '*';
		case 'skipped': return '-';
		default: return ' ';
	}
}

function markToStatus(mark: string): KnoxPlanStepStatus {
	switch (mark) {
		case 'x': return 'done';
		case '*': return 'in_progress';
		case '-': return 'skipped';
		default: return 'pending';
	}
}

export function knoxCountPlanRemaining(plan: Pick<IKnoxTaskPlan, 'steps'>): number {
	return plan.steps.filter(step => step.status === 'pending' || step.status === 'in_progress').length;
}

export function knoxCurrentPlanStep(plan: Pick<IKnoxTaskPlan, 'steps'>): IKnoxPlanStep | undefined {
	return plan.steps.find(step => step.status === 'in_progress');
}

export function knoxParsePlanText(text: string): IKnoxTaskPlan | undefined {
	if (!text.includes(KNOX_TASK_EXECUTION_PLAN_MARKER)) {
		return undefined;
	}
	let title = 'Task plan';
	const steps: IKnoxPlanStep[] = [];
	for (const line of text.split(/\r?\n/)) {
		const titleMatch = /^Title:\s*(.*)$/.exec(line);
		if (titleMatch) {
			title = titleMatch[1].trim() || title;
			continue;
		}
		const stepMatch = /^\d+\. \[([ x*\-])\] (.*) \(([^)]+)\)\s*$/.exec(line);
		if (stepMatch) {
			steps.push({
				id: stepMatch[3],
				title: stepMatch[2],
				status: markToStatus(stepMatch[1]),
			});
		}
	}
	return { title, steps, updatedAt: 0 };
}

export function knoxFormatPlanText(plan: IKnoxTaskPlan): string {
	const lines = [
		`## ${KNOX_TASK_EXECUTION_PLAN_MARKER}`,
		'[pinned]',
		`Title: ${plan.title}`,
	];
	if (plan.steps.length === 0) {
		lines.push('(no steps yet)');
	} else {
		plan.steps.forEach((step, index) => {
			lines.push(`${index + 1}. [${statusMark(step.status)}] ${step.title} (${step.id})`);
		});
	}
	lines.push(`${knoxCountPlanRemaining(plan)} remaining / ${plan.steps.length} total`);
	return lines.join('\n');
}

export function knoxIsTaskPlanContextItem(
	item: Pick<IKnoxContextItem, 'name' | 'content' | 'description'>,
): boolean {
	if (item.content?.includes(KNOX_TASK_EXECUTION_PLAN_MARKER)) {
		return true;
	}
	if (item.content?.includes(KNOX_PLAN_CLEARED_TEXT)) {
		return true;
	}
	return item.name === 'Plan' && PLAN_OUTPUT_DESCRIPTIONS.has(item.description);
}

export function knoxIsVisibleTaskPlanPeekItem(
	item: Pick<IKnoxContextItem, 'name' | 'content' | 'description'>,
): boolean {
	if (!knoxIsTaskPlanContextItem(item)) {
		return true;
	}
	return item.description === 'error';
}

export function knoxTaskPlanFingerprint(plan: IKnoxTaskPlan): string {
	return `${plan.title}|${plan.steps.map(step => `${step.id}:${step.status}`).join(',')}`;
}

function isClearedPlanContent(item: Pick<IKnoxContextItem, 'name' | 'content' | 'description'>): boolean {
	if (item.description === 'cleared') {
		return true;
	}
	return Boolean(item.content?.includes(KNOX_PLAN_CLEARED_TEXT));
}

export function knoxCollectLatestTaskPlanSnapshot(
	history: readonly IKnoxChatHistoryItem[],
): IKnoxTaskPlanSnapshot | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		for (const ctx of item.contextItems ?? []) {
			if (!knoxIsTaskPlanContextItem(ctx)) {
				continue;
			}
			if (isClearedPlanContent(ctx)) {
				return undefined;
			}
			const parsed = knoxParsePlanText(ctx.content);
			if (parsed) {
				return { plan: parsed, historyIndex: i };
			}
		}
		const content = item.message.role === 'tool' ? renderKnoxChatMessage(item.message) : '';
		if (content.includes(KNOX_PLAN_CLEARED_TEXT)) {
			return undefined;
		}
		const parsed = knoxParsePlanText(content);
		if (parsed) {
			return { plan: parsed, historyIndex: i };
		}
	}
	return undefined;
}

export function knoxCollectLatestTaskPlan(history: readonly IKnoxChatHistoryItem[]): IKnoxTaskPlan | undefined {
	return knoxCollectLatestTaskPlanSnapshot(history)?.plan;
}

export function knoxIsTaskPlanUpdating(history: readonly IKnoxChatHistoryItem[]): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const states = getHistoryToolStates(history[i]);
		for (let j = states.length - 1; j >= 0; j--) {
			const state = states[j];
			if (state.toolCall?.function?.name !== KnoxBuiltInToolName.Plan) {
				continue;
			}
			return state.status === 'generating' || state.status === 'generated' || state.status === 'calling';
		}
	}
	return false;
}

type ToolEvent = {
	kind: KnoxAgentActivityKind;
	toolName: string;
	path?: string;
	command?: string;
	running: boolean;
	failed: boolean;
	activity?: string;
};

function basename(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || path;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export function knoxExtractPathHints(title: string): string[] {
	const matches = title.match(PATH_HINT_RE) ?? [];
	return matches.filter(hint => !/^\d/.test(hint) && !/alpha|beta|rc\d/i.test(hint));
}

export function knoxStepIntent(title: string): KnoxStepIntent {
	if (
		/\bcargo\s+(check|build|test|clippy|nextest|bench|doc|miri)\b/i.test(title) ||
		/\b(npm|pnpm|yarn|bun)\s+(test|run|build)\b/i.test(title) ||
		/\bmake\s+\S+/i.test(title) ||
		/\b(qemu|cargo check|cargo build)\b/i.test(title)
	) {
		return 'shell';
	}
	if (/\b(unit tests?|add tests?|generate tests?|kselftest)\b/i.test(title)) {
		return 'test';
	}
	if (knoxExtractPathHints(title).length > 0 || /\b(create|write|add|edit|patch|implement|fix)\b/i.test(title)) {
		return 'write';
	}
	if (/\b(read|explore|inspect|look|parse)\b/i.test(title)) {
		return 'read';
	}
	return 'any';
}

function eventFitsIntent(intent: KnoxStepIntent, event: ToolEvent): boolean {
	if (event.running) {
		if (intent === 'write') {
			return WRITE_TOOLS.has(event.toolName) || event.kind === 'edit';
		}
		if (intent === 'shell') {
			return SHELL_TOOLS.has(event.toolName) || event.kind === 'shell';
		}
		if (intent === 'test') {
			return TEST_TOOLS.has(event.toolName) || event.kind === 'test' || SHELL_TOOLS.has(event.toolName);
		}
		if (intent === 'read') {
			return READ_TOOLS.has(event.toolName) || event.kind === 'read';
		}
		return event.kind !== 'thinking' && event.kind !== 'reply';
	}
	if (intent === 'write') {
		return WRITE_TOOLS.has(event.toolName) || event.kind === 'edit';
	}
	if (intent === 'shell') {
		return SHELL_TOOLS.has(event.toolName) || event.kind === 'shell' || event.kind === 'test';
	}
	if (intent === 'test') {
		return TEST_TOOLS.has(event.toolName) || event.kind === 'test';
	}
	if (intent === 'read') {
		return READ_TOOLS.has(event.toolName) || event.kind === 'read' || event.kind === 'search';
	}
	return true;
}

export function knoxScoreStepEvent(step: IKnoxPlanStep, event: {
	kind: KnoxAgentActivityKind;
	toolName: string;
	path?: string;
	command?: string;
	running: boolean;
	failed: boolean;
	activity?: string;
}): number {
	if (!eventFitsIntent(knoxStepIntent(step.title), event)) {
		return 0;
	}
	let score = 0;
	const title = step.title.toLowerCase();
	const path = event.path ? normalizePath(event.path) : '';
	const base = path ? basename(path) : '';
	for (const hint of knoxExtractPathHints(step.title)) {
		const normalized = normalizePath(hint);
		const hintBase = basename(normalized);
		if (path && (path === normalized || path.endsWith(`/${normalized}`))) {
			score += 14;
		} else if (base && hintBase && base === hintBase) {
			score += 12;
		} else if (path && path.includes(normalized)) {
			score += 8;
		}
	}
	if (base && title.includes(base)) {
		score += 8;
	}
	const command = event.command?.toLowerCase() ?? '';
	if (command) {
		if (/\bcargo\s+check\b/i.test(step.title) && /\bcargo\s+check\b/.test(command)) {
			score += 14;
		}
		if (/\bcargo\s+build\b/i.test(step.title) && /\bcargo\s+build\b/.test(command)) {
			score += 14;
		}
		if (/\bcargo\b/i.test(step.title) && /\bcargo\s+check\b/.test(command)) {
			score += 10;
		}
		if (/\bcargo\b/i.test(step.title) && /\bcargo\s+build\b/.test(command)) {
			score += 10;
		}
		if ((/\btest\b/i.test(step.title) || knoxStepIntent(step.title) === 'test') && (/\btest\b/.test(command) || event.kind === 'test')) {
			score += 10;
		}
	} else if (event.kind === 'test' && knoxStepIntent(step.title) === 'test') {
		score += 10;
	}
	return score;
}

function argString(args: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	if (!args) {
		return undefined;
	}
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function patchPath(patch: string): string | undefined {
	const match = patch.match(/\*\*\* (?:Add|Update|Delete|Move) File: (.+)/);
	return match?.[1]?.trim();
}

function eventFromTool(state: IKnoxToolCallState): ToolEvent | undefined {
	const toolName = state.toolCall?.function?.name;
	if (!toolName || toolName === KnoxBuiltInToolName.Plan) {
		return undefined;
	}
	const args = state.parsedArgs && typeof state.parsedArgs === 'object'
		? state.parsedArgs as Record<string, unknown>
		: undefined;
	const path = argString(args, ['filepath', 'path', 'file_path', 'target_file', 'filename'])
		?? (typeof args?.patch === 'string' ? patchPath(args.patch) : undefined);
	const command = argString(args, ['command']);
	const failed = state.status === 'canceled' || isFailedToolOutput(state.output);
	const running = !failed && (state.status === 'generating' || state.status === 'generated' || state.status === 'calling');
	return {
		kind: classifyKnoxToolKind(toolName, state.parsedArgs),
		toolName,
		path,
		command,
		running,
		failed,
		activity: knoxToolStepDetail(toolName, state.parsedArgs),
	};
}

function collectEventsAfter(history: readonly IKnoxChatHistoryItem[], afterIndex: number): ToolEvent[] {
	const events: ToolEvent[] = [];
	for (let i = afterIndex + 1; i < history.length; i++) {
		for (const state of getHistoryToolStates(history[i])) {
			const event = eventFromTool(state);
			if (event) {
				events.push(event);
			}
		}
	}
	return events;
}

function bestMatch(steps: IKnoxLivePlanStep[], event: ToolEvent): IKnoxLivePlanStep | undefined {
	let best: IKnoxLivePlanStep | undefined;
	let bestScore = 0;
	for (const step of steps) {
		if (step.status === 'skipped') {
			continue;
		}
		const score = knoxScoreStepEvent(step, event);
		if (score > bestScore) {
			bestScore = score;
			best = step;
		}
	}
	return bestScore >= MATCH_THRESHOLD ? best : undefined;
}

function applyEvent(steps: IKnoxLivePlanStep[], event: ToolEvent): void {
	const match = bestMatch(steps, event);
	if (!match) {
		return;
	}
	if (match.status === 'done' && !event.running) {
		if (event.activity) {
			match.activity = event.activity;
		}
		return;
	}
	if (event.failed) {
		if (match.status === 'in_progress') {
			match.status = 'pending';
			match.live = true;
		}
		return;
	}
	const next: KnoxPlanStepStatus = event.running ? 'in_progress' : 'done';
	if (next === 'in_progress') {
		for (const step of steps) {
			if (step !== match && step.status === 'in_progress') {
				step.status = 'pending';
				step.live = true;
			}
		}
	}
	if (match.status === 'done' && next === 'in_progress') {
		return;
	}
	match.status = next;
	match.live = true;
	if (event.activity) {
		match.activity = event.activity;
	}
}

export function knoxApplyLivePlanProgress(
	plan: IKnoxTaskPlan,
	history: readonly IKnoxChatHistoryItem[],
	snapshotIndex: number,
): IKnoxLiveTaskPlan {
	const steps: IKnoxLivePlanStep[] = plan.steps.map(step => ({ ...step }));
	for (const event of collectEventsAfter(history, snapshotIndex)) {
		applyEvent(steps, event);
	}
	const livePlan = { ...plan, steps };
	return {
		...livePlan,
		remaining: knoxCountPlanRemaining(livePlan),
		doneCount: steps.filter(step => step.status === 'done').length,
		current: knoxCurrentPlanStep(livePlan) as IKnoxLivePlanStep | undefined,
		updating: knoxIsTaskPlanUpdating(history) || steps.some(s => s.status === 'in_progress'),
	};
}

export function knoxCollectLiveTaskPlan(history: readonly IKnoxChatHistoryItem[]): IKnoxLiveTaskPlan | undefined {
	const snapshot = knoxCollectLatestTaskPlanSnapshot(history);
	if (!snapshot) {
		return undefined;
	}
	return knoxApplyLivePlanProgress(snapshot.plan, history, snapshot.historyIndex);
}

export function knoxTaskPlanFillPercent(plan: IKnoxLiveTaskPlan): number {
	if (plan.steps.length === 0) {
		return 0;
	}
	const currentBoost = plan.current ? 0.4 : 0;
	return Math.min(100, ((plan.doneCount + currentBoost) / plan.steps.length) * 100);
}

export function knoxTaskPlanStructureKey(plan: IKnoxTaskPlan | undefined): string {
	if (!plan) {
		return '';
	}
	return `${plan.title}|${plan.steps.map(s => s.id).join(',')}`;
}
