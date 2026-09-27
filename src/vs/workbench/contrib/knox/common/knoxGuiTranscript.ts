/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractCodeFences, IKnoxGuiCodeFence, lastUserHistoryIndex, parseFenceMeta, toolDisplayKind } from './knoxGuiChat.js';
import { inputDocFromPlainText, IKnoxGuiInputBlock } from './knoxGuiInput.js';
import { IKnoxGuiApplyState, IKnoxGuiHistoryItem, IKnoxGuiPromptLog, IKnoxGuiToolCall, KnoxChatMode, KnoxToolStatus } from './knoxGuiState.js';

export type KnoxGuiActivityKind =
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

export type KnoxGuiActivityStatus = 'pending' | 'running' | 'done' | 'canceled';

export interface IKnoxGuiActivityStep {
	id: string;
	kind: KnoxGuiActivityKind;
	status: KnoxGuiActivityStatus;
	toolName?: string;
	detail?: string;
	historyIndex: number;
	workspaceCheckpointId?: string;
}

export type KnoxGuiLoadingVariant = 'drive' | 'dots' | 'orbit';

export interface IKnoxGuiTpsClock {
	turnKey: string;
	genMs: number;
	lastTick: number | null;
	tokensAtWindow: number;
	wasGenerating: boolean;
	tps: number;
}

export interface IKnoxGuiMarkdownFenceBlock extends IKnoxGuiCodeFence {
	type: 'fence';
	closed: boolean;
}

export interface IKnoxGuiMarkdownTextBlock {
	type: 'markdown';
	text: string;
}

export type KnoxGuiMarkdownBlock = IKnoxGuiMarkdownTextBlock | IKnoxGuiMarkdownFenceBlock;

export interface IKnoxGuiStreamError {
	message: string;
	statusCode?: number;
	kind: 'rate-limit' | 'not-found' | 'unauthorized' | 'overloaded' | 'generic';
}

export type KnoxGuiApplyUi =
	| { kind: 'idle' }
	| { kind: 'streaming' }
	| { kind: 'done'; numDiffs: number }
	| { kind: 'applied' }
	| { kind: 'reapply' };

const TERMINAL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'shell', 'powershell', 'pwsh', 'fish']);
const TERMINAL_COMMANDS = ['npm', 'pnpm', 'yarn', 'bun', 'deno', 'npx', 'cd', 'ls', 'pwd', 'pip', 'python', 'node', 'git', 'curl', 'wget'];
const TEST_COMMAND_RE = /(^|[\s;&|])((npm|pnpm|yarn|bun|npx)\s+(run\s+)?(test|vitest|jest)|pytest\b|vitest\b|jest\b|mocha\b|phpunit\b|go\s+test\b|cargo\s+test\b|make\s+test\b)\b/i;
const GIT_TOOLS = new Set(['git_status', 'git_diff', 'git_log', 'git_blame', 'git_commit', 'git_bisect', 'builtin_git_status', 'builtin_git_diff', 'builtin_git_log', 'builtin_git_blame', 'builtin_git_commit']);
const READ_TOOLS = new Set(['read_file', 'read_currently_open_file', 'view_subdirectory', 'glob', 'view_repo_map', 'view_diff', 'kconfig']);
const SEARCH_TOOLS = new Set(['exact_search', 'enhanced_search', 'search_web']);
const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'apply_patch', 'create_new_file', 'composite_smart_edit', 'workspace_checkpoint']);
const COLLAPSED_VISIBLE = 8;
const ENDING_PUNCTUATION = ['.', '?', '!', '```', ':'];
const CHARS_PER_TOKEN = 4;
const SOUL_CHECKPOINT_RE = /\[soul checkpoint=([^\s\]]+)\]/;
const TOKEN_COUNT_SUFFIXES = ['', 'k', 'm', 'b', 't'] as const;
export const TOKEN_TPS_MIN_GENERATION_MS = 300;

export function assistantReplyText(item: IKnoxGuiHistoryItem): string {
	return (item.content ?? '').trim();
}

export function isDuplicateAssistantReply(history: IKnoxGuiHistoryItem[], index: number): boolean {
	const item = history[index];
	if (item?.role !== 'assistant') {
		return false;
	}
	const content = assistantReplyText(item);
	if (!content) {
		return false;
	}
	for (let i = index - 1; i >= 0; i--) {
		const prev = history[i];
		if (prev.role === 'thinking') {
			continue;
		}
		if (prev.role !== 'assistant') {
			return false;
		}
		return assistantReplyText(prev) === content;
	}
	return false;
}

export function collectDuplicateAssistantMessageIds(history: IKnoxGuiHistoryItem[], throughIndex: number): Set<string> {
	const ids = new Set<string>();
	const end = Math.min(throughIndex, history.length - 1);
	for (let i = 0; i <= end; i++) {
		if (isDuplicateAssistantReply(history, i)) {
			const id = history[i].id;
			if (id) {
				ids.add(id);
			}
		}
	}
	return ids;
}

export function turnHasVisibleProgress(history: IKnoxGuiHistoryItem[], userIndex: number): boolean {
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.role === 'user') {
			break;
		}
		if ((item.toolCalls?.length ?? 0) > 0) {
			return true;
		}
		if (item.role === 'thinking' || item.thinking?.trim()) {
			return true;
		}
		if (item.content.trim()) {
			return true;
		}
	}
	return false;
}

export function shouldShineSentFrame(isLastUserInput: boolean, isStreaming: boolean, hasVisibleProgress: boolean): boolean {
	return isLastUserInput && isStreaming && !hasVisibleProgress;
}

export function isResponseTruncated(content: string, isStreaming: boolean): boolean {
	if (isStreaming) {
		return false;
	}
	const trimmed = content.trim();
	if (!trimmed) {
		return false;
	}
	if (ENDING_PUNCTUATION.some(p => trimmed.endsWith(p))) {
		return false;
	}
	if (/\p{Emoji}/u.test(trimmed.slice(-2))) {
		return false;
	}
	return true;
}

export function splitMarkdownBlocks(markdown: string): KnoxGuiMarkdownBlock[] {
	const blocks: KnoxGuiMarkdownBlock[] = [];
	if (!markdown) {
		return blocks;
	}
	const re = /```([^\n]*)\n?([\s\S]*?)(```|$)/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(markdown)) !== null) {
		if (match.index > last) {
			const text = markdown.slice(last, match.index);
			if (text.trim() || text.includes('\n')) {
				blocks.push({ type: 'markdown', text });
			}
		}
		const parsed = parseFenceMeta(match[1]);
		blocks.push({
			type: 'fence',
			language: parsed.language,
			filepath: parsed.filepath,
			range: parsed.range,
			code: match[2].replace(/\n$/, ''),
			closed: match[3] === '```',
		});
		last = match.index + match[0].length;
		if (match[3] !== '```') {
			break;
		}
	}
	if (last < markdown.length) {
		blocks.push({ type: 'markdown', text: markdown.slice(last) });
	}
	if (!blocks.length) {
		blocks.push({ type: 'markdown', text: markdown });
	}
	return blocks;
}

export function isTerminalCodeBlock(language: string | undefined, text: string): boolean {
	const lang = (language ?? '').toLowerCase();
	if (TERMINAL_LANGUAGES.has(lang)) {
		return true;
	}
	const trimmed = text.trim();
	if (!lang && (trimmed.split('\n').length === 1 || TERMINAL_COMMANDS.some(cmd => trimmed.startsWith(cmd)))) {
		return true;
	}
	return false;
}

export function fenceApplyStreamId(messageId: string, fenceIndex: number): string {
	return `${messageId}:fence:${fenceIndex}`;
}

export function applyUiForState(apply?: IKnoxGuiApplyState): KnoxGuiApplyUi {
	if (!apply) {
		return { kind: 'idle' };
	}
	if (apply.status === 'streaming') {
		return { kind: 'streaming' };
	}
	if (apply.status === 'done') {
		return { kind: 'done', numDiffs: apply.numDiffs ?? 0 };
	}
	if (apply.status === 'closed' && (apply.numDiffs ?? 0) === 0) {
		return { kind: 'applied' };
	}
	if (apply.status === 'closed') {
		return { kind: 'reapply' };
	}
	return { kind: 'idle' };
}

export function pendingApplyStates(applyStates: IKnoxGuiApplyState[]): IKnoxGuiApplyState[] {
	return applyStates.filter(apply => apply.status === 'done');
}

export function mapToolStatusToActivity(status: KnoxToolStatus): KnoxGuiActivityStatus {
	switch (status) {
		case 'calling':
			return 'running';
		case 'done':
			return 'done';
		case 'canceled':
		case 'errored':
			return 'canceled';
		default:
			return 'pending';
	}
}

export function classifyAgentActivityKind(name: string | undefined, args?: Record<string, unknown>): KnoxGuiActivityKind {
	if (!name) {
		return 'other';
	}
	const n = name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	if (n === 'generate_tests') {
		return 'test';
	}
	if (GIT_TOOLS.has(n) || GIT_TOOLS.has(name)) {
		return 'git';
	}
	if (n === 'task') {
		return 'task';
	}
	if (n === 'ask_user' || n === 'askuser') {
		return 'ask';
	}
	const display = toolDisplayKind(name);
	if (display === 'terminal') {
		const command = typeof args?.command === 'string' ? args.command : '';
		if (args?.action === 'test' || TEST_COMMAND_RE.test(command)) {
			return 'test';
		}
		return 'shell';
	}
	if (READ_TOOLS.has(n) || display === 'subdirectory' || display === 'repo-map') {
		return 'read';
	}
	if (SEARCH_TOOLS.has(n) || display === 'search') {
		return 'search';
	}
	if (EDIT_TOOLS.has(n) || display === 'create-file' || display === 'file') {
		if (n === 'read_file' || n === 'read_currently_open_file') {
			return 'read';
		}
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

export function toolStepDetail(toolName: string | undefined, args?: Record<string, unknown>): string | undefined {
	if (!args) {
		return undefined;
	}
	const pathLike = args.filepath ?? args.path ?? args.file_path ?? args.target_directory ?? args.directory_path;
	if (typeof pathLike === 'string' && pathLike) {
		return basename(pathLike);
	}
	if (typeof args.command === 'string' && args.command) {
		return truncate(args.command, 64);
	}
	const n = toolName?.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	if (n === 'build') {
		const action = typeof args.action === 'string' ? args.action : '';
		const extra = (typeof args.extraArgs === 'string' && args.extraArgs) || (typeof args.extra_args === 'string' && args.extra_args) || '';
		const detail = [action, extra].filter(Boolean).join(' ');
		if (detail) {
			return truncate(detail, 64);
		}
	}
	if (typeof args.pattern === 'string' && args.pattern) {
		return truncate(args.pattern, 48);
	}
	if (typeof args.query === 'string' && args.query) {
		return truncate(args.query, 48);
	}
	if (typeof args.prompt === 'string' && args.prompt) {
		return truncate(args.prompt, 48);
	}
	if (typeof args.profile === 'string' && args.profile) {
		return args.profile;
	}
	if (typeof args.patch === 'string' && args.patch) {
		const file = firstPatchPath(args.patch);
		return file ? basename(file) : 'patch';
	}
	if (n === 'workspace_checkpoint') {
		if (typeof args.checkpoint_id === 'string' && args.checkpoint_id) {
			return truncate(args.checkpoint_id, 16);
		}
		if (typeof args.action === 'string' && args.action) {
			return args.action;
		}
	}
	if (n === 'read_currently_open_file') {
		return 'current file';
	}
	return undefined;
}

function firstPatchPath(patch: string): string | undefined {
	return patch.match(/\*\*\* (?:Add|Update|Delete|Move) File: (.+)/)?.[1]?.trim();
}

export function buildAgentActivitySteps(
	history: IKnoxGuiHistoryItem[],
	userIndex: number,
	options?: { inProgress?: boolean },
): IKnoxGuiActivityStep[] {
	if (userIndex < 0 || userIndex >= history.length || history[userIndex]?.role !== 'user') {
		return [];
	}
	const steps: IKnoxGuiActivityStep[] = [];
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.role === 'user') {
			break;
		}
		if (item.role === 'tool') {
			continue;
		}
		if (item.role === 'thinking') {
			const last = i === history.length - 1;
			steps.push({
				id: `thinking:${item.id || i}`,
				kind: 'thinking',
				status: last && options?.inProgress ? 'running' : 'done',
				historyIndex: i,
			});
			continue;
		}
		if (item.thinking?.trim() || item.thinkingActive) {
			steps.push({
				id: `reasoning:${item.id || i}`,
				kind: 'thinking',
				status: item.thinkingActive ? 'running' : 'done',
				historyIndex: i,
			});
		}
		if (item.toolCalls?.length) {
			for (const call of item.toolCalls) {
				steps.push(stepFromTool(call, i));
			}
			continue;
		}
		if (item.role === 'assistant' && assistantReplyText(item)) {
			steps.push({
				id: `reply:${item.id || i}`,
				kind: 'reply',
				status: 'done',
				historyIndex: i,
			});
		}
	}
	return steps;
}

function stepFromTool(call: IKnoxGuiToolCall, historyIndex: number): IKnoxGuiActivityStep {
	return {
		id: `tool:${call.id}`,
		kind: classifyAgentActivityKind(call.name, call.parsedArgs),
		status: mapToolStatusToActivity(call.status),
		toolName: call.name,
		detail: toolStepDetail(call.name, call.parsedArgs),
		historyIndex,
		workspaceCheckpointId: extractSoulCheckpointId(call.output) ?? extractSoulCheckpointId(call.outputItems?.map(item => item.content).join('\n')),
	};
}

export function extractSoulCheckpointId(content: string | undefined): string | undefined {
	if (!content) {
		return undefined;
	}
	return content.match(SOUL_CHECKPOINT_RE)?.[1];
}

export function activityAnchorId(stepId: string): string {
	return `agent-activity-${stepId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function summarizeActivity(steps: IKnoxGuiActivityStep[]): {
	thinking: number;
	reads: number;
	searches: number;
	edits: number;
	tests: number;
	other: number;
	running: boolean;
} {
	const summary = { thinking: 0, reads: 0, searches: 0, edits: 0, tests: 0, other: 0, running: false };
	for (const step of steps) {
		if (step.status === 'running' || step.status === 'pending') {
			summary.running = true;
		}
		switch (step.kind) {
			case 'thinking': summary.thinking += 1; break;
			case 'read': summary.reads += 1; break;
			case 'search': summary.searches += 1; break;
			case 'edit': summary.edits += 1; break;
			case 'test': summary.tests += 1; break;
			default: summary.other += 1;
		}
	}
	return summary;
}

export function visibleActivitySteps(
	steps: IKnoxGuiActivityStep[],
	expanded: boolean,
	limit = COLLAPSED_VISIBLE,
): { visible: IKnoxGuiActivityStep[]; hiddenCount: number } {
	if (expanded || steps.length <= limit) {
		return { visible: steps, hiddenCount: 0 };
	}
	return { visible: steps.slice(-limit), hiddenCount: steps.length - limit };
}

export function currentActivityStep(steps: IKnoxGuiActivityStep[]): IKnoxGuiActivityStep | undefined {
	return steps.find(step => step.status === 'running') ?? steps.find(step => step.status === 'pending') ?? steps[steps.length - 1];
}

export function activityKindLabelKey(kind: KnoxGuiActivityKind): string {
	switch (kind) {
		case 'thinking': return 'activityKindThinking';
		case 'read': return 'activityKindRead';
		case 'search': return 'activityKindSearch';
		case 'edit': return 'activityKindEdit';
		case 'test': return 'activityKindTest';
		case 'shell': return 'activityKindShell';
		case 'git': return 'activityKindGit';
		case 'task': return 'activityKindTask';
		case 'ask': return 'activityKindAsk';
		case 'reply': return 'activityKindReply';
		default: return 'activityKindOther';
	}
}

export function activityKindCodicon(kind: KnoxGuiActivityKind): string {
	switch (kind) {
		case 'thinking': return 'codicon-lightbulb';
		case 'read': return 'codicon-file';
		case 'search': return 'codicon-search';
		case 'edit': return 'codicon-edit';
		case 'test': return 'codicon-beaker';
		case 'shell': return 'codicon-terminal';
		case 'git': return 'codicon-git-branch';
		case 'task': return 'codicon-hubot';
		case 'ask': return 'codicon-comment-discussion';
		case 'reply': return 'codicon-comment';
		default: return 'codicon-tools';
	}
}

export function countTurnToolSteps(history: IKnoxGuiHistoryItem[], userIndex: number): number {
	return buildAgentActivitySteps(history, userIndex).filter(step => step.kind !== 'thinking' && step.kind !== 'reply').length;
}

export function formatDurationMs(ms: number): string {
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

export function formatLoadingElapsed(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
		return '0.0s';
	}
	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	return `${minutes}m ${(totalSeconds % 60).toFixed(1)}s`;
}

export function loadingVariantFor(kind?: KnoxGuiActivityKind): KnoxGuiLoadingVariant {
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

export function isBackgroundJobTool(call: IKnoxGuiToolCall): boolean {
	return call.name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_') === 'task';
}

export function hasForegroundCallingToolCalls(history: IKnoxGuiHistoryItem[]): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const calls = history[i].toolCalls;
		if (!calls?.length) {
			continue;
		}
		return calls.some(call => call.status === 'calling' && !isBackgroundJobTool(call));
	}
	return false;
}

function charsToTokens(chars: number): number {
	if (!Number.isFinite(chars) || chars <= 0) {
		return 0;
	}
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateTokensFromPromptLogs(logs: IKnoxGuiPromptLog[] | undefined): number {
	if (!logs?.length) {
		return 0;
	}
	let chars = 0;
	for (const log of logs) {
		chars += log.prompt?.length ?? 0;
		chars += log.completion?.length ?? 0;
	}
	return charsToTokens(chars);
}

export function estimateCompletionTokensFromPromptLogs(logs: IKnoxGuiPromptLog[] | undefined): number {
	if (!logs?.length) {
		return 0;
	}
	let chars = 0;
	for (const log of logs) {
		chars += log.completion?.length ?? 0;
	}
	return charsToTokens(chars);
}

function messageContentChars(content: string | undefined): number {
	return content?.length ?? 0;
}

function toolArgumentChars(item: IKnoxGuiHistoryItem): number {
	return (item.toolCalls ?? []).reduce((sum, call) => sum + (call.arguments?.length ?? 0), 0);
}

export function estimateTurnOutputTokens(history: IKnoxGuiHistoryItem[], userIndex: number, logs?: IKnoxGuiPromptLog[]): number {
	const fromLogs = estimateCompletionTokensFromPromptLogs(logs);
	if (userIndex < 0 || userIndex >= history.length) {
		return fromLogs;
	}
	let chars = 0;
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.role === 'user') {
			break;
		}
		if (item.role === 'tool') {
			continue;
		}
		chars += messageContentChars(item.content);
		if (item.thinking) {
			chars += item.thinking.length;
		}
		chars += toolArgumentChars(item);
	}
	return Math.max(fromLogs, charsToTokens(chars));
}

export function tokensPerSecond(outputTokens: number, generationMs: number): number {
	if (!Number.isFinite(outputTokens) || !Number.isFinite(generationMs) || outputTokens <= 0 || generationMs < 1) {
		return 0;
	}
	return (outputTokens * 1000) / generationMs;
}

export function isTurnGeneratingTokens(isStreaming: boolean, history: IKnoxGuiHistoryItem[]): boolean {
	if (!isStreaming) {
		return false;
	}
	for (let i = history.length - 1; i >= 0; i--) {
		const calls = history[i].toolCalls;
		if (!calls?.length) {
			continue;
		}
		return !calls.some(call => !isBackgroundJobTool(call) && (call.status === 'generated' || call.status === 'calling'));
	}
	return true;
}

export function collectTurnPromptLogs(history: IKnoxGuiHistoryItem[], userIndex: number): IKnoxGuiPromptLog[] {
	const logs: IKnoxGuiPromptLog[] = [];
	if (userIndex < 0) {
		return logs;
	}
	for (let i = userIndex; i < history.length; i++) {
		if (i > userIndex && history[i].role === 'user') {
			break;
		}
		const itemLogs = history[i].promptLogs;
		if (itemLogs?.length) {
			logs.push(...itemLogs);
		}
	}
	return logs;
}

export function summarizeJevPromptLogs(logs: IKnoxGuiPromptLog[]): { route: string; skill?: string; source?: string } | undefined {
	for (const log of logs) {
		const turn = log.jev?.turn;
		if (turn?.source === 'jev' && turn.route) {
			return { route: turn.route, skill: turn.skill, source: turn.source };
		}
	}
	return undefined;
}

export function formatTokenCount(tokens: number): string {
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

export function formatTokenRate(tps: number): string {
	if (!Number.isFinite(tps) || tps <= 0) {
		return '0';
	}
	if (tps < 10) {
		return tps.toFixed(1);
	}
	if (tps < 1000) {
		return String(Math.round(tps));
	}
	return formatTokenCount(Math.round(tps));
}

export function itemCreatedAtMs(item: IKnoxGuiHistoryItem | undefined): number | undefined {
	if (!item?.createdAt) {
		return undefined;
	}
	const ms = Date.parse(item.createdAt);
	return Number.isFinite(ms) ? ms : undefined;
}

export function turnElapsedMs(history: IKnoxGuiHistoryItem[], userIndex: number, now: number, isStreaming: boolean): number {
	const start = itemCreatedAtMs(history[userIndex]);
	if (start === undefined) {
		return 0;
	}
	if (isStreaming) {
		return Math.max(0, now - start);
	}
	let end = start;
	for (let i = userIndex + 1; i < history.length; i++) {
		if (history[i].role === 'user') {
			break;
		}
		const ts = itemCreatedAtMs(history[i]);
		if (ts !== undefined && ts > end) {
			end = ts;
		}
		const reasoningEnd = history[i].thinkingEndAt;
		if (reasoningEnd && reasoningEnd > end) {
			end = reasoningEnd;
		}
	}
	return Math.max(0, end - start);
}

export function resetTpsClock(outputTokens: number, turnKey: string): IKnoxGuiTpsClock {
	return { turnKey, genMs: 0, lastTick: null, tokensAtWindow: outputTokens, wasGenerating: false, tps: 0 };
}

export function tickTokensPerSecond(clock: IKnoxGuiTpsClock, outputTokens: number, generating: boolean, turnKey: string, now: number): IKnoxGuiTpsClock {
	let next = clock.turnKey !== turnKey ? resetTpsClock(outputTokens, turnKey) : { ...clock };
	if (generating && !next.wasGenerating) {
		next.tokensAtWindow = outputTokens;
	}
	next.wasGenerating = generating;
	const last = next.lastTick;
	next.lastTick = now;
	if (last != null && generating && outputTokens > next.tokensAtWindow) {
		next.genMs += now - last;
	}
	if (next.genMs >= TOKEN_TPS_MIN_GENERATION_MS && outputTokens > 0) {
		const rate = tokensPerSecond(outputTokens, next.genMs);
		if (rate > 0) {
			next.tps = rate;
		}
	}
	return next;
}

export function loadingPixelDelays(variant: KnoxGuiLoadingVariant): { delays: Array<number | null>; durationMs: number; round: boolean } {
	if (variant === 'orbit') {
		const order = [0, 1, 2, 5, 8, 7, 6, 3];
		const delays = Array.from({ length: 9 }, (_, i) => {
			const k = order.indexOf(i);
			return k === -1 ? null : k * 110;
		});
		return { delays, durationMs: 950, round: false };
	}
	const delays = Array.from({ length: 9 }, (_, i) => {
		const r = Math.floor(i / 3);
		const c = i % 3;
		return (c + Math.abs(r - 1)) * 90;
	});
	return { delays, durationMs: 650, round: variant === 'dots' };
}

export function formatReasoningTime(startAt?: number, endAt?: number, now = Date.now()): string {
	if (!startAt) {
		return '';
	}
	const end = endAt ?? now;
	return `${((end - startAt) / 1000).toFixed(1)}s`;
}

export function parseStreamError(error: unknown): IKnoxGuiStreamError {
	const message = error instanceof Error ? error.message : String(error ?? '');
	const parts = message.split(' ');
	let statusCode: number | undefined;
	if (parts.length > 1) {
		const status = parts[0] === 'HTTP' ? parts[1] : parts[0];
		const code = Number(status);
		if (!Number.isNaN(code) && code >= 100 && code < 600) {
			statusCode = code;
		}
	}
	const lower = message.toLowerCase();
	let kind: IKnoxGuiStreamError['kind'] = 'generic';
	if (statusCode === 429) {
		kind = 'rate-limit';
	} else if (statusCode === 404) {
		kind = 'not-found';
	} else if (statusCode === 401) {
		kind = 'unauthorized';
	} else if (lower.includes('overloaded') || lower.includes('malformed')) {
		kind = 'overloaded';
	}
	return { message, statusCode, kind };
}

export function resolveAgentMaxSteps(raw: number | undefined): number | null {
	if (!raw || raw <= 0) {
		return null;
	}
	return raw;
}

export function activitySummaryLine(
	t: (key: string, vars?: Record<string, string | number>) => string,
	steps: IKnoxGuiActivityStep[],
): string {
	const s = summarizeActivity(steps);
	const parts: string[] = [];
	if (s.thinking) {
		parts.push(t('activitySummaryThinking'));
	}
	if (s.reads) {
		parts.push(t(s.reads === 1 ? 'activitySummaryReads' : 'activitySummaryReads_plural', { count: s.reads }));
	}
	if (s.searches) {
		parts.push(t(s.searches === 1 ? 'activitySummarySearches' : 'activitySummarySearches_plural', { count: s.searches }));
	}
	if (s.edits) {
		parts.push(t(s.edits === 1 ? 'activitySummaryEdits' : 'activitySummaryEdits_plural', { count: s.edits }));
	}
	if (s.tests) {
		parts.push(t(s.tests === 1 ? 'activitySummaryTests' : 'activitySummaryTests_plural', { count: s.tests }));
	}
	if (s.other) {
		parts.push(t('activitySummaryOther', { count: s.other }));
	}
	return parts.join(' · ') || t('activityWorking');
}

export function lastUserIndex(history: IKnoxGuiHistoryItem[]): number {
	return lastUserHistoryIndex(history);
}

export function historyUserInputDoc(item: IKnoxGuiHistoryItem): IKnoxGuiInputBlock[] {
	if (item.inputDoc?.length) {
		return item.inputDoc;
	}
	return inputDocFromPlainText(item.content ?? '');
}

export function knoxGuiShowsCodeToEditOnHistoryUser(mode: KnoxChatMode, index: number): boolean {
	return mode === 'edit' && index === 0;
}

export function knoxGuiShowsCodeToEditOnEmptyComposer(mode: KnoxChatMode, historyLength: number): boolean {
	return mode === 'edit' && historyLength === 0;
}

export function resubmitHistory<T>(history: T[], index: number, replacement: T): T[] {
	if (index < 0) {
		return [...history, replacement];
	}
	return [...history.slice(0, index), replacement];
}

export function shouldShowThinkingIndicator(args: { isStreaming: boolean; isLast: boolean; hasContent: boolean; hasReasoning: boolean }): boolean {
	return args.isStreaming && args.isLast && !args.hasContent && !args.hasReasoning;
}

export function parseCodeFenceRange(range?: string): { startLine: number; endLine?: number } | undefined {
	if (!range) {
		return undefined;
	}
	const match = range.trim().match(/^L?(\d+)(?:\s*[-:]\s*L?(\d+))?$/i);
	if (!match) {
		return undefined;
	}
	const startLine = Number.parseInt(match[1], 10);
	if (!Number.isFinite(startLine) || startLine < 1) {
		return undefined;
	}
	const parsedEnd = match[2] ? Number.parseInt(match[2], 10) : undefined;
	const endLine = parsedEnd != null && Number.isFinite(parsedEnd) && parsedEnd >= startLine ? parsedEnd : undefined;
	return { startLine, endLine };
}

export function splitDisplayPath(filepath: string): { dir: string; name: string } {
	const clean = filepath.replace(/\\/g, '/').replace(/^\.\//, '');
	const lastSlash = clean.lastIndexOf('/');
	if (lastSlash === -1) {
		return { dir: '', name: clean };
	}
	return { dir: clean.slice(0, lastSlash + 1), name: clean.slice(lastSlash + 1) };
}

export function fenceHasFileToolbar(filepath?: string): boolean {
	return Boolean(filepath && /\.[0-9a-z]+$/i.test(filepath));
}

export function looksLikeFilePath(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || /\s/.test(trimmed) || trimmed.length > 260) {
		return false;
	}
	return /[\\/]/.test(trimmed) || /\.[a-z0-9]{1,8}$/i.test(trimmed);
}

export function applyUiAfterAppliedTimeout(ui: KnoxGuiApplyUi, shownUntil: number | undefined, now: number): KnoxGuiApplyUi {
	if (ui.kind !== 'applied') {
		return ui;
	}
	if (shownUntil === undefined || now < shownUntil) {
		return ui;
	}
	return { kind: 'reapply' };
}

export const APPLIED_PILL_MS = 5_000;

export function fencesForToolbar(content: string): IKnoxGuiCodeFence[] {
	return extractCodeFences(content);
}

export function languageIdFromFence(language: string, filepath?: string): string {
	const lang = language.trim().toLowerCase();
	if (!lang && filepath) {
		const ext = filepath.split('.').pop()?.toLowerCase();
		if (ext === 'ts' || ext === 'tsx') {
			return 'typescript';
		}
		if (ext === 'js' || ext === 'jsx') {
			return 'javascript';
		}
		if (ext === 'py') {
			return 'python';
		}
		if (ext === 'rs') {
			return 'rust';
		}
		if (ext === 'go') {
			return 'go';
		}
		if (ext === 'md') {
			return 'markdown';
		}
	}
	if (lang === 'ts' || lang === 'tsx') {
		return 'typescript';
	}
	if (lang === 'js' || lang === 'jsx') {
		return 'javascript';
	}
	if (lang === 'py') {
		return 'python';
	}
	if (lang === 'sh' || lang === 'zsh' || lang === 'bash') {
		return 'shellscript';
	}
	return lang || 'plaintext';
}
