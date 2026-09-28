/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractCodeFences, IKnoxGuiCodeFence, lastUserHistoryIndex, parseFenceMeta, toolDisplayKind } from './knoxGuiChat.js';
import { inputDocFromPlainText, IKnoxGuiInputBlock } from './knoxGuiInput.js';
import { IKnoxGuiApplyState, IKnoxGuiContextItem, IKnoxGuiHistoryItem, IKnoxGuiPromptLog, IKnoxGuiSymbol, IKnoxGuiToolCall, KnoxChatMode, KnoxToolStatus } from './knoxGuiState.js';

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

/**
 * `patchNestedMarkdown.ts`: an outer fence that wraps inner fences (e.g. a
 * markdown file with code samples) gets one more backtick than its longest
 * inner fence, so the inner ones stay part of its body.
 */
export function patchNestedMarkdown(source: string): string {
	const ticks = source.match(/`{3,}/g);
	if (!ticks || ticks.length < 4) {
		return source;
	}
	const lines = source.split('\n');
	const trimmed = lines.map(l => l.trim());
	const stack: { startLine: number; fenceLength: number; nested: boolean }[] = [];
	const patches: { startLine: number; endLine: number }[] = [];
	for (let i = 0; i < trimmed.length; i++) {
		const start = /^(`{3,})(\w*)?(.*)$/.exec(trimmed[i]);
		const close = /^(`{3,})\s*$/.exec(trimmed[i]);
		if (!start && !close) {
			continue;
		}
		const fenceLength = (start ?? close)![1].length;
		const hasLanguage = !!start?.[2];
		if (!stack.length) {
			stack.push({ startLine: i, fenceLength, nested: false });
			continue;
		}
		const current = stack[stack.length - 1];
		if (close && fenceLength === current.fenceLength) {
			if (stack.length === 1 && current.nested) {
				patches.push({ startLine: current.startLine, endLine: i });
			}
			stack.pop();
		} else if (start && hasLanguage) {
			stack[0].nested = true;
			stack.push({ startLine: i, fenceLength, nested: false });
		} else if (close) {
			for (let j = stack.length - 1; j >= 0; j--) {
				if (stack[j].fenceLength === fenceLength) {
					const closed = stack.splice(j);
					if (j === 0 && closed[0].nested) {
						patches.push({ startLine: closed[0].startLine, endLine: i });
					}
					break;
				}
			}
		} else if (start && fenceLength > current.fenceLength) {
			stack[0].nested = true;
			stack.push({ startLine: i, fenceLength, nested: false });
		}
	}
	for (const block of patches) {
		let inner = 3;
		for (let i = block.startLine + 1; i < block.endLine; i++) {
			const m = /^(`{3,})/.exec(trimmed[i]);
			if (m) {
				inner = Math.max(inner, m[1].length);
			}
		}
		const fence = '`'.repeat(inner + 1);
		lines[block.startLine] = lines[block.startLine].replace(/^(\s*)(`{3,})/, `$1${fence}`);
		lines[block.endLine] = lines[block.endLine].replace(/^(\s*)(`{3,})/, `$1${fence}`);
	}
	return lines.join('\n');
}

export function splitMarkdownBlocks(markdown: string): KnoxGuiMarkdownBlock[] {
	const blocks: KnoxGuiMarkdownBlock[] = [];
	if (!markdown) {
		return blocks;
	}
	const lines = patchNestedMarkdown(markdown).split('\n');
	let text: string[] = [];
	let fence: { ticks: number; meta: string; code: string[] } | undefined;
	const flushText = (trailingNewline: boolean) => {
		const value = text.join('\n') + (trailingNewline && text.length ? '\n' : '');
		if (value.trim() || value.includes('\n')) {
			blocks.push({ type: 'markdown', text: value });
		}
		text = [];
	};
	const pushFence = (closed: boolean) => {
		const parsed = parseFenceMeta(fence!.meta);
		blocks.push({ type: 'fence', language: parsed.language, filepath: parsed.filepath, range: parsed.range, code: fence!.code.join('\n'), closed });
		fence = undefined;
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence) {
			const close = /^\s*(`{3,})\s*$/.exec(line);
			if (close && close[1].length >= fence.ticks) {
				pushFence(true);
			} else {
				fence.code.push(line);
			}
			continue;
		}
		const open = /^\s*(`{3,})(.*)$/.exec(line);
		if (open) {
			flushText(true);
			fence = { ticks: open[1].length, meta: open[2], code: [] };
			continue;
		}
		text.push(line);
	}
	if (fence) {
		pushFence(false);
	}
	flushText(false);
	if (!blocks.length) {
		blocks.push({ type: 'markdown', text: markdown });
	}
	return blocks;
}

const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s/;

/**
 * `streamdown` `parseMarkdownIntoBlocks` for fence-free markdown: a blank line ends a
 * block unless the next line is indented or continues a list, so finished blocks stay
 * byte-identical while the reply streams.
 */
export function splitMarkdownParagraphs(text: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	let blanks: string[] = [];
	for (const line of text.split('\n')) {
		if (!line.trim()) {
			if (current.length) {
				blanks.push(line);
			}
			continue;
		}
		const continues = current.length > 0 && (!blanks.length || /^\s/.test(line) || (LIST_ITEM_RE.test(line) && LIST_ITEM_RE.test(current[0])));
		if (!continues && current.length) {
			blocks.push(current.join('\n'));
			current = [];
		} else {
			current.push(...blanks);
		}
		blanks = [];
		current.push(line);
	}
	if (current.length) {
		blocks.push(current.join('\n'));
	}
	return blocks;
}

/**
 * `remend` for the live last block: close an open inline code span, emphasis or
 * strikethrough (innermost first), drop a marker with nothing after it, and show
 * an unfinished link as its label.
 */
export function healStreamingMarkdown(source: string): string {
	let text = source.replace(/(!?)\[([^\]\n]*)\]\([^)\s]*$/, (_match, bang: string, label: string) => bang ? '' : label);
	const ticks = text.match(/`/g)?.length ?? 0;
	if (ticks % 2 === 1) {
		const pos = text.lastIndexOf('`');
		return text.slice(pos + 1).trim() ? `${text.replace(/\s+$/, '')}\`` : text.slice(0, pos) + text.slice(pos + 1);
	}
	const plain = text.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
	const open: { marker: string; pos: number }[] = [];
	for (const marker of ['~~', '**']) {
		const positions = [...plain.matchAll(new RegExp(marker.replace(/[*]/g, '\\*'), 'g'))].map(m => m.index!);
		if (positions.length % 2 === 1) {
			open.push({ marker, pos: positions[positions.length - 1] });
		}
	}
	const singles = [...plain.replace(/\*\*/g, '  ').matchAll(/\*/g)]
		.map(m => m.index!)
		.filter(pos => !/^\s*$/.test(plain.slice(plain.lastIndexOf('\n', pos - 1) + 1, pos)) || plain[pos + 1] !== ' ');
	if (singles.length % 2 === 1) {
		open.push({ marker: '*', pos: singles[singles.length - 1] });
	}
	open.sort((a, b) => b.pos - a.pos);
	let closers = '';
	for (const { marker, pos } of open) {
		if (!text.slice(pos + marker.length).replace(/[*~]/g, '').trim()) {
			text = text.slice(0, pos) + text.slice(pos + marker.length);
		} else {
			closers += marker;
		}
	}
	return closers ? text.replace(/\s+$/, '') + closers : text;
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

/**
 * `applyCodeFromChat` shortcut: the next code block of the latest reply, where
 * "next" is `codeBlockApplyStates.curIndex` (one step per finished apply).
 */
export function nextCodeBlockToApply(history: readonly IKnoxGuiHistoryItem[], applyStates: readonly { streamId: string; status?: string }[]): { streamId: string; fence: IKnoxGuiMarkdownFenceBlock } | undefined {
	const last = [...history].reverse().find(item => item.role === 'assistant' && assistantReplyText(item));
	if (!last) {
		return undefined;
	}
	const fences = splitMarkdownBlocks(last.content).filter((block): block is IKnoxGuiMarkdownFenceBlock => block.type === 'fence');
	const done = fences.filter((_, index) => applyStates.some(state => state.streamId === fenceApplyStreamId(last.id, index) && state.status === 'done')).length;
	const fence = fences[done];
	return fence ? { streamId: fenceApplyStreamId(last.id, done), fence } : undefined;
}

export function fenceApplyStreamId(messageId: string, fenceIndex: number): string {
	return `${messageId}:fence:${fenceIndex}`;
}

/** `ApplyActions.tsx`: only a closed apply with no diffs left and no reject counts as applied. */
export function applyUiForState(apply?: IKnoxGuiApplyState, rejected = false): KnoxGuiApplyUi {
	if (!apply) {
		return { kind: 'idle' };
	}
	if (apply.status === 'streaming') {
		return { kind: 'streaming' };
	}
	if (apply.status === 'done') {
		return { kind: 'done', numDiffs: apply.numDiffs ?? 0 };
	}
	if (apply.status === 'closed' && !rejected && (apply.numDiffs ?? 0) === 0) {
		return { kind: 'applied' };
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

/** `ThinkingIndicator.tsx`: only for reasoning models, and not while context is still gathering. */
export function shouldShowThinkingIndicator(args: { isStreaming: boolean; isLast: boolean; hasContent: boolean; hasReasoning: boolean; isGatheringContext?: boolean; showForModel?: boolean }): boolean {
	return args.isStreaming && args.isLast && !args.hasContent && !args.hasReasoning && !args.isGatheringContext && args.showForModel !== false;
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

/** `codeLineWindow.ts`: lines shown before a code block scrolls. */
export const DEFAULT_COLLAPSED_CODE_LINES = 12;
/** `codeLineWindow.ts`: lines kept in the DOM; the rest are not rendered. */
export const MAX_EXPANDED_CODE_LINES = 400;
export const CODE_LINE_HEIGHT_PX = 19;

export type KnoxGuiCodeLineAnchor = 'start' | 'end';

/** Port of `visibleCodeLineRange`. */
export function visibleCodeLineRange(
	lineCount: number,
	options: { isGenerating: boolean; isExpanded: boolean; anchor?: KnoxGuiCodeLineAnchor; extraLines?: number; windowShift?: number },
): { start: number; end: number } {
	if (lineCount <= 0) {
		return { start: 0, end: 0 };
	}
	const extra = Math.max(0, options.extraLines ?? 0);
	const collapsedSize = Math.min(lineCount, Math.min(MAX_EXPANDED_CODE_LINES, DEFAULT_COLLAPSED_CODE_LINES + extra));
	const windowSize = options.isExpanded ? Math.min(lineCount, MAX_EXPANDED_CODE_LINES) : collapsedSize;
	if (options.isGenerating || options.anchor === 'end') {
		const maxShift = Math.max(0, lineCount - windowSize);
		const shift = Math.min(maxShift, Math.max(0, options.windowShift ?? 0));
		const end = lineCount - shift;
		return { start: end - windowSize, end };
	}
	return { start: 0, end: windowSize };
}

/** Per-line HTML from `tokenizeToStringSync` output (flat spans joined by `<br/>` inside one div). */
export function knoxGuiSplitTokenizedLines(html: string): string[] {
	const inner = html.replace(/^<div class="monaco-tokenized-source">/, '').replace(/<\/div>$/, '');
	return inner.split('<br/>');
}

export function splitDisplayPath(filepath: string): { dir: string; name: string } {
	const clean = filepath.replace(/\\/g, '/').replace(/^\.\//, '');
	const lastSlash = clean.lastIndexOf('/');
	if (lastSlash === -1) {
		return { dir: '', name: clean };
	}
	return { dir: clean.slice(0, lastSlash + 1), name: clean.slice(lastSlash + 1) };
}

/** `getTerminalCommand`: a leading `$ ` prompt is not part of the command. */
export function knoxGuiTerminalCommand(text: string): string {
	return text.startsWith('$ ') ? text.slice(2) : text;
}

/** `initialCodeBlockExpanded`: an explicit `expanded` wins, otherwise open once the block has code. */
export function knoxGuiInitialCodeBlockExpanded(code: string, expanded: boolean | undefined): boolean {
	return typeof expanded === 'boolean' ? expanded : code.trim().length > 0;
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

/** `ctxItemToRifWithContents(item, true)`: zero-based lines parsed from `name (12-30)`. */
export interface IKnoxGuiFileRef {
	filepath: string;
	startLine: number;
	endLine: number;
}

export interface IKnoxGuiPastFileInfo {
	symbols: IKnoxGuiSymbol[];
	rifs: IKnoxGuiFileRef[];
}

export const KNOX_EMPTY_PAST_FILE_INFO: IKnoxGuiPastFileInfo = { symbols: [], rifs: [] };

function fileRefFromName(filepath: string, name: string): IKnoxGuiFileRef {
	const lines = name.split('(')[1]?.split(')')[0]?.split('-');
	if (!lines || lines.length < 2) {
		return { filepath, startLine: 0, endLine: 0 };
	}
	return { filepath, startLine: Number.parseInt(lines[0], 10) - 1, endLine: Number.parseInt(lines[1], 10) - 1 };
}

/**
 * `updateFileSymbols.ts` getContextItemsFromHistory: file context items and
 * composer code blocks of every item up to and including `priorToIndex`.
 */
export function knoxGuiHistoryFileRefs(history: readonly IKnoxGuiHistoryItem[], priorToIndex = history.length - 1): IKnoxGuiFileRef[] {
	const refs: IKnoxGuiFileRef[] = [];
	for (let i = 0; i <= priorToIndex && i < history.length; i++) {
		for (const ctx of history[i].contextItems ?? []) {
			if (ctx.uri) {
				refs.push(fileRefFromName(ctx.uri, ctx.name));
			}
		}
	}
	for (let i = 0; i <= priorToIndex && i < history.length; i++) {
		for (const block of history[i].inputDoc ?? []) {
			if (block.type === 'codeBlock' && block.filepath) {
				refs.push(fileRefFromName(block.filepath, block.itemName ?? ''));
			}
		}
	}
	return refs;
}

/** `pastFileInfo.ts` computePastFileInfo. */
export function knoxGuiPastFileInfo(history: readonly IKnoxGuiHistoryItem[], index: number, symbols: Readonly<Record<string, IKnoxGuiSymbol[]>>): IKnoxGuiPastFileInfo {
	const rifs = knoxGuiHistoryFileRefs(history, index);
	if (!rifs.length) {
		return KNOX_EMPTY_PAST_FILE_INFO;
	}
	const uris = new Set(rifs.map(rif => rif.filepath));
	return { rifs, symbols: Object.entries(symbols).filter(([uri]) => uris.has(uri)).flatMap(([, list]) => list) };
}

/** `markdown/utils.ts` matchCodeToSymbolOrFile: file basename first, then exact, then prefix symbol. */
export function knoxGuiMatchCodeToSymbolOrFile(content: string, info: IKnoxGuiPastFileInfo): { kind: 'file'; ref: IKnoxGuiFileRef } | { kind: 'symbol'; symbol: IKnoxGuiSymbol } | undefined {
	if (info.rifs.length && content.includes('.') && content.length > 2) {
		const ref = info.rifs.find(rif => rif.filepath.split('/').pop() === content);
		if (ref) {
			return { kind: 'file', ref };
		}
	}
	const symbol = info.symbols.find(s => s.name === content) ?? info.symbols.find(s => content.startsWith(s.name));
	return symbol ? { kind: 'symbol', symbol } : undefined;
}

/** `SymbolLink.tsx`: tooltip body is the symbol source, truncated at 200 characters. */
export function knoxGuiSymbolTooltip(symbol: IKnoxGuiSymbol): string {
	const content = symbol.content;
	if (!content) {
		return symbol.filepath;
	}
	return content.length > 200 ? `${content.slice(0, 196)}\n...` : content;
}

/** Uris without symbols yet (`updateFileSymbolsFromHistory`). */
export function knoxGuiMissingSymbolUris(history: readonly IKnoxGuiHistoryItem[], symbols: Readonly<Record<string, unknown>>): string[] {
	return [...new Set(knoxGuiHistoryFileRefs(history).map(ref => ref.filepath))].filter(uri => !Object.prototype.hasOwnProperty.call(symbols, uri));
}

/** Core `FileSymbolMap`; malformed entries are dropped. */
export function knoxGuiParseSymbolMap(value: unknown): Record<string, IKnoxGuiSymbol[]> {
	const out: Record<string, IKnoxGuiSymbol[]> = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return out;
	}
	for (const [uri, list] of Object.entries(value as Record<string, unknown>)) {
		if (!Array.isArray(list)) {
			continue;
		}
		out[uri] = list.flatMap(raw => {
			const rec = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
			const range = rec?.range as { start?: { line?: unknown }; end?: { line?: unknown } } | undefined;
			if (!rec || typeof rec.name !== 'string' || typeof range?.start?.line !== 'number' || typeof range?.end?.line !== 'number') {
				return [];
			}
			return [{
				name: rec.name,
				type: String(rec.type ?? ''),
				filepath: typeof rec.filepath === 'string' ? rec.filepath : uri,
				content: typeof rec.content === 'string' ? rec.content : '',
				range: { start: { line: range.start.line }, end: { line: range.end.line } },
			}];
		});
	}
	return out;
}

export type KnoxGuiContextOpenAction =
	| { kind: 'url'; url: string }
	| { kind: 'lines'; filepath: string; startLine: number; endLine: number }
	| { kind: 'file'; filepath: string }
	| { kind: 'virtual'; name: string; content: string };

/** `ContextItemsPeek.tsx` openContextItem: URL, file range from `name (a-b)`, whole file, else a virtual document. */
export function knoxGuiContextItemOpenAction(ctx: IKnoxGuiContextItem): KnoxGuiContextOpenAction {
	if (ctx.url) {
		return { kind: 'url', url: ctx.url };
	}
	if (ctx.uri) {
		if (ctx.name.includes(' (') && ctx.name.endsWith(')')) {
			const ref = fileRefFromName(ctx.uri, ctx.name);
			return { kind: 'lines', filepath: ref.filepath, startLine: ref.startLine, endLine: ref.endLine };
		}
		return { kind: 'file', filepath: ctx.uri };
	}
	return { kind: 'virtual', name: ctx.name, content: ctx.content };
}

/** `ContextItemsPeek.tsx` getContextItemIcon file heuristic; the icon name is the description's first path. */
export function knoxGuiContextItemFileIconName(ctx: IKnoxGuiContextItem): string | undefined {
	if (!ctx.content.includes('```') && !ctx.uri) {
		return undefined;
	}
	return (ctx.description ?? '').split(' ')[0]?.split('#')[0] || ctx.name.split(' (')[0];
}
