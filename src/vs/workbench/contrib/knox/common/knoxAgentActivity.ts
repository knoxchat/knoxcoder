/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getHistoryToolStates } from './knoxChatHistory.js';
import {
	IKnoxChatHistoryItem,
	IKnoxContextItem,
	IKnoxPromptLog,
	IKnoxToolCallState,
	KnoxToolStatus,
	messageHasVisibleContent,
} from './knoxChatTypes.js';
import { KnoxBuiltInToolName } from './knoxToolNames.js';

export type KnoxAgentActivityKind =
	| 'thinking'
	| 'read'
	| 'search'
	| 'edit'
	| 'test'
	| 'shell'
	| 'git'
	| 'task'
	| 'ask'
	| 'reply'
	| 'other';

export type KnoxAgentActivityStatus = 'pending' | 'running' | 'done' | 'canceled';

export type KnoxLoadingVariant = 'drive' | 'dots' | 'orbit';

export interface IKnoxAgentActivityStep {
	id: string;
	kind: KnoxAgentActivityKind;
	status: KnoxAgentActivityStatus;
	toolName?: string;
	detail?: string;
	historyIndex: number;
	workspaceCheckpointId?: string;
}

const READ_TOOLS = new Set<string>([
	KnoxBuiltInToolName.ReadFile,
	KnoxBuiltInToolName.ReadCurrentlyOpenFile,
	KnoxBuiltInToolName.ViewSubdirectory,
	KnoxBuiltInToolName.Glob,
	KnoxBuiltInToolName.ViewRepoMap,
	KnoxBuiltInToolName.ViewDiff,
	KnoxBuiltInToolName.Kconfig,
]);

const SEARCH_TOOLS = new Set<string>([
	KnoxBuiltInToolName.ExactSearch,
	KnoxBuiltInToolName.EnhancedSearch,
	KnoxBuiltInToolName.SearchWeb,
]);

const EDIT_TOOLS = new Set<string>([
	KnoxBuiltInToolName.EditFile,
	KnoxBuiltInToolName.WriteFile,
	KnoxBuiltInToolName.ApplyPatch,
	KnoxBuiltInToolName.CreateNewFile,
	'composite_smart_edit',
]);

const GIT_TOOLS = new Set<string>([
	KnoxBuiltInToolName.GitStatus,
	KnoxBuiltInToolName.GitDiff,
	KnoxBuiltInToolName.GitLog,
	KnoxBuiltInToolName.GitBlame,
	KnoxBuiltInToolName.GitCommit,
	KnoxBuiltInToolName.GitBisect,
]);

/** Test runners only — not every command that mentions "test". */
const TEST_COMMAND_RE =
	/(^|[\s;&|])((npm|pnpm|yarn|bun|npx)\s+(run\s+)?(test|vitest|jest)|pytest\b|vitest\b|jest\b|mocha\b|phpunit\b|go\s+test\b|cargo\s+test\b|make\s+test\b)\b/i;

const SOUL_CHECKPOINT_RE = /\[soul checkpoint=([^\s\]]+)\]/;
const CHARS_PER_TOKEN = 4;
const COLLAPSED_VISIBLE = 8;
const TOKEN_COUNT_SUFFIXES = ['', 'k', 'm', 'b', 't'] as const;

export function knoxActivityAnchorId(stepId: string): string {
	return `agent-activity-${stepId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function mapKnoxToolStatus(status: KnoxToolStatus): KnoxAgentActivityStatus {
	switch (status) {
		case 'calling':
			return 'running';
		case 'done':
			return 'done';
		case 'canceled':
			return 'canceled';
		case 'generating':
		case 'generated':
		default:
			return 'pending';
	}
}

export function classifyKnoxToolKind(
	toolName: string | undefined,
	args?: unknown,
): KnoxAgentActivityKind {
	if (!toolName) {
		return 'other';
	}
	if (toolName === KnoxBuiltInToolName.GenerateTests) {
		return 'test';
	}
	if (
		toolName === KnoxBuiltInToolName.RunTerminalCommand ||
		toolName === KnoxBuiltInToolName.AwaitShell ||
		toolName === KnoxBuiltInToolName.PtyStart ||
		toolName === KnoxBuiltInToolName.PtySend ||
		toolName === KnoxBuiltInToolName.PtyRead ||
		toolName === KnoxBuiltInToolName.Qemu ||
		toolName === KnoxBuiltInToolName.Debug ||
		toolName === KnoxBuiltInToolName.Build
	) {
		const record = args && typeof args === 'object'
			? args as { command?: unknown; action?: unknown }
			: {};
		if (toolName === KnoxBuiltInToolName.Build && record.action === 'test') {
			return 'test';
		}
		const command = typeof record.command === 'string' ? record.command : '';
		return TEST_COMMAND_RE.test(command) ? 'test' : 'shell';
	}
	if (READ_TOOLS.has(toolName)) {
		return 'read';
	}
	if (SEARCH_TOOLS.has(toolName)) {
		return 'search';
	}
	if (EDIT_TOOLS.has(toolName)) {
		return 'edit';
	}
	if (GIT_TOOLS.has(toolName)) {
		return 'git';
	}
	if (toolName === KnoxBuiltInToolName.Task) {
		return 'task';
	}
	if (toolName === KnoxBuiltInToolName.AskUser) {
		return 'ask';
	}
	if (toolName === KnoxBuiltInToolName.WorkspaceCheckpoint) {
		return 'edit';
	}
	return 'other';
}

function basename(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || path;
}

function truncate(text: string, max: number): string {
	const trimmed = text.replace(/\s+/g, ' ').trim();
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}…`;
}

function firstPatchPath(patch: string): string | undefined {
	const match = patch.match(/\*\*\* (?:Add|Update|Delete|Move) File: (.+)/);
	return match?.[1]?.trim();
}

export function knoxToolStepDetail(
	toolName: string | undefined,
	args: unknown,
): string | undefined {
	if (!args || typeof args !== 'object') {
		return undefined;
	}
	const record = args as Record<string, unknown>;
	const pathLike =
		record.filepath ??
		record.path ??
		record.file_path ??
		record.target_directory ??
		record.directory_path;
	if (typeof pathLike === 'string' && pathLike) {
		return basename(pathLike);
	}
	if (typeof record.command === 'string' && record.command) {
		return truncate(record.command, 64);
	}
	if (toolName === KnoxBuiltInToolName.Build) {
		const action = typeof record.action === 'string' ? record.action : '';
		const extra =
			(typeof record.extraArgs === 'string' && record.extraArgs) ||
			(typeof record.extra_args === 'string' && record.extra_args) ||
			'';
		const detail = [action, extra].filter(Boolean).join(' ');
		if (detail) {
			return truncate(detail, 64);
		}
	}
	if (typeof record.pattern === 'string' && record.pattern) {
		return truncate(record.pattern, 48);
	}
	if (typeof record.query === 'string' && record.query) {
		return truncate(record.query, 48);
	}
	if (typeof record.prompt === 'string' && record.prompt) {
		return truncate(record.prompt, 48);
	}
	if (typeof record.profile === 'string' && record.profile) {
		return record.profile;
	}
	if (typeof record.patch === 'string' && record.patch) {
		const file = firstPatchPath(record.patch);
		return file ? basename(file) : 'patch';
	}
	if (toolName === KnoxBuiltInToolName.WorkspaceCheckpoint) {
		if (typeof record.checkpoint_id === 'string' && record.checkpoint_id) {
			return truncate(record.checkpoint_id, 16);
		}
		if (typeof record.action === 'string' && record.action) {
			return record.action;
		}
	}
	if (toolName === KnoxBuiltInToolName.ReadCurrentlyOpenFile) {
		return 'current file';
	}
	return undefined;
}

export function extractKnoxSoulCheckpointId(
	content: string | readonly IKnoxContextItem[] | undefined,
): string | undefined {
	if (!content) {
		return undefined;
	}
	if (typeof content === 'string') {
		return content.match(SOUL_CHECKPOINT_RE)?.[1];
	}
	for (const item of content) {
		const id = item.content?.match(SOUL_CHECKPOINT_RE)?.[1];
		if (id) {
			return id;
		}
	}
	return undefined;
}

function historyMessageId(item: IKnoxChatHistoryItem, fallback: number): string {
	return item.message.id ?? item.messageId ?? String(fallback);
}

function stepFromTool(state: IKnoxToolCallState, historyIndex: number): IKnoxAgentActivityStep {
	const toolName = state.toolCall.function?.name;
	return {
		id: `tool:${state.toolCallId || state.toolCall.id}`,
		kind: classifyKnoxToolKind(toolName, state.parsedArgs),
		status: mapKnoxToolStatus(state.status),
		toolName,
		detail: knoxToolStepDetail(toolName, state.parsedArgs),
		historyIndex,
		workspaceCheckpointId: extractKnoxSoulCheckpointId(state.output),
	};
}

/**
 * Compact activity steps for one user turn (items after `userIndex`
 * until the next user message). Tool result rows are skipped.
 */
export function buildKnoxAgentActivitySteps(
	history: readonly IKnoxChatHistoryItem[],
	userIndex: number,
	options?: { inProgress?: boolean },
): IKnoxAgentActivityStep[] {
	if (userIndex < 0 || userIndex >= history.length) {
		return [];
	}
	if (history[userIndex]?.message.role !== 'user') {
		return [];
	}

	const steps: IKnoxAgentActivityStep[] = [];

	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.message.role === 'user') {
			break;
		}
		if (item.message.role === 'tool') {
			continue;
		}

		if (item.message.role === 'thinking') {
			const last = i === history.length - 1;
			steps.push({
				id: `thinking:${historyMessageId(item, i)}`,
				kind: 'thinking',
				status: last && options?.inProgress ? 'running' : 'done',
				historyIndex: i,
			});
			continue;
		}

		if (item.reasoning?.text || item.reasoning?.active) {
			steps.push({
				id: `reasoning:${historyMessageId(item, i)}`,
				kind: 'thinking',
				status: item.reasoning.active ? 'running' : 'done',
				historyIndex: i,
			});
		}

		const toolStates = getHistoryToolStates(item);
		if (toolStates.length) {
			for (const state of toolStates) {
				steps.push(stepFromTool(state, i));
			}
			continue;
		}

		if (item.message.role === 'assistant' && messageHasVisibleContent(item.message.content)) {
			steps.push({
				id: `reply:${historyMessageId(item, i)}`,
				kind: 'reply',
				status: 'done',
				historyIndex: i,
			});
		}
	}

	return steps;
}

export function findLastKnoxUserIndex(history: readonly IKnoxChatHistoryItem[]): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].message.role === 'user') {
			return i;
		}
	}
	return -1;
}

export function summarizeKnoxActivity(steps: readonly IKnoxAgentActivityStep[]): {
	thinking: number;
	reads: number;
	searches: number;
	edits: number;
	tests: number;
	other: number;
	running: boolean;
} {
	const summary = {
		thinking: 0,
		reads: 0,
		searches: 0,
		edits: 0,
		tests: 0,
		other: 0,
		running: false,
	};
	for (const step of steps) {
		if (step.status === 'running' || step.status === 'pending') {
			summary.running = true;
		}
		switch (step.kind) {
			case 'thinking':
				summary.thinking += 1;
				break;
			case 'read':
				summary.reads += 1;
				break;
			case 'search':
				summary.searches += 1;
				break;
			case 'edit':
				summary.edits += 1;
				break;
			case 'test':
				summary.tests += 1;
				break;
			default:
				summary.other += 1;
		}
	}
	return summary;
}

export function visibleKnoxActivitySteps(
	steps: readonly IKnoxAgentActivityStep[],
	expanded: boolean,
	limit = COLLAPSED_VISIBLE,
): { visible: IKnoxAgentActivityStep[]; hiddenCount: number } {
	if (expanded || steps.length <= limit) {
		return { visible: [...steps], hiddenCount: 0 };
	}
	return {
		visible: steps.slice(-limit),
		hiddenCount: steps.length - limit,
	};
}

export function estimateKnoxTokensFromPromptLogs(logs: readonly IKnoxPromptLog[] | undefined): number {
	if (!logs?.length) {
		return 0;
	}
	let chars = 0;
	for (const log of logs) {
		chars += log.prompt?.length ?? 0;
		chars += log.completion?.length ?? 0;
	}
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function collectKnoxTurnPromptLogs(
	history: readonly IKnoxChatHistoryItem[],
	userIndex: number,
): IKnoxPromptLog[] {
	const logs: IKnoxPromptLog[] = [];
	if (userIndex < 0) {
		return logs;
	}
	for (let i = userIndex; i < history.length; i++) {
		if (i > userIndex && history[i].message.role === 'user') {
			break;
		}
		const itemLogs = history[i].promptLogs;
		if (itemLogs?.length) {
			logs.push(...itemLogs);
		}
	}
	return logs;
}

export function formatKnoxDurationMs(ms: number): string {
	if (ms < 0 || !Number.isFinite(ms)) {
		return '0s';
	}
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) {
		return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function knoxItemCreatedAtMs(item: IKnoxChatHistoryItem | undefined): number | undefined {
	const createdAt = item?.message.createdAt;
	if (!createdAt) {
		return undefined;
	}
	const ms = Date.parse(createdAt);
	return Number.isFinite(ms) ? ms : undefined;
}

export function knoxTurnElapsedMs(
	history: readonly IKnoxChatHistoryItem[],
	userIndex: number,
	now: number,
	isStreaming: boolean,
): number {
	const start = knoxItemCreatedAtMs(history[userIndex]);
	if (start === undefined) {
		return 0;
	}
	if (isStreaming) {
		return Math.max(0, now - start);
	}
	let end = start;
	for (let i = userIndex + 1; i < history.length; i++) {
		if (history[i].message.role === 'user') {
			break;
		}
		const ts = knoxItemCreatedAtMs(history[i]);
		if (ts !== undefined && ts > end) {
			end = ts;
		}
		const reasoningEnd = history[i].reasoning?.endAt;
		if (reasoningEnd && reasoningEnd > end) {
			end = reasoningEnd;
		}
	}
	return Math.max(0, end - start);
}

export function currentKnoxActivityStep(
	steps: readonly IKnoxAgentActivityStep[],
): IKnoxAgentActivityStep | undefined {
	return steps.find(step => step.status === 'running')
		?? steps.find(step => step.status === 'pending')
		?? steps[steps.length - 1];
}

export function knoxLoadingVariantFor(kind?: KnoxAgentActivityKind): KnoxLoadingVariant {
	switch (kind) {
		case 'thinking':
		case 'reply':
			return 'orbit';
		case 'read':
		case 'search':
			return 'dots';
		default:
			return 'drive';
	}
}

export function formatKnoxElapsed(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
		return '0.0s';
	}
	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	return `${minutes}m ${(totalSeconds % 60).toFixed(1)}s`;
}

export function formatKnoxTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens < 0) {
		return '0';
	}

	let scaled = tokens;
	let unitIndex = 0;
	while (scaled >= 1000 && unitIndex < TOKEN_COUNT_SUFFIXES.length - 1) {
		scaled /= 1000;
		unitIndex += 1;
	}

	if (unitIndex === 0) {
		return String(Math.round(scaled));
	}

	const rounded = scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled);
	if (rounded >= 1000 && unitIndex < TOKEN_COUNT_SUFFIXES.length - 1) {
		return `1.0${TOKEN_COUNT_SUFFIXES[unitIndex + 1]}`;
	}

	const text = scaled < 10 && rounded < 10 ? rounded.toFixed(1) : String(rounded);
	return `${text}${TOKEN_COUNT_SUFFIXES[unitIndex]}`;
}
