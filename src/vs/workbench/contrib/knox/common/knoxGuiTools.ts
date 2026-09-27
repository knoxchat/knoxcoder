/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiAskQuestion, IKnoxGuiTool, IKnoxGuiToolCall, IKnoxGuiToolOutputItem, KnoxToolSetting, KnoxToolStatus } from './knoxGuiState.js';
import { toolStepDetail } from './knoxGuiTranscript.js';

export const TOOL_PARTIAL_OUTPUT_COALESCE_MS = 50;
export const TERMINAL_TAIL_LINES = 400;
export const TERMINAL_TAIL_CHARS = 32_000;
export const STATIC_TREE_PREVIEW_LINES = 24;

const LIVE_STATUSES: ReadonlySet<KnoxToolStatus> = new Set(['generating', 'generated', 'calling']);

export const FILEPATH_KEYS = [
	'target_file', 'filepath', 'file_path', 'path', 'file', 'filename', 'relativeFilepath', 'outputPath',
] as const;

export const CODE_CONTENT_KEYS = [
	'code_edit', 'contents', 'content', 'code', 'new_contents', 'new_string', 'replacement', 'patch', 'diff', 'body', 'text', 'source', 'old_string',
] as const;

export interface IKnoxGuiStreamingToolCode {
	filepath: string;
	codeContent: string;
	contentKey?: string;
	started: boolean;
}

export interface IKnoxGuiFinishedToolSummary {
	name: string;
	detail?: string;
	result?: string;
}

export interface IKnoxGuiSearchLine {
	lineNum: number;
	content: string;
	isMatch: boolean;
}

export interface IKnoxGuiSearchMatch {
	filePath: string;
	language: string;
	lines: IKnoxGuiSearchLine[];
}

export interface IKnoxGuiAnsiSpan {
	text: string;
	color?: string;
	bold?: boolean;
	dim?: boolean;
}

export interface IKnoxGuiAnsiPalette {
	foreground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

export interface IKnoxGuiTreeTheme {
	background: string;
	backgroundGradientStart: string;
	backgroundGradientEnd: string;
	border: string;
	foreground: string;
	foregroundMuted: string;
	accent: string;
}

export type KnoxGuiToolPermissionDisplay = 'disabled' | 'autoApprove' | 'sessionAlways' | 'requiresApproval';

export const DARK_TERMINAL_PALETTE: IKnoxGuiAnsiPalette = {
	foreground: '#abb2bf',
	black: '#282c34',
	red: '#e06c75',
	green: '#98c379',
	yellow: '#e5c07b',
	blue: '#61afef',
	magenta: '#c678dd',
	cyan: '#56b6c2',
	white: '#abb2bf',
	brightBlack: '#5c6370',
	brightRed: '#e06c75',
	brightGreen: '#98c379',
	brightYellow: '#e5c07b',
	brightBlue: '#61afef',
	brightMagenta: '#c678dd',
	brightCyan: '#56b6c2',
	brightWhite: '#ffffff',
};

export const LIGHT_TERMINAL_PALETTE: IKnoxGuiAnsiPalette = {
	foreground: '#383a42',
	black: '#383a42',
	red: '#e45649',
	green: '#50a14f',
	yellow: '#c18401',
	blue: '#4078f2',
	magenta: '#a626a4',
	cyan: '#0184bc',
	white: '#a0a1a7',
	brightBlack: '#696c77',
	brightRed: '#e45649',
	brightGreen: '#50a14f',
	brightYellow: '#c18401',
	brightBlue: '#4078f2',
	brightMagenta: '#a626a4',
	brightCyan: '#0184bc',
	brightWhite: '#383a42',
};

const DARK_ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	blue: '\x1b[38;2;97;175;239m',
	cyan: '\x1b[38;2;86;182;194m',
	green: '\x1b[38;2;152;195;121m',
	yellow: '\x1b[38;2;229;192;123m',
	red: '\x1b[38;2;224;108;117m',
	magenta: '\x1b[38;2;198;120;221m',
	gray: '\x1b[38;2;92;99;112m',
	white: '\x1b[38;2;171;178;191m',
};

const LIGHT_ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	blue: '\x1b[38;2;64;120;242m',
	cyan: '\x1b[38;2;1;132;188m',
	green: '\x1b[38;2;80;161;79m',
	yellow: '\x1b[38;2;193;132;1m',
	red: '\x1b[38;2;228;86;73m',
	magenta: '\x1b[38;2;166;38;164m',
	gray: '\x1b[38;2;105;108;119m',
	white: '\x1b[38;2;56;58;66m',
};

export function isLiveToolStatus(status: KnoxToolStatus): boolean {
	return LIVE_STATUSES.has(status);
}

export function shouldRenderToolBody(status: KnoxToolStatus, userCollapsed: boolean, options?: { alwaysShow?: boolean }): boolean {
	if (options?.alwaysShow) {
		return true;
	}
	if (isLiveToolStatus(status)) {
		return true;
	}
	return !userCollapsed;
}

export function toolAlwaysShowsBody(toolName: string | undefined): boolean {
	const n = (toolName ?? '').replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	return n === 'ask_user' || n === 'askuser';
}

export function formatToolName(name: string, displayTitle?: string): string {
	if (displayTitle) {
		return displayTitle;
	}
	return name
		.replace(/^builtin_/, '')
		.split(/[_-]/g)
		.filter(Boolean)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function getCategorizedToolName(name: string, displayTitle?: string): string {
	const formatted = formatToolName(name, displayTitle);
	if (name.includes('memory')) {
		return `[Memory] ${formatted}`;
	}
	if (name.includes('file') || name.includes('directory') || name.includes('map')) {
		return `[Files] ${formatted}`;
	}
	if (name.includes('search')) {
		return `[Search] ${formatted}`;
	}
	if (name.includes('terminal') || name.includes('command')) {
		return `[Terminal] ${formatted}`;
	}
	if (name.includes('diff')) {
		return `[Diff] ${formatted}`;
	}
	if (name.includes('web')) {
		return `[Web] ${formatted}`;
	}
	return `[Tool] ${formatted}`;
}

export function renderToolTemplate(template: string, args: Record<string, unknown>): string {
	return template
		.replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, key: string) => String(args[key] ?? ''))
		.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(args[key] ?? ''))
		.trim();
}

export function toolStatusIntroKey(status: KnoxToolStatus): string {
	if (status === 'generating') {
		return 'toolGenerating';
	}
	if (status === 'generated') {
		return 'toolWouldLikeTo';
	}
	if (status === 'calling') {
		return 'toolFor';
	}
	if (status === 'canceled' || status === 'errored') {
		return 'toolCanceled';
	}
	return '';
}

export function toolStatusFallbackKey(status: KnoxToolStatus): string {
	if (status === 'calling') {
		return 'toolUsing';
	}
	if (status === 'done') {
		return 'toolUsed';
	}
	return 'toolUse';
}

export type KnoxGuiToolStatusIcon = 'spinner' | 'arrow-right' | 'check' | 'x';

export function toolStatusIcon(status: KnoxToolStatus): KnoxGuiToolStatusIcon {
	if (status === 'generating' || status === 'calling') {
		return 'spinner';
	}
	if (status === 'generated') {
		return 'arrow-right';
	}
	if (status === 'done') {
		return 'check';
	}
	return 'x';
}

export function finishedToolSummaryText(summary: IKnoxGuiFinishedToolSummary): string {
	return [summary.detail, summary.result].filter(Boolean).join(' · ');
}

export function terminalBodyHeight(tail: string, hasCommand: boolean, minHeight = 80, maxHeight = 400): number {
	const lineCount = (tail ? tail.split('\n').length : 0) + (hasCommand ? 1 : 0);
	return Math.min(Math.max(lineCount * 18 + 24, minHeight), maxHeight);
}

export function highlightSearchQueryInHtml(html: string, query: string): string {
	if (!query || !html) {
		return html;
	}
	try {
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escaped})`, 'gi');
		return html.split(/(<[^>]+>)/).map(part => {
			if (part.startsWith('<')) {
				return part;
			}
			return part.replace(regex, '<mark class="knox-gui-search-match">$1</mark>');
		}).join('');
	} catch {
		return html;
	}
}

export function catalogToolForCall(tools: IKnoxGuiTool[], name: string): IKnoxGuiTool | undefined {
	return tools.find(tool => tool.name === name);
}

function lineCount(text: string | undefined): number | undefined {
	if (!text) {
		return undefined;
	}
	return text.split('\n').length;
}

export function toolOutputItemsFromUnknown(value: unknown): IKnoxGuiToolOutputItem[] {
	if (value == null) {
		return [];
	}
	if (typeof value === 'string') {
		return value ? [{ content: value }] : [];
	}
	const list = Array.isArray(value) ? value : [value];
	const items: IKnoxGuiToolOutputItem[] = [];
	for (const part of list) {
		if (typeof part === 'string') {
			if (part) {
				items.push({ content: part });
			}
			continue;
		}
		if (!part || typeof part !== 'object') {
			continue;
		}
		const rec = part as Record<string, unknown>;
		const content = typeof rec.content === 'string' ? rec.content : typeof rec.text === 'string' ? rec.text : '';
		const name = typeof rec.name === 'string' ? rec.name : undefined;
		const description = typeof rec.description === 'string' ? rec.description : undefined;
		if (!content && !name) {
			continue;
		}
		items.push({ name, description, content });
	}
	return items;
}

export function toolOutputText(items: IKnoxGuiToolOutputItem[] | undefined, fallback?: string): string {
	if (items?.length) {
		return items.map(item => item.content).filter(Boolean).join('\n');
	}
	return fallback ?? '';
}

export function toolResultHint(call: IKnoxGuiToolCall): string | undefined {
	if (call.status === 'canceled') {
		return 'canceled';
	}
	const output = call.outputItems?.[0]?.content ?? call.output;
	const lines = lineCount(output);
	if (lines && lines > 1) {
		return `${lines} lines`;
	}
	const desc = call.outputItems?.[0]?.description?.trim();
	if (desc && desc.length < 80) {
		return desc;
	}
	return toolStepDetail(call.name, call.parsedArgs);
}

export function finishedToolSummary(call: IKnoxGuiToolCall, displayTitle?: string): IKnoxGuiFinishedToolSummary {
	const name = formatToolName(call.name, displayTitle);
	const detail = toolStepDetail(call.name, call.parsedArgs);
	const result = toolResultHint(call);
	return {
		name,
		detail,
		result: result && result !== detail ? result : undefined,
	};
}

export function collapseFileToolCodePreview(toolName?: string): boolean {
	if (!toolName) {
		return false;
	}
	const n = toolName.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	return n === 'read_file' || n === 'readfile' || n === 'read_currently_open_file' || n === 'readcurrentlyopenfile';
}

function asArgsRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function findArgByKeys(args: Record<string, unknown>, keys: readonly string[]): { key: string; value: string } | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string' && value.length > 0) {
			return { key, value };
		}
	}
	return undefined;
}

function findNestedContent(args: Record<string, unknown>): { key: string; value: string } | undefined {
	const modification = args.modification;
	if (!modification || typeof modification !== 'object' || Array.isArray(modification)) {
		return undefined;
	}
	const content = (modification as { content?: unknown }).content;
	if (typeof content === 'string' && content.length > 0) {
		return { key: 'content', value: content };
	}
	return undefined;
}

function unescapeJsonString(raw: string): string {
	try {
		return JSON.parse(`"${raw}"`) as string;
	} catch {
		return raw
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
	}
}

function extractJsonStringField(raw: string, key: string): string | undefined {
	const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"?`);
	const match = raw.match(pattern);
	if (match && match[1] !== undefined) {
		return unescapeJsonString(match[1]);
	}
	return undefined;
}

function extractFieldFromRaw(raw: string, keys: readonly string[]): { key: string; value: string } | undefined {
	for (const key of keys) {
		const value = extractJsonStringField(raw, key);
		if (value !== undefined && value.length > 0) {
			return { key, value };
		}
	}
	return undefined;
}

function fieldStartedInRaw(raw: string, keys: readonly string[]): boolean {
	return keys.some(key => new RegExp(`"${key}"\\s*:\\s*"`).test(raw));
}

export function extractStreamingToolCode(options: { parsedArgs?: unknown; rawArguments?: unknown }): IKnoxGuiStreamingToolCode {
	const parsed = asArgsRecord(options.parsedArgs) ?? {};
	const raw = typeof options.rawArguments === 'string' ? options.rawArguments : '';
	let fromRaw: Record<string, unknown> = {};
	if (raw) {
		try {
			const parsedRaw = JSON.parse(raw);
			fromRaw = asArgsRecord(parsedRaw) ?? {};
		} catch {
			fromRaw = {};
		}
	}
	const merged = { ...fromRaw, ...parsed };
	const filepathHit = findArgByKeys(merged, FILEPATH_KEYS) ?? (raw ? extractFieldFromRaw(raw, FILEPATH_KEYS) : undefined);
	const contentHit = findNestedContent(merged) ?? findArgByKeys(merged, CODE_CONTENT_KEYS) ?? (raw ? extractFieldFromRaw(raw, CODE_CONTENT_KEYS) : undefined);
	let codeContent = contentHit?.value ?? '';
	if (!codeContent && raw && fieldStartedInRaw(raw, CODE_CONTENT_KEYS)) {
		for (const key of CODE_CONTENT_KEYS) {
			const extracted = extractJsonStringField(raw, key);
			if (extracted !== undefined) {
				codeContent = extracted;
				break;
			}
		}
	}
	const filepath = filepathHit?.value ?? '';
	const started = filepath.length > 0 || codeContent.length > 0 || (!!raw && fieldStartedInRaw(raw, [...FILEPATH_KEYS, ...CODE_CONTENT_KEYS]));
	return { filepath, codeContent, contentKey: contentHit?.key, started };
}

export function displayArgsForToolCall(parsedArgs: unknown, rawArguments?: unknown): Record<string, unknown> {
	const parsed = asArgsRecord(parsedArgs) ?? {};
	const extracted = extractStreamingToolCode({ parsedArgs, rawArguments });
	return {
		...parsed,
		...(extracted.filepath ? { filepath: extracted.filepath } : {}),
	};
}

export function calculateFence(contents: string): string {
	const backtickMatches = contents.match(/`{3,}/g);
	if (backtickMatches) {
		const maxLength = Math.max(...backtickMatches.map(m => m.length));
		return '`'.repeat(maxLength + 1);
	}
	return '```';
}

export function extractTerminalOutput(items: Array<{ name?: string; description?: string; content?: string }> | undefined): string {
	if (!items?.length) {
		return '';
	}
	const match = items.find(item =>
		item.name === 'Terminal' ||
		item.name === 'Build' ||
		item.name === 'Terminal command output' ||
		item.description === 'Terminal command output' ||
		item.description?.startsWith('Terminal command') ||
		item.description?.startsWith('Background shell') ||
		item.description?.startsWith('Shell job') ||
		item.description === 'Unknown shell job' ||
		item.description?.includes('shell job'));
	return match?.content || items[0]?.content || '';
}

export function displayBuildCommand(args: Record<string, unknown> | undefined): string {
	if (!args) {
		return 'project build';
	}
	const explain = typeof args.explain === 'string' ? args.explain.trim() : '';
	if (explain) {
		const code = explain.toUpperCase().match(/E\d{4}/);
		return code ? `rustc --explain ${code[0]}` : `rustc --explain ${explain}`;
	}
	const doc = (typeof args.doc === 'string' && args.doc.trim()) || (typeof args.symbol === 'string' && args.symbol.trim()) || '';
	const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
	if (action === 'doc' || doc) {
		return doc ? `rustdoc ${doc}` : 'rustdoc lookup';
	}
	if (typeof args.command === 'string' && args.command.trim()) {
		return args.command.trim();
	}
	const extra = (typeof args.extraArgs === 'string' && args.extraArgs.trim()) || (typeof args.extra_args === 'string' && args.extra_args.trim()) || '';
	const jobsRaw = args.jobs;
	const jobs = typeof jobsRaw === 'number' && Number.isFinite(jobsRaw) && jobsRaw > 0 ? `-j${Math.min(Math.floor(jobsRaw), 256)}` : '';
	const target = typeof args.target === 'string' ? args.target.trim() : '';
	const pkg = target && /^[\w.-]+$/.test(target) && !target.includes('/') ? `-p ${target}` : target;
	const cargoVerb: Record<string, string> = {
		check: 'check', build: 'build', bench: 'bench', clippy: 'clippy', test: 'test',
		fix: 'fix --allow-dirty', expand: 'expand', miri: '+nightly miri test', deny: 'deny check',
		audit: 'audit', tree: 'tree', fmt: 'fmt --check',
	};
	const verb = cargoVerb[action];
	if (verb) {
		return ['cargo', verb, jobs, pkg, extra].filter(Boolean).join(' ');
	}
	if (!action && !jobs && !pkg && !extra) {
		return 'project build';
	}
	return ['build', jobs, pkg, extra].filter(Boolean).join(' ');
}

export function terminalCommandForTool(name: string, args: Record<string, unknown>, t: (key: string, vars?: Record<string, string | number>) => string): string {
	const n = name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	if (n === 'build') {
		return displayBuildCommand(args);
	}
	if (n === 'await_shell') {
		const id = typeof args.job_id === 'string' ? args.job_id : '';
		if (!id) {
			return t('jobsListCommand');
		}
		return args.kill ? t('jobsKillCommand', { id }) : t('jobsAwaitCommand', { id });
	}
	if (n === 'pty_start') {
		return String(args.command ?? '');
	}
	if (n === 'pty_send') {
		return args.job_id ? `pty send ${args.job_id}` : 'pty send';
	}
	if (n === 'pty_read') {
		const id = typeof args.job_id === 'string' ? args.job_id : '';
		if (!id) {
			return 'pty read';
		}
		return args.kill ? t('jobsKillCommand', { id }) : `pty read ${id}`;
	}
	if (n === 'qemu') {
		if (args.action === 'start') {
			return String(args.command || `qemu ${args.kernel || args.arch || 'session'}`);
		}
		return args.job_id ? `qemu ${args.action || 'status'} ${args.job_id}` : `qemu ${args.action || 'session'}`;
	}
	if (n === 'debug') {
		return `debug ${args.op || 'session'}`;
	}
	return String(args.command ?? '');
}

export function takeTerminalTail(content: string, maxLines = TERMINAL_TAIL_LINES, maxChars = TERMINAL_TAIL_CHARS): { tail: string; truncated: boolean; hiddenLines: number } {
	if (!content) {
		return { tail: '', truncated: false, hiddenLines: 0 };
	}
	const lines = content.split('\n');
	const start = Math.max(0, lines.length - maxLines);
	let tail = lines.slice(start).join('\n');
	if (tail.length > maxChars) {
		tail = tail.slice(-maxChars);
		const nl = tail.indexOf('\n');
		if (nl !== -1 && nl < tail.length - 1) {
			tail = tail.slice(nl + 1);
		}
		const tailLineCount = tail ? tail.split('\n').length : 0;
		return { tail, truncated: true, hiddenLines: Math.max(0, lines.length - tailLineCount) };
	}
	return { tail, truncated: start > 0, hiddenLines: start };
}

export function extractLogPathFromTerminalOutput(text: string): string | undefined {
	const match = text.match(/^Full log:\s*(.+)$/m);
	const path = match?.[1]?.trim();
	return path || undefined;
}

export function mergeToolArguments(previous: string, incoming: string): string {
	if (!incoming) {
		return previous;
	}
	if (!previous) {
		return incoming;
	}
	if (incoming.startsWith(previous)) {
		return incoming;
	}
	if (previous.startsWith(incoming)) {
		return previous;
	}
	try {
		JSON.parse(incoming);
		return incoming;
	} catch {
		return previous + incoming;
	}
}

export function toolPermissionDisplay(params: {
	toolName: string;
	toolSettings: Record<string, KnoxToolSetting>;
	sessionAllowlist: string[];
}): KnoxGuiToolPermissionDisplay {
	const setting = params.toolSettings[params.toolName] ?? 'allowedWithoutPermission';
	if (setting === 'disabled') {
		return 'disabled';
	}
	if (setting === 'allowedWithoutPermission') {
		return 'autoApprove';
	}
	if (params.sessionAllowlist.includes(params.toolName)) {
		return 'sessionAlways';
	}
	return 'requiresApproval';
}

export function splitChoiceText(option: string): { value: string; label: string; description?: string } {
	const match = option.match(/^(.+?)\s+[—–-]\s+(.+)$/u);
	if (match) {
		return { value: option, label: match[1].trim(), description: match[2].trim() };
	}
	return { value: option, label: option };
}

/** Same default ids as core `parseAskUserQuestions` (`q1`, `q2`, …). */
export function parseAskUserQuestionsForGui(raw: unknown): IKnoxGuiAskQuestion[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const questions: IKnoxGuiAskQuestion[] = [];
	raw.forEach((item, index) => {
		const fallbackId = `q${index + 1}`;
		if (typeof item === 'string') {
			const prompt = item.trim();
			if (prompt) {
				questions.push({ id: fallbackId, prompt });
			}
			return;
		}
		if (!item || typeof item !== 'object') {
			return;
		}
		const rec = item as Record<string, unknown>;
		const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim()
			: typeof rec.question === 'string' ? rec.question.trim()
				: typeof rec.title === 'string' ? rec.title.trim()
					: '';
		if (!prompt) {
			return;
		}
		const idRaw = rec.id;
		const nameRaw = rec.name;
		const id = typeof idRaw === 'string' && idRaw.trim()
			? idRaw.trim()
			: typeof nameRaw === 'string' && nameRaw.trim()
				? nameRaw.trim()
				: fallbackId;
		const options = Array.isArray(rec.options)
			? rec.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
			: undefined;
		questions.push({
			id,
			prompt,
			options: options?.length ? options : undefined,
			allowMultiple: rec.allow_multiple === true || rec.allowMultiple === true,
			allowFreeform: rec.allow_freeform === true || rec.allowFreeform === true || Boolean(rec.input),
		});
	});
	return questions;
}

export function isAskUserAnswered(value: string | undefined): boolean {
	return typeof value === 'string' && value.split('\u0001').some(part => part.trim().length > 0);
}

export function detectSearchLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() || '';
	const langMap: Record<string, string> = {
		ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python',
		rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c',
		cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php', html: 'html', css: 'css',
		scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', md: 'markdown',
		sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
	};
	return langMap[ext] || 'plaintext';
}

export function parseSearchResults(content: string): IKnoxGuiSearchMatch[] {
	if (!content || content === 'No matches found' || content.startsWith('Error:')) {
		return [];
	}
	const results: IKnoxGuiSearchMatch[] = [];
	let currentFile: IKnoxGuiSearchMatch | null = null;
	for (const line of content.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		if (line === '--' || line.startsWith('…') || line.startsWith('...')) {
			continue;
		}
		const lineNumMatch = line.match(/^(\d+)([:|-])(.*)$/);
		if (lineNumMatch && currentFile) {
			currentFile.lines.push({
				lineNum: parseInt(lineNumMatch[1], 10),
				content: lineNumMatch[3],
				isMatch: lineNumMatch[2] === ':',
			});
			continue;
		}
		const countMatch = line.match(/^(.*):(\d+)\s*$/);
		if (countMatch && !/^\d+[:\-]/.test(line) && /[\\/]/.test(countMatch[1] ?? '')) {
			if (currentFile) {
				results.push(currentFile);
			}
			currentFile = { filePath: countMatch[1] ?? line, language: detectSearchLanguage(countMatch[1] ?? line), lines: [] };
			continue;
		}
		if (currentFile) {
			results.push(currentFile);
		}
		currentFile = { filePath: line, language: detectSearchLanguage(line), lines: [] };
	}
	if (currentFile) {
		results.push(currentFile);
	}
	return results;
}

export function luminanceIsLight(backgroundColor: string): boolean {
	if (!backgroundColor) {
		return false;
	}
	let r = 0;
	let g = 0;
	let b = 0;
	if (backgroundColor.startsWith('#')) {
		const hex = backgroundColor.slice(1);
		r = parseInt(hex.substring(0, 2), 16);
		g = parseInt(hex.substring(2, 4), 16);
		b = parseInt(hex.substring(4, 6), 16);
	} else if (backgroundColor.startsWith('rgb')) {
		const match = backgroundColor.match(/\d+/g);
		if (match && match.length >= 3) {
			r = parseInt(match[0]);
			g = parseInt(match[1]);
			b = parseInt(match[2]);
		}
	}
	return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

export function treeThemeColors(isLight: boolean): IKnoxGuiTreeTheme {
	return {
		background: isLight ? '#ffffff' : '#282c34',
		backgroundGradientStart: isLight ? '#f8f9fa' : '#2c313a',
		backgroundGradientEnd: isLight ? '#ffffff' : '#282c34',
		border: isLight ? '#e1e4e8' : '#3e4451',
		foreground: isLight ? '#383a42' : '#abb2bf',
		foregroundMuted: isLight ? '#6a737d' : '#5c6370',
		accent: isLight ? '#4078f2' : '#61afef',
	};
}

export function treePreviewLines(plain: string, maxLines = STATIC_TREE_PREVIEW_LINES): { text: string; hiddenLines: number } {
	if (!plain) {
		return { text: '', hiddenLines: 0 };
	}
	const lines = plain.split('\n');
	if (lines.length <= maxLines) {
		return { text: plain, hiddenLines: 0 };
	}
	return { text: lines.slice(0, maxLines).join('\n'), hiddenLines: lines.length - maxLines };
}

function ansiForTheme(isLight: boolean): typeof DARK_ANSI {
	return isLight ? LIGHT_ANSI : DARK_ANSI;
}

export function colorizeSummary(summary: string, isLight: boolean): string {
	if (!summary) {
		return '';
	}
	const ANSI = ansiForTheme(isLight);
	let result = summary;
	result = result.replace(/^(.*══+.*)$/gm, `${ANSI.cyan}$1${ANSI.reset}`);
	result = result.replace(/^(📁|📊|📂|💾|📏|🔢|📈|📋|📦|🕐|🔍|⚠️)(.*)$/gm, `${ANSI.yellow}$1${ANSI.reset}${ANSI.white}$2${ANSI.reset}`);
	result = result.replace(/(Path: )(.+)$/gm, `$1${ANSI.blue}$2${ANSI.reset}`);
	result = result.replace(/(\d+)(?= files| folders| directories| B| KB| MB| GB|%|\))/g, `${ANSI.green}$1${ANSI.reset}`);
	result = result.replace(/(\.\w+):/g, `${ANSI.cyan}$1${ANSI.reset}:`);
	result = result.replace(/(█+)/g, `${ANSI.green}$1${ANSI.reset}`);
	result = result.replace(/(\(\d+\.\d+%\))/g, `${ANSI.dim}$1${ANSI.reset}`);
	return result;
}

export function colorizeTreeStructure(content: string, isLight: boolean): string {
	if (!content) {
		return '';
	}
	const ANSI = ansiForTheme(isLight);
	if (content.includes('├──') || content.includes('└──')) {
		return content.split('\n').map(line => {
			let colored = line.replace(/(│|├|└|──|─)/g, `${ANSI.gray}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+)\/$/, `${ANSI.blue}${ANSI.bold}$1/${ANSI.reset}`);
			colored = colored.replace(/(\S+\.tsx?)(?=\s|$|\()/g, `${ANSI.cyan}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.jsx?)(?=\s|$|\()/g, `${ANSI.yellow}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.py)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.rs)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.json)(?=\s|$|\()/g, `${ANSI.green}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.md)(?=\s|$|\()/g, `${ANSI.white}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.css|\.scss|\.sass)(?=\s|$|\()/g, `${ANSI.magenta}$1${ANSI.reset}`);
			colored = colored.replace(/(\S+\.html?)(?=\s|$|\()/g, `${ANSI.red}$1${ANSI.reset}`);
			colored = colored.replace(/(\([^)]+\))$/g, `${ANSI.dim}$1${ANSI.reset}`);
			colored = colored.replace(/\[M\]/g, `${ANSI.yellow}[M]${ANSI.reset}`);
			colored = colored.replace(/\[A\]/g, `${ANSI.green}[A]${ANSI.reset}`);
			colored = colored.replace(/\[D\]/g, `${ANSI.red}[D]${ANSI.reset}`);
			colored = colored.replace(/\[\?\]/g, `${ANSI.gray}[?]${ANSI.reset}`);
			return colored;
		}).join('\n');
	}
	return repoMapToTreeColorized(content).colorized;
}

export function repoMapToTreeColorized(repoMapContent: string): { plain: string; colorized: string } {
	if (!repoMapContent || !repoMapContent.trim()) {
		return { plain: '', colorized: '' };
	}
	const lines = repoMapContent.split('\n').filter(line => {
		const trimmed = line.trim();
		return trimmed &&
			!trimmed.startsWith('Below is a repository map') &&
			!trimmed.startsWith('For each file') &&
			!trimmed.startsWith('this map contains');
	});
	if (!lines.length) {
		return { plain: '', colorized: '' };
	}
	if (lines.some(line => line.includes('├──') || line.includes('└──'))) {
		return { plain: lines.join('\n'), colorized: colorizeTreeStructure(lines.join('\n'), false) };
	}
	interface TreeNode { name: string; children: Map<string, TreeNode>; isFile: boolean }
	const root: TreeNode = { name: '', children: new Map(), isFile: false };
	for (const line of lines) {
		const parts = line.trim().split('/').filter(Boolean);
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isFile = i === parts.length - 1;
			if (!current.children.has(part)) {
				current.children.set(part, { name: part, children: new Map(), isFile });
			}
			current = current.children.get(part)!;
		}
	}
	const COLORS = {
		reset: '\x1b[0m',
		directory: '\x1b[38;2;97;175;239m',
		connector: '\x1b[38;2;92;99;112m',
	};
	function treeToString(node: TreeNode, prefix = '', isLast = true, isRoot = false): { plain: string[]; colorized: string[] } {
		const plainResult: string[] = [];
		const colorizedResult: string[] = [];
		if (node.name && !isRoot) {
			const connector = isLast ? '└── ' : '├── ';
			const coloredConnector = `${COLORS.connector}${connector}${COLORS.reset}`;
			if (node.isFile) {
				const fileColor = repoMapFileAnsiColor(node.name);
				plainResult.push(prefix + connector + node.name);
				colorizedResult.push(prefix.replace(/[│├└─]/g, m => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${fileColor}${node.name}${COLORS.reset}`);
			} else {
				plainResult.push(prefix + connector + node.name + '/');
				colorizedResult.push(prefix.replace(/[│├└─]/g, m => `${COLORS.connector}${m}${COLORS.reset}`) + coloredConnector + `${COLORS.directory}${node.name}/${COLORS.reset}`);
			}
		}
		const children = Array.from(node.children.values()).sort((a, b) => {
			if (a.isFile !== b.isFile) {
				return a.isFile ? 1 : -1;
			}
			return a.name.localeCompare(b.name);
		});
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const newPrefix = isRoot ? prefix : prefix + (isLast ? '    ' : '│   ');
			const childResult = treeToString(child, newPrefix, i === children.length - 1, false);
			plainResult.push(...childResult.plain);
			colorizedResult.push(...childResult.colorized);
		}
		return { plain: plainResult, colorized: colorizedResult };
	}
	const result = treeToString(root, '', true, true);
	return { plain: result.plain.join('\n'), colorized: result.colorized.join('\n') };
}

/** One Dark Pro file colors from `repoMapToTree`. */
export function repoMapFileAnsiColor(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	const name = filename.toLowerCase();
	if (name.includes('config') || name.includes('rc') || name === 'package.json' ||
		name === 'tsconfig.json' || name === '.gitignore' || name === '.env') {
		return '\x1b[38;2;92;99;112m';
	}
	switch (ext) {
		case 'ts':
		case 'tsx':
			return '\x1b[38;2;86;182;194m';
		case 'js':
		case 'jsx':
		case 'mjs':
		case 'cjs':
			return '\x1b[38;2;229;192;123m';
		case 'json':
			return '\x1b[38;2;152;195;121m';
		case 'md':
		case 'mdx':
			return '\x1b[38;2;171;178;191m';
		case 'css':
		case 'scss':
		case 'sass':
		case 'less':
			return '\x1b[38;2;198;120;221m';
		case 'html':
		case 'htm':
			return '\x1b[38;2;224;108;117m';
		case 'rs':
		case 'toml':
			return '\x1b[38;2;224;108;117m';
		case 'py':
		case 'pyi':
			return '\x1b[38;2;152;195;121m';
		default:
			return '\x1b[38;2;171;178;191m';
	}
}

export function parseAnsiSpans(text: string, palette: IKnoxGuiAnsiPalette): IKnoxGuiAnsiSpan[] {
	if (!text) {
		return [];
	}
	if (!text.includes('\x1b[')) {
		return [{ text }];
	}
	const ansiRegex = /\x1b\[([0-9;]*)m/g;
	const parts: IKnoxGuiAnsiSpan[] = [];
	let lastIndex = 0;
	let currentColor: string | undefined;
	let bold = false;
	let dim = false;
	const colorMap: Record<number, string> = {
		30: palette.black, 31: palette.red, 32: palette.green, 33: palette.yellow,
		34: palette.blue, 35: palette.magenta, 36: palette.cyan, 37: palette.white,
		90: palette.brightBlack, 91: palette.brightRed, 92: palette.brightGreen, 93: palette.brightYellow,
		94: palette.brightBlue, 95: palette.brightMagenta, 96: palette.brightCyan, 97: palette.brightWhite,
	};
	let match: RegExpExecArray | null;
	while ((match = ansiRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			const segment = text.slice(lastIndex, match.index);
			if (segment) {
				parts.push({ text: segment, color: currentColor, bold: bold || undefined, dim: dim || undefined });
			}
		}
		const codes = match[1].split(';').map(Number);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
			if (code === 0) {
				currentColor = undefined;
				bold = false;
				dim = false;
			} else if (code === 1) {
				bold = true;
			} else if (code === 2) {
				dim = true;
			} else if (code === 22) {
				bold = false;
				dim = false;
			} else if (code === 39) {
				currentColor = undefined;
			} else if (colorMap[code]) {
				currentColor = colorMap[code];
			} else if (code === 38 && codes[i + 1] === 2 && i + 4 < codes.length) {
				currentColor = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
				i += 4;
			}
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		parts.push({ text: text.slice(lastIndex), color: currentColor, bold: bold || undefined, dim: dim || undefined });
	}
	return parts.length ? parts : [{ text }];
}

export function subdirectoryOutputParts(items: IKnoxGuiToolOutputItem[]): { summary: string; structure: string; notice: string; raw: string } {
	const summary = items.find(item => item.name?.includes('Summary') || item.description?.includes('Analysis'))?.content || '';
	const structure = items.find(item => item.name?.includes('Structure') || item.description?.includes('Structure'))?.content || '';
	const notice = items.find(item => item.name?.includes('Notice'))?.content || '';
	const hasEnhanced = summary.includes('Directory Analysis Summary') || structure.includes('├──') || structure.includes('└──');
	const raw = hasEnhanced
		? structure
		: items.find(item => item.description?.includes('directory') || item.name?.includes('directory') || item.description?.includes('Structure'))?.content || '';
	return { summary, structure, notice, raw };
}

export function repoMapOutput(items: IKnoxGuiToolOutputItem[]): string {
	return items.find(item =>
		item.description?.includes('repo') ||
		item.name?.includes('repo') ||
		item.description?.includes('structure'))?.content || items[0]?.content || '';
}

export function searchOutput(items: IKnoxGuiToolOutputItem[]): string {
	return items.find(item =>
		item.description?.includes('search') ||
		item.name?.includes('search') ||
		item.name?.includes('Search'))?.content || items[0]?.content || '';
}

export function treeStatsFromPlain(plain: string, summary?: string): { files: number; folders: number; total: number; size?: string } {
	if (summary) {
		const fileMatch = summary.match(/Total Files:\s*(\d+)/);
		const dirMatch = summary.match(/Total Directories:\s*(\d+)/);
		const sizeMatch = summary.match(/Total Size:\s*([\d.]+\s*[BKMG]B?)/);
		if (fileMatch || dirMatch) {
			const files = fileMatch ? parseInt(fileMatch[1], 10) : 0;
			const folders = dirMatch ? parseInt(dirMatch[1], 10) : 0;
			return { files, folders, total: files + folders, size: sizeMatch ? sizeMatch[1] : undefined };
		}
	}
	const lines = plain.split('\n').filter(line => line.trim());
	const folders = lines.filter(line => line.endsWith('/')).length;
	const files = Math.max(0, lines.length - folders);
	return { files, folders, total: lines.length };
}

export function subdirectoryFilterBadges(args: Record<string, unknown>): string[] {
	const badges: string[] = [];
	const fileTypes = Array.isArray(args.fileTypes) ? args.fileTypes.map(String) : [];
	if (fileTypes.length) {
		badges.push(fileTypes.join(', '));
	}
	if (typeof args.pattern === 'string' && args.pattern) {
		badges.push(args.pattern);
	}
	if (typeof args.depth === 'number' && args.depth !== -1) {
		badges.push(`depth: ${args.depth}`);
	}
	if (args.includeStats) {
		badges.push('stats');
	}
	if (args.includeGitStatus) {
		badges.push('git');
	}
	return badges;
}

export function getMarkdownLanguageTagForFile(filepath: string): string {
	const extToLangMap: Record<string, string> = {
		py: 'python', js: 'javascript', jsx: 'jsx', tsx: 'tsx', ts: 'typescript',
		java: 'java', class: 'java', go: 'go', rb: 'ruby', rs: 'rust', c: 'c',
		cpp: 'cpp', cs: 'csharp', php: 'php', scala: 'scala', swift: 'swift',
		kt: 'kotlin', md: 'markdown', json: 'json', html: 'html', css: 'css',
		sh: 'shell', yaml: 'yaml', toml: 'toml', tex: 'latex', sql: 'sql', ps1: 'powershell',
	};
	const raw = filepath.split('.').pop();
	const match = raw?.match(/^(\S+)\s*(?:\(.*\))?$/);
	const ext = match?.[1]?.toLowerCase();
	return ext ? (extToLangMap[ext] ?? ext) : '';
}

export function displayLanguageForFile(filepath: string, contentKey?: string): string {
	if (contentKey === 'patch' || contentKey === 'diff') {
		return 'diff';
	}
	if (!filepath) {
		return '';
	}
	const lang = getMarkdownLanguageTagForFile(filepath);
	if (lang === 'markdown') {
		return 'text';
	}
	return lang;
}

export function createLatestValueCoalescer<K, V>(
	emit: (key: K, value: V) => void,
	options?: { waitMs?: number; schedule?: (fn: () => void, ms: number) => () => void },
): { enqueue: (key: K, value: V) => void; flush: () => void; dispose: () => void } {
	const waitMs = options?.waitMs ?? TOOL_PARTIAL_OUTPUT_COALESCE_MS;
	const schedule = options?.schedule ?? ((fn: () => void, ms: number) => {
		const timer = setTimeout(fn, ms);
		return () => clearTimeout(timer);
	});
	const pending = new Map<K, V>();
	let cancel: (() => void) | null = null;
	const flush = () => {
		cancel?.();
		cancel = null;
		for (const [key, value] of pending) {
			emit(key, value);
		}
		pending.clear();
	};
	return {
		enqueue(key: K, value: V) {
			pending.set(key, value);
			if (!cancel) {
				cancel = schedule(flush, waitMs);
			}
		},
		flush,
		dispose() {
			cancel?.();
			cancel = null;
			pending.clear();
		},
	};
}
