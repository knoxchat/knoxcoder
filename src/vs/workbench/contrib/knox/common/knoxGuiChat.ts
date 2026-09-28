/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiHistoryItem, IKnoxGuiState, IKnoxGuiToolCall } from './knoxGuiState.js';

export type KnoxGuiSearchPattern =
	| { kind: 'literal'; value: string; caseSensitive: boolean }
	| { kind: 'regex'; regex: RegExp }
	| { kind: 'invalid'; error: string };

const INPUT_ONLY_KEYS: ReadonlySet<keyof IKnoxGuiState> = new Set([
	'input',
	'inputDoc',
	'mentionOpen',
	'slashOpen',
	'suggestItems',
	'suggestQuery',
	'suggestSelected',
	'suggestSubmenu',
	'suggestSubmenuTitle',
	'suggestLoading',
	'suggestQueryItem',
	'suggestCodeToEdit',
	'inputFocused',
]);

export function isKnoxGuiInputOnlyChange(prev: IKnoxGuiState, next: IKnoxGuiState): boolean {
	if (prev === next) {
		return true;
	}
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof IKnoxGuiState>;
	for (const key of keys) {
		if (INPUT_ONLY_KEYS.has(key)) {
			continue;
		}
		if (prev[key] !== next[key]) {
			return false;
		}
	}
	return true;
}

/** ~20 Hz — matches native coalesceStreamDispatch. */
export const STREAM_COALESCE_MS = 50;

export function createStreamUpdateCoalescer<T>(
	emit: (value: T) => void,
	options?: {
		waitMs?: number;
		flushNow?: (value: T) => boolean;
		schedule?: (fn: () => void, ms: number) => () => void;
	},
): { enqueue: (value: T) => void; flush: () => void; dispose: () => void } {
	const waitMs = options?.waitMs ?? STREAM_COALESCE_MS;
	const schedule = options?.schedule ?? ((fn: () => void, ms: number) => {
		const timer = setTimeout(fn, ms);
		return () => clearTimeout(timer);
	});
	let pending: T | undefined;
	let cancel: (() => void) | null = null;
	const flush = () => {
		cancel?.();
		cancel = null;
		if (pending === undefined) {
			return;
		}
		const value = pending;
		pending = undefined;
		emit(value);
	};
	return {
		enqueue(value: T) {
			pending = value;
			if (options?.flushNow?.(value)) {
				flush();
				return;
			}
			if (!cancel) {
				cancel = schedule(flush, waitMs);
			}
		},
		flush,
		dispose() {
			cancel?.();
			cancel = null;
			pending = undefined;
		},
	};
}

export function isKnoxGuiStreamingTokenChange(prev: IKnoxGuiState, next: IKnoxGuiState): boolean {
	if (prev.history.length !== next.history.length || next.history.length === 0) {
		return false;
	}
	const lastPrev = prev.history[prev.history.length - 1];
	const lastNext = next.history[next.history.length - 1];
	if (lastPrev.role !== 'assistant' || lastNext.role !== 'assistant' || lastPrev.id !== lastNext.id) {
		return false;
	}
	if (!lastAssistantToolStreamStable(lastPrev, lastNext)) {
		return false;
	}
	if (!next.isStreaming) {
		return false;
	}
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof IKnoxGuiState>;
	for (const key of keys) {
		if (key === 'history' || key === 'isStreaming' || key === 'toolLoopSteps') {
			continue;
		}
		if (INPUT_ONLY_KEYS.has(key)) {
			continue;
		}
		if (prev[key] !== next[key]) {
			return false;
		}
	}
	for (let i = 0; i < prev.history.length - 1; i += 1) {
		if (prev.history[i] !== next.history[i]) {
			return false;
		}
	}
	return lastPrev.content !== lastNext.content || lastPrev.thinking !== lastNext.thinking || lastPrev.toolCalls !== lastNext.toolCalls || prev.isStreaming !== next.isStreaming;
}

function lastAssistantToolStreamStable(prev: IKnoxGuiHistoryItem, next: IKnoxGuiHistoryItem): boolean {
	const a = prev.toolCalls ?? [];
	const b = next.toolCalls ?? [];
	if (b.length < a.length) {
		return false;
	}
	return a.every((call, i) => call.id === b[i].id && call.name === b[i].name);
}

export function extractSlashUserInput(fullInput: string, commandName: string): string {
	const prefix = `/${commandName}`;
	if (fullInput.startsWith(prefix)) {
		return fullInput.slice(prefix.length).trimStart();
	}
	return fullInput;
}

export function expandPromptSlashCommand(prompt: string, userInput: string): string {
	if (prompt.includes('{{{ input }}}') || prompt.includes('{{{input}}}')) {
		return prompt.replace(/\{\{\{\s*input\s*\}\}\}/g, userInput).trim();
	}
	if (!userInput.trim()) {
		return prompt.trim();
	}
	return `${prompt.trim()}\n\n${userInput}`;
}

export function isPromptBasedSlashCommand(command: { prompt?: string }): boolean {
	return typeof command.prompt === 'string' && command.prompt.length > 0;
}

export function parseLeadingSlash(input: string): { name: string; rest: string } | undefined {
	const match = input.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) {
		return undefined;
	}
	return { name: match[1], rest: match[2] ?? '' };
}

export interface IKnoxGuiCodeFence {
	language: string;
	filepath?: string;
	range?: string;
	code: string;
}

/** TipTap/markdown infostring: `ts app.ts L10-20` → language, path, optional range. */
export function parseFenceMeta(meta: string): { language: string; filepath?: string; range?: string } {
	const parts = meta.trim().split(/\s+/).filter(Boolean);
	return {
		language: parts[0] || '',
		filepath: parts[1] || undefined,
		range: parts[2] || undefined,
	};
}

export function extractCodeFences(markdown: string): IKnoxGuiCodeFence[] {
	const fences: IKnoxGuiCodeFence[] = [];
	const re = /```([^\n]*)\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(markdown)) !== null) {
		const parsed = parseFenceMeta(match[1]);
		fences.push({
			language: parsed.language,
			filepath: parsed.filepath,
			range: parsed.range,
			code: match[2].replace(/\n$/, ''),
		});
	}
	return fences;
}

export function compileSearchPattern(query: string, options: { caseSensitive: boolean; regex: boolean }): KnoxGuiSearchPattern {
	if (!query) {
		return { kind: 'literal', value: '', caseSensitive: options.caseSensitive };
	}
	if (!options.regex) {
		return {
			kind: 'literal',
			value: options.caseSensitive ? query : query.toLowerCase(),
			caseSensitive: options.caseSensitive,
		};
	}
	try {
		return { kind: 'regex', regex: new RegExp(query, options.caseSensitive ? 'g' : 'gi') };
	} catch (error) {
		return { kind: 'invalid', error: error instanceof Error ? error.message : 'Invalid regular expression' };
	}
}

export function textMatchesPattern(text: string, pattern: KnoxGuiSearchPattern): boolean {
	if (pattern.kind === 'invalid') {
		return false;
	}
	if (pattern.kind === 'literal') {
		if (!pattern.value) {
			return false;
		}
		const haystack = pattern.caseSensitive ? text : text.toLowerCase();
		return haystack.includes(pattern.value);
	}
	pattern.regex.lastIndex = 0;
	return pattern.regex.test(text);
}

export function historyItemSearchText(item: IKnoxGuiHistoryItem): string {
	const parts = [item.content, item.thinking ?? ''];
	for (const ctx of item.contextItems ?? []) {
		parts.push(ctx.name, ctx.content);
	}
	for (const tool of item.toolCalls ?? []) {
		parts.push(tool.name, tool.arguments, tool.output ?? '');
		for (const output of tool.outputItems ?? []) {
			parts.push(output.content);
		}
	}
	return parts.join('\n');
}

export function knoxGuiFindRegexInvalid(query: string, regex: boolean): boolean {
	if (!regex || !query) {
		return false;
	}
	return compileSearchPattern(query, { caseSensitive: false, regex: true }).kind === 'invalid';
}

export function findMatchingHistoryIndexes(history: IKnoxGuiHistoryItem[], query: string, options: { caseSensitive: boolean; regex: boolean }): number[] {
	const pattern = compileSearchPattern(query, options);
	if (pattern.kind === 'invalid' || !query) {
		return [];
	}
	const indexes: number[] = [];
	for (let i = 0; i < history.length; i++) {
		if (textMatchesPattern(historyItemSearchText(history[i]), pattern)) {
			indexes.push(i);
		}
	}
	return indexes;
}

/**
 * `core/util/incrementalParseJson`: complete JSON first, then close open
 * strings/objects/arrays so streamed tool arguments fill titles before the
 * object is finished. Unparseable input is `{}`, matching the original GUI.
 */
export function incrementalParseJson(raw: string): [complete: boolean, value: unknown] {
	if (!raw || !raw.trim()) {
		return [false, {}];
	}
	try {
		return [true, JSON.parse(raw)];
	} catch {
		try {
			return [false, JSON.parse(closePartialJson(raw))];
		} catch {
			return [false, {}];
		}
	}
}

function closePartialJson(raw: string): string {
	let inString = false;
	let escaped = false;
	const stack: string[] = [];
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === '\\') {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === '{') {
			stack.push('}');
		} else if (ch === '[') {
			stack.push(']');
		} else if ((ch === '}' || ch === ']') && stack.length) {
			stack.pop();
		}
	}
	let result = raw;
	if (escaped) {
		result = result.slice(0, -1);
	}
	if (inString) {
		result += '"';
	}
	result = result.replace(/\s+$/, '');
	result = result.replace(/,\s*$/, '');
	if (/:\s*$/.test(result)) {
		result = result.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, '');
	} else if (/([{,])\s*"(?:[^"\\]|\\.)*"?\s*$/.test(result)) {
		result = result.replace(/([{,])\s*"(?:[^"\\]|\\.)*"?\s*$/, (_, sep: string) => sep === '{' ? '{' : '');
	}
	result = result.replace(/,\s*$/, '');
	if (/[-.eE]$/.test(result)) {
		result += '0';
	}
	for (let i = stack.length - 1; i >= 0; i--) {
		result += stack[i];
	}
	return result;
}

export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
	if (!raw) {
		return {};
	}
	const [, parsed] = incrementalParseJson(raw);
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		return parsed as Record<string, unknown>;
	}
	return parsed === undefined ? {} : { value: parsed };
}

export function toolDisplayKind(name: string): 'terminal' | 'file' | 'search' | 'repo-map' | 'subdirectory' | 'create-file' | 'subagent' | 'ask-user' | 'generic' {
	const n = name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	if (n === 'ask_user' || n === 'askuser') {
		return 'ask-user';
	}
	if (n === 'run_terminal_command' || n === 'build' || n === 'await_shell' || n.startsWith('pty') || n === 'qemu' || n === 'debug') {
		return 'terminal';
	}
	if (n === 'create_new_file' || n === 'createnewfile') {
		return 'create-file';
	}
	if (n === 'read_file' || n === 'edit_file' || n === 'write_file' || n === 'apply_patch' || n === 'read_currently_open_file') {
		return 'file';
	}
	if (n === 'exact_search' || n === 'exactsearch') {
		return 'search';
	}
	if (n === 'view_repo_map' || n === 'viewrepomap') {
		return 'repo-map';
	}
	if (n === 'view_subdirectory' || n === 'viewsubdirectory') {
		return 'subdirectory';
	}
	if (n === 'task') {
		return 'subagent';
	}
	return 'generic';
}

export const FILE_EDIT_TOOL_NAMES = new Set([
	'builtin_create_new_file',
	'builtin_edit_file',
	'builtin_write_file',
	'builtin_apply_patch',
	'builtin_generate_tests',
	'composite_smart_edit',
	'create_new_file',
	'edit_file',
	'write_file',
	'apply_patch',
]);

export const ASK_USER_TOOL_NAMES = new Set(['builtin_ask_user', 'ask_user', 'AskUser']);

/** Display window for long chats — copy of chatHistoryWindow. */
export const CHAT_DISPLAY_WINDOW = 25;
export const CHAT_LOAD_MORE_COUNT = 25;
export const AUTO_DISPLAY_START = Number.POSITIVE_INFINITY;
export const GUI_DISPLAY_MAX_CHARS = 32_000;
export const GUI_SESSION_HYDRATE_BUDGET_BYTES = 8_000_000;

export interface IKnoxGuiChatTurn {
	userIndex: number;
	startIndex: number;
	endIndex: number;
}

export function lastUserHistoryIndex(history: Array<{ role: string }>): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'user') {
			return i;
		}
	}
	return -1;
}

export function groupHistoryTurns(history: Array<{ role: string }>): IKnoxGuiChatTurn[] {
	const turns: IKnoxGuiChatTurn[] = [];
	if (history.length === 0) {
		return turns;
	}
	let start = 0;
	let userIndex = history[0].role === 'user' ? 0 : -1;
	for (let i = 1; i <= history.length; i++) {
		const isNewUser = i < history.length && history[i].role === 'user';
		if (!isNewUser && i !== history.length) {
			continue;
		}
		turns.push({ userIndex, startIndex: start, endIndex: i });
		start = i;
		userIndex = isNewUser ? i : -1;
	}
	return turns;
}

export function snapStartToTurn(start: number, turns: IKnoxGuiChatTurn[]): number {
	if (start <= 0 || turns.length === 0) {
		return Math.max(0, start);
	}
	for (const turn of turns) {
		if (start >= turn.startIndex && start < turn.endIndex) {
			return turn.startIndex;
		}
	}
	return start;
}

export function computeDisplayStart(args: {
	historyLength: number;
	expandedStart: number;
	windowSize?: number;
}): number {
	const { historyLength, expandedStart, windowSize = CHAT_DISPLAY_WINDOW } = args;
	if (historyLength <= 0) {
		return 0;
	}
	if (historyLength <= windowSize) {
		return 0;
	}
	const tailStart = Math.max(0, historyLength - windowSize);
	return Math.min(Math.max(0, expandedStart), tailStart);
}

export function resolveDisplayStart(args: {
	historyLength: number;
	expandedStart: number;
	turns: IKnoxGuiChatTurn[];
	windowSize?: number;
}): number {
	const raw = computeDisplayStart(args);
	if (!Number.isFinite(args.expandedStart)) {
		return raw;
	}
	return snapStartToTurn(raw, args.turns);
}

export function nextExpandedStart(displayStart: number, loadCount: number = CHAT_LOAD_MORE_COUNT): number {
	return Math.max(0, displayStart - loadCount);
}

export function visibleTurnIndexes(turn: IKnoxGuiChatTurn, displayStart: number, lastUserIndex: number): number[] {
	const start = Math.max(turn.startIndex, displayStart);
	const indexes: number[] = [];
	if (
		turn.userIndex === lastUserIndex &&
		lastUserIndex >= 0 &&
		lastUserIndex < start &&
		lastUserIndex < turn.endIndex
	) {
		indexes.push(lastUserIndex);
	}
	for (let i = start; i < turn.endIndex; i++) {
		indexes.push(i);
	}
	return indexes;
}

/** Pin the real last-sent prompt above the scroller while following a live turn. */
export function shouldFloatLastUser(args: {
	isStreaming: boolean;
	followLive: boolean;
	lastUserIndex: number;
}): boolean {
	return args.isStreaming && args.followLive && args.lastUserIndex >= 0;
}

/** Latest tool-call state on the newest history item that has any, matching GUI findCurrentToolCall. */
export function findCurrentToolCall(history: Array<{ toolCalls?: IKnoxGuiToolCall[] }>): IKnoxGuiToolCall | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const calls = history[i].toolCalls;
		if (!calls?.length) {
			continue;
		}
		const live = [...calls].reverse().find(call =>
			call.status === 'generating' || call.status === 'generated' || call.status === 'calling');
		return live ?? calls[calls.length - 1];
	}
	return undefined;
}

export function capDisplayText(text: string, maxChars = GUI_DISPLAY_MAX_CHARS): { text: string; truncated: boolean } {
	if (!text || text.length <= maxChars) {
		return { text: text ?? '', truncated: false };
	}
	let tail = text.slice(-maxChars);
	const nl = tail.indexOf('\n');
	if (nl !== -1 && nl < tail.length - 1) {
		tail = tail.slice(nl + 1);
	}
	return { text: tail, truncated: true };
}

export function estimateHistoryPayloadBytes(history: IKnoxGuiHistoryItem[]): number {
	let n = 64;
	for (const item of history) {
		n += (item.content?.length ?? 0) * 2;
		n += (item.thinking?.length ?? 0) * 2;
		for (const tool of item.toolCalls ?? []) {
			n += (tool.arguments?.length ?? 0) * 2;
			n += (tool.output?.length ?? 0) * 2;
		}
	}
	return n;
}

export function shouldWarnLargeSession(history: IKnoxGuiHistoryItem[]): boolean {
	return estimateHistoryPayloadBytes(history) > GUI_SESSION_HYDRATE_BUDGET_BYTES;
}

export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 24;

export interface IKnoxGuiScrollFollow {
	following: boolean;
	lastScrollTop: number;
	lastScrollHeight: number;
}

/**
 * `useEnhancedScroll` scroll handler: programmatic scrolls and scrollTop clamps caused by the
 * content shrinking keep the follow state; only an upward user scroll pauses, reaching the bottom resumes.
 */
export function knoxGuiNextScrollFollow(
	prev: IKnoxGuiScrollFollow,
	event: { scrollTop: number; scrollHeight: number; clientHeight: number; programmatic: boolean },
): IKnoxGuiScrollFollow {
	const heightDropped = event.scrollHeight < prev.lastScrollHeight - 1;
	const base = { lastScrollTop: event.scrollTop, lastScrollHeight: event.scrollHeight };
	if (event.programmatic || heightDropped) {
		return { following: prev.following, ...base };
	}
	const atBottom = event.scrollTop + event.clientHeight >= event.scrollHeight - CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
	if (event.scrollTop < prev.lastScrollTop && !atBottom) {
		return { following: false, ...base };
	}
	return { following: atBottom ? true : prev.following, ...base };
}
