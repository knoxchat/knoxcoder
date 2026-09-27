/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseToolArgs } from './knoxGuiChat.js';
import {
	IKnoxGuiAutonomous,
	IKnoxGuiBackgroundJob,
	IKnoxGuiCompaction,
	IKnoxGuiGitDiffFile,
	IKnoxGuiHistoryItem,
	IKnoxGuiInjectedMemory,
	IKnoxGuiState,
	IKnoxGuiTaskPlan,
	IKnoxGuiTaskPlanStep,
	IKnoxGuiToolCall,
	KnoxGitFileStatus,
	KnoxTaskPlanStepStatus,
} from './knoxGuiState.js';
import { classifyAgentActivityKind, toolStepDetail } from './knoxGuiTranscript.js';

const CYAN = '#159994';
export const KNOX_GUI_PANEL_CYAN = CYAN;
export const TASK_EXECUTION_PLAN_MARKER = 'Task Execution Plan';
export const PLAN_CLEARED_TEXT = 'Task Execution Plan cleared.';
const PLAN_OUTPUT_DESCRIPTIONS = new Set(['created', 'updated', 'listed', 'cleared', 'empty', 'error']);
const PATH_HINT_RE = /[A-Za-z0-9_./+-]+\.[A-Za-z][A-Za-z0-9]{0,7}/g;
const MATCH_THRESHOLD = 8;
const TASK_ID_PREFIX = 'task:';
const SELECTIVE_COLLAPSE_BELOW = 0.7;
const WRITE_TOOLS = new Set([
	'builtin_edit_file', 'builtin_write_file', 'builtin_apply_patch', 'builtin_create_new_file',
	'edit_file', 'write_file', 'apply_patch', 'create_new_file', 'composite_smart_edit',
]);
const SHELL_TOOLS = new Set([
	'builtin_run_terminal_command', 'builtin_await_shell', 'builtin_pty_start', 'builtin_build', 'builtin_qemu',
	'run_terminal_command', 'await_shell', 'pty_start', 'build', 'qemu',
]);
const TEST_TOOLS = new Set(['builtin_generate_tests', 'generate_tests']);
const READ_TOOLS = new Set([
	'builtin_read_file', 'builtin_read_currently_open_file', 'builtin_view_subdirectory', 'builtin_glob',
	'builtin_exact_search', 'builtin_enhanced_search',
	'read_file', 'read_currently_open_file', 'view_subdirectory', 'glob', 'exact_search', 'enhanced_search',
]);
const FILE_TYPE_MAP: Record<string, string> = {
	ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', py: 'PY', rs: 'RS', go: 'GO', java: 'JAVA',
	css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', md: 'MD', yaml: 'YAML', yml: 'YAML',
	toml: 'TOML', sql: 'SQL', sh: 'SH', bash: 'SH', vue: 'VUE', svelte: 'SVEL',
	node: 'BIN', wasm: 'BIN', so: 'BIN', dll: 'BIN', exe: 'BIN',
};
const FILE_TYPE_COLORS: Record<string, string> = {
	TS: '#3178c6', TSX: '#3178c6', JS: '#f7df1e', JSX: '#f7df1e', PY: '#3776ab', RS: '#dea584',
	GO: '#00add8', MOD: '#00add8', SUM: '#00add8', ENV: '#6e6e77', GIT: '#6e6e77', FILE: '#6e6e77',
	CSS: '#264de4', SCSS: '#cc6699', HTML: '#e34c26', JSON: '#cbcb41', MD: '#083fa1', YAML: '#cb171e',
	SQL: '#e38c00', VUE: '#42b883', SVEL: '#ff3e00', BIN: '#6e6e77',
};

export type KnoxGitChangedFile = {
	filepath: string;
	uri?: string;
	status?: KnoxGitFileStatus;
	additions?: number;
	deletions?: number;
	isBinary?: boolean;
};

type StepIntent = 'write' | 'shell' | 'test' | 'read' | 'any';

type ToolEvent = {
	kind: ReturnType<typeof classifyAgentActivityKind>;
	toolName: string;
	path?: string;
	command?: string;
	running: boolean;
	failed: boolean;
	activity?: string;
};

export function gitFileType(filename: string): string {
	const base = filename.split('/').pop() || filename;
	if (base === 'go.mod') {
		return 'MOD';
	}
	if (base === 'go.sum') {
		return 'SUM';
	}
	if (base.startsWith('.env')) {
		return 'ENV';
	}
	if (base === '.gitignore' || base === '.gitattributes') {
		return 'GIT';
	}
	const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() || '' : '';
	if (FILE_TYPE_MAP[ext]) {
		return FILE_TYPE_MAP[ext];
	}
	if (!ext) {
		return 'FILE';
	}
	return ext.slice(0, 4).toUpperCase();
}

export function gitFileTypeColor(fileType: string): string {
	return FILE_TYPE_COLORS[fileType] || '#6e6e77';
}

export function gitFileTypeIsConfig(fileType: string): boolean {
	return ['JSON', 'YAML', 'TOML', 'ENV'].includes(fileType);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function parseDiffStats(diffString: string): IKnoxGuiGitDiffFile | undefined {
	const headerMatch = diffString.match(/^diff --git a\/(.*?) b\/(.*)/m);
	if (!headerMatch) {
		return undefined;
	}
	const filepath = normalizePath(headerMatch[2]);
	const filename = filepath.split('/').pop() || filepath;
	const isBinary = /Binary files/.test(diffString);
	let additions = 0;
	let deletions = 0;
	if (!isBinary) {
		let inHunk = false;
		for (const line of diffString.split('\n')) {
			if (line.startsWith('@@')) {
				inHunk = true;
				continue;
			}
			if (!inHunk) {
				continue;
			}
			if (line.startsWith('+') && !line.startsWith('+++')) {
				additions++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				deletions++;
			}
		}
	}
	return {
		filename,
		filepath,
		displayPath: filepath,
		uri: filepath,
		additions,
		deletions,
		fileType: gitFileType(filename),
		isBinary,
		status: additions > 0 && deletions === 0 ? 'added' : 'modified',
	};
}

export function mergeDiffEntry(map: Map<string, IKnoxGuiGitDiffFile>, parsed: IKnoxGuiGitDiffFile): void {
	const existing = map.get(parsed.filepath);
	if (!existing) {
		map.set(parsed.filepath, parsed);
		return;
	}
	map.set(parsed.filepath, {
		...existing,
		additions: existing.additions + parsed.additions,
		deletions: existing.deletions + parsed.deletions,
		isBinary: existing.isBinary || parsed.isBinary,
	});
}

export function buildGitDisplayPaths(files: IKnoxGuiGitDiffFile[]): IKnoxGuiGitDiffFile[] {
	const basenameCounts = new Map<string, number>();
	for (const file of files) {
		basenameCounts.set(file.filename, (basenameCounts.get(file.filename) ?? 0) + 1);
	}
	return files.map(file => {
		if ((basenameCounts.get(file.filename) ?? 0) <= 1) {
			return { ...file, displayPath: file.filepath };
		}
		const parts = file.filepath.split('/');
		if (parts.length >= 2) {
			return { ...file, displayPath: parts.slice(-2).join('/') };
		}
		return file;
	});
}

export function sortGitDiffFiles(files: IKnoxGuiGitDiffFile[]): IKnoxGuiGitDiffFile[] {
	return [...files].sort((a, b) => {
		const aDelta = a.additions + a.deletions;
		const bDelta = b.additions + b.deletions;
		if (bDelta !== aDelta) {
			return bDelta - aDelta;
		}
		return a.filepath.localeCompare(b.filepath);
	});
}

export function gitFilesFromChangedList(changed: KnoxGitChangedFile[]): IKnoxGuiGitDiffFile[] {
	return changed.map(changedFile => {
		const filepath = normalizePath(changedFile.filepath);
		const filename = filepath.split('/').pop() || filepath;
		const fileType = gitFileType(filename);
		const additions = changedFile.additions ?? 0;
		const deletions = changedFile.deletions ?? 0;
		return {
			filename,
			filepath,
			displayPath: filepath,
			uri: changedFile.uri || filepath,
			additions,
			deletions,
			fileType,
			isBinary: changedFile.isBinary ?? (fileType === 'BIN' && additions === 0 && deletions === 0),
			status: changedFile.status ?? 'modified',
		};
	});
}

export function gitFilesFromDiffs(diffs: string[]): IKnoxGuiGitDiffFile[] {
	const map = new Map<string, IKnoxGuiGitDiffFile>();
	for (const diff of diffs) {
		const parsed = parseDiffStats(diff);
		if (parsed) {
			mergeDiffEntry(map, parsed);
		}
	}
	return Array.from(map.values());
}

function gitPathsMatch(left: string, right: string): boolean {
	const a = normalizePath(left);
	const b = normalizePath(right);
	return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** Fill missing +/- stats from `getDiff` when `getGitChangedFiles` omitted them. */
export function mergeGitChangedWithDiffs(files: IKnoxGuiGitDiffFile[], diffs: IKnoxGuiGitDiffFile[]): IKnoxGuiGitDiffFile[] {
	if (!files.length) {
		return diffs;
	}
	return files.map(file => {
		if (file.additions > 0 || file.deletions > 0 || file.isBinary) {
			return file;
		}
		const match = diffs.find(diff => gitPathsMatch(file.filepath, diff.filepath));
		if (!match) {
			return file;
		}
		return {
			...file,
			additions: match.additions,
			deletions: match.deletions,
			isBinary: file.isBinary || match.isBinary,
		};
	});
}

export function finalizeGitDiffFiles(files: IKnoxGuiGitDiffFile[]): IKnoxGuiGitDiffFile[] {
	return sortGitDiffFiles(buildGitDisplayPaths(files));
}

export function gitDiffTotals(files: IKnoxGuiGitDiffFile[]): { additions: number; deletions: number } {
	return files.reduce((sum, file) => {
		sum.additions += file.additions;
		sum.deletions += file.deletions;
		return sum;
	}, { additions: 0, deletions: 0 });
}

export function isCompactionBannerVisible(compaction: IKnoxGuiCompaction | undefined): compaction is IKnoxGuiCompaction {
	return Boolean(
		compaction &&
		(compaction.tokensSaved > 0 || compaction.originalMessageCount > compaction.compactedMessageCount),
	);
}

export function compactionMethodKey(method: IKnoxGuiCompaction['summarizationMethod']): string {
	if (method === 'llm') {
		return 'compactionMethodLlm';
	}
	if (method === 'heuristic') {
		return 'compactionMethodHeuristic';
	}
	return 'compactionMethodNone';
}

export function parseCompactionPayload(rec: Record<string, unknown> | undefined): IKnoxGuiCompaction | undefined {
	if (!rec) {
		return undefined;
	}
	const tokensSaved = Number(rec.tokensSaved ?? 0);
	const originalMessageCount = Number(rec.originalMessageCount ?? 0);
	const compactedMessageCount = Number(rec.compactedMessageCount ?? 0);
	if (tokensSaved <= 0 && originalMessageCount <= compactedMessageCount) {
		return undefined;
	}
	const method = rec.summarizationMethod;
	return {
		tokensSaved,
		originalMessageCount,
		compactedMessageCount,
		summarized: Boolean(rec.summarized),
		deduplicated: Boolean(rec.deduplicated),
		summarizationMethod: method === 'llm' || method === 'heuristic' || method === 'none' ? method : undefined,
		summaryText: rec.summaryText ? String(rec.summaryText) : undefined,
	};
}

function isPlanToolName(name: string | undefined): boolean {
	if (!name) {
		return false;
	}
	const n = name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	return n === 'plan' || n === 'todo';
}

function isTaskPlanContextItem(item: { name?: string; content?: string; description?: string }): boolean {
	if (item.content?.includes(TASK_EXECUTION_PLAN_MARKER)) {
		return true;
	}
	if (item.content?.includes(PLAN_CLEARED_TEXT)) {
		return true;
	}
	return item.name === 'Plan' && PLAN_OUTPUT_DESCRIPTIONS.has(item.description ?? '');
}

/** GUI ToolOutput filters task-plan items except parse errors. */
export function isVisibleTaskPlanPeekItem(item: { name?: string; content?: string; description?: string }): boolean {
	if (!isTaskPlanContextItem(item)) {
		return true;
	}
	return item.description === 'error';
}

export function visibleToolOutputPeekItems<T extends { name?: string; content?: string; description?: string }>(items: T[]): T[] {
	return items.filter(isVisibleTaskPlanPeekItem);
}

function isClearedPlanContent(item: { content?: string; description?: string }): boolean {
	return item.description === 'cleared' || Boolean(item.content?.includes(PLAN_CLEARED_TEXT));
}

function markToStatus(mark: string): KnoxTaskPlanStepStatus {
	if (mark === 'x' || mark === 'X') {
		return 'done';
	}
	if (mark === '*') {
		return 'in_progress';
	}
	if (mark === '-') {
		return 'skipped';
	}
	return 'pending';
}

export function parsePlanText(text: string): { title: string; steps: IKnoxGuiTaskPlanStep[]; updatedAt: number } | undefined {
	if (!text.includes(TASK_EXECUTION_PLAN_MARKER)) {
		return undefined;
	}
	let title = 'Task plan';
	const steps: IKnoxGuiTaskPlanStep[] = [];
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

export function formatPlanText(plan: { title: string; steps: IKnoxGuiTaskPlanStep[] }): string {
	const marks: Record<KnoxTaskPlanStepStatus, string> = {
		pending: ' ',
		in_progress: '*',
		done: 'x',
		skipped: '-',
	};
	const remaining = plan.steps.filter(step => step.status === 'pending' || step.status === 'in_progress').length;
	const lines = [`## ${TASK_EXECUTION_PLAN_MARKER}`, '[pinned]', `Title: ${plan.title}`];
	if (!plan.steps.length) {
		lines.push('(no steps yet)');
	} else {
		plan.steps.forEach((step, index) => {
			lines.push(`${index + 1}. [${marks[step.status]}] ${step.title} (${step.id})`);
		});
	}
	lines.push(`${remaining} remaining / ${plan.steps.length} total`);
	return lines.join('\n');
}

function historyItemPlanSources(item: IKnoxGuiHistoryItem): Array<{ name?: string; content?: string; description?: string }> {
	const sources: Array<{ name?: string; content?: string; description?: string }> = [];
	for (const call of item.toolCalls ?? []) {
		for (const output of call.outputItems ?? []) {
			sources.push(output);
		}
		if (call.output) {
			sources.push({ name: isPlanToolName(call.name) ? 'Plan' : undefined, content: call.output });
		}
	}
	if (item.content) {
		sources.push({ content: item.content });
	}
	return sources;
}

export function collectLatestTaskPlanSnapshot(history: IKnoxGuiHistoryItem[]): { plan: { title: string; steps: IKnoxGuiTaskPlanStep[]; updatedAt: number }; historyIndex: number } | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		for (const ctx of historyItemPlanSources(item)) {
			if (!isTaskPlanContextItem(ctx)) {
				continue;
			}
			if (isClearedPlanContent(ctx)) {
				return undefined;
			}
			const parsed = ctx.content ? parsePlanText(ctx.content) : undefined;
			if (parsed) {
				return { plan: parsed, historyIndex: i };
			}
		}
		if (item.content.includes(PLAN_CLEARED_TEXT)) {
			return undefined;
		}
		const parsed = parsePlanText(item.content);
		if (parsed) {
			return { plan: parsed, historyIndex: i };
		}
	}
	return undefined;
}

export function isTaskPlanUpdating(history: IKnoxGuiHistoryItem[]): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const calls = history[i].toolCalls ?? [];
		for (let j = calls.length - 1; j >= 0; j--) {
			if (!isPlanToolName(calls[j].name)) {
				continue;
			}
			const status = calls[j].status;
			return status === 'generating' || status === 'generated' || status === 'calling';
		}
	}
	return false;
}

export function taskPlanFingerprint(plan: { title: string; steps: Array<{ id: string; status: string }> }): string {
	return `${plan.title}|${plan.steps.map(step => `${step.id}:${step.status}`).join(',')}`;
}

export function extractPathHints(title: string): string[] {
	const matches = title.match(PATH_HINT_RE) ?? [];
	return matches.filter(hint => !/^\d/.test(hint) && !/alpha|beta|rc\d/i.test(hint));
}

export function stepIntent(title: string): StepIntent {
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
	if (extractPathHints(title).length > 0 || /\b(create|write|add|edit|patch|implement|fix)\b/i.test(title)) {
		return 'write';
	}
	if (/\b(read|explore|inspect|look|parse)\b/i.test(title)) {
		return 'read';
	}
	return 'any';
}

function basename(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || path;
}

function eventFitsIntent(intent: StepIntent, event: ToolEvent): boolean {
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

export function scoreStepEvent(step: IKnoxGuiTaskPlanStep, event: ToolEvent): number {
	if (!eventFitsIntent(stepIntent(step.title), event)) {
		return 0;
	}
	let score = 0;
	const title = step.title.toLowerCase();
	const path = event.path ? normalizePath(event.path).toLowerCase() : '';
	const base = path ? basename(path) : '';
	for (const hint of extractPathHints(step.title)) {
		const normalized = normalizePath(hint).toLowerCase();
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
		if ((/\btest\b/i.test(step.title) || stepIntent(step.title) === 'test') && (/\btest\b/.test(command) || event.kind === 'test')) {
			score += 10;
		}
	} else if (event.kind === 'test' && stepIntent(step.title) === 'test') {
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

function isFailedToolOutput(call: IKnoxGuiToolCall): boolean {
	if (call.status === 'canceled' || call.status === 'errored') {
		return true;
	}
	for (const item of call.outputItems ?? []) {
		if (item.name === 'Tool Call Error' || /failed/i.test(item.description ?? '') || /failed/i.test(item.content)) {
			return true;
		}
	}
	return Boolean(call.output && /Tool call ".+" failed/.test(call.output));
}

function eventFromTool(call: IKnoxGuiToolCall): ToolEvent | undefined {
	if (isPlanToolName(call.name)) {
		return undefined;
	}
	const args = call.parsedArgs ?? parseToolArgs(call.arguments);
	const path = argString(args, ['filepath', 'path', 'file_path', 'target_file', 'filename'])
		?? (typeof args.patch === 'string' ? patchPath(args.patch) : undefined);
	const command = argString(args, ['command']);
	const failed = isFailedToolOutput(call);
	const running = !failed && (call.status === 'generating' || call.status === 'generated' || call.status === 'calling');
	return {
		kind: classifyAgentActivityKind(call.name, args),
		toolName: call.name,
		path,
		command,
		running,
		failed,
		activity: toolStepDetail(call.name, args),
	};
}

function collectEventsAfter(history: IKnoxGuiHistoryItem[], afterIndex: number): ToolEvent[] {
	const events: ToolEvent[] = [];
	for (let i = afterIndex + 1; i < history.length; i++) {
		for (const call of history[i].toolCalls ?? []) {
			const event = eventFromTool(call);
			if (event) {
				events.push(event);
			}
		}
	}
	return events;
}

function applyEvent(steps: IKnoxGuiTaskPlanStep[], event: ToolEvent): void {
	let best: IKnoxGuiTaskPlanStep | undefined;
	let bestScore = 0;
	for (const step of steps) {
		if (step.status === 'skipped') {
			continue;
		}
		const score = scoreStepEvent(step, event);
		if (score > bestScore) {
			bestScore = score;
			best = step;
		}
	}
	const match = bestScore >= MATCH_THRESHOLD ? best : undefined;
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
	const next: KnoxTaskPlanStepStatus = event.running ? 'in_progress' : 'done';
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

export function applyLivePlanProgress(
	plan: { title: string; steps: IKnoxGuiTaskPlanStep[]; updatedAt?: number },
	history: IKnoxGuiHistoryItem[],
	snapshotIndex: number,
): IKnoxGuiTaskPlan {
	const steps: IKnoxGuiTaskPlanStep[] = plan.steps.map(step => ({ ...step }));
	for (const event of collectEventsAfter(history, snapshotIndex)) {
		applyEvent(steps, event);
	}
	const remaining = steps.filter(step => step.status === 'pending' || step.status === 'in_progress').length;
	const doneCount = steps.filter(step => step.status === 'done').length;
	return {
		title: plan.title,
		steps,
		remaining,
		doneCount,
		current: steps.find(step => step.status === 'in_progress'),
		updating: isTaskPlanUpdating(history) || steps.some(step => step.status === 'in_progress'),
		fingerprint: taskPlanFingerprint(plan),
	};
}

export function collectLiveTaskPlan(history: IKnoxGuiHistoryItem[]): IKnoxGuiTaskPlan | undefined {
	const snapshot = collectLatestTaskPlanSnapshot(history);
	if (!snapshot) {
		return undefined;
	}
	return applyLivePlanProgress(snapshot.plan, history, snapshot.historyIndex);
}

export function taskPlanFillPercent(plan: IKnoxGuiTaskPlan): number {
	if (plan.steps.length === 0) {
		return 0;
	}
	const currentBoost = plan.current ? 0.4 : 0;
	return Math.min(100, ((plan.doneCount + currentBoost) / plan.steps.length) * 100);
}

export function taskPlanStatusLabelKey(status: KnoxTaskPlanStepStatus): string {
	if (status === 'in_progress') {
		return 'taskPlanStatusActive';
	}
	if (status === 'done') {
		return 'taskPlanStatusDone';
	}
	if (status === 'skipped') {
		return 'taskPlanStatusSkipped';
	}
	return 'taskPlanStatusPending';
}

export function isTaskJobId(id: string): boolean {
	return id.startsWith(TASK_ID_PREFIX);
}

export function truncateJobTitle(title: string, max = 72): string {
	const trimmed = title.trim().replace(/\s+/g, ' ');
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}…`;
}

export function countRunningJobs(jobs: IKnoxGuiBackgroundJob[]): number {
	return jobs.filter(job => job.status === 'running').length;
}

export function countFailedJobs(jobs: IKnoxGuiBackgroundJob[]): number {
	return jobs.filter(job => job.status === 'exited' && typeof job.exitCode === 'number' && job.exitCode !== 0).length;
}

export function sortBackgroundJobs(jobs: IKnoxGuiBackgroundJob[]): IKnoxGuiBackgroundJob[] {
	return [...jobs].sort((a, b) => {
		const aRun = a.status === 'running' ? 0 : 1;
		const bRun = b.status === 'running' ? 0 : 1;
		if (aRun !== bRun) {
			return aRun - bRun;
		}
		return (b.startedAt ?? 0) - (a.startedAt ?? 0);
	});
}

export function mergeBackgroundJobs(shellJobs: IKnoxGuiBackgroundJob[], taskJobs: IKnoxGuiBackgroundJob[]): IKnoxGuiBackgroundJob[] {
	const byId = new Map<string, IKnoxGuiBackgroundJob>();
	for (const job of shellJobs) {
		byId.set(job.id, job);
	}
	for (const job of taskJobs) {
		if (!byId.has(job.id)) {
			byId.set(job.id, job);
		}
	}
	return sortBackgroundJobs([...byId.values()]);
}

export function collectRunningTaskJobs(history: IKnoxGuiHistoryItem[]): IKnoxGuiBackgroundJob[] {
	const jobs: IKnoxGuiBackgroundJob[] = [];
	for (const item of history) {
		for (const call of item.toolCalls ?? []) {
			const n = call.name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
			if (n !== 'task') {
				continue;
			}
			if (call.status !== 'calling' && call.status !== 'generated' && call.status !== 'generating') {
				continue;
			}
			const args = call.parsedArgs ?? parseToolArgs(call.arguments);
			const prompt = typeof args.prompt === 'string' ? args.prompt : '';
			const profile = typeof args.profile === 'string' ? args.profile : 'explore';
			jobs.push({
				id: `${TASK_ID_PREFIX}${call.id}`,
				kind: 'task',
				title: prompt || profile,
				status: 'running',
				detail: profile,
			});
		}
	}
	return jobs;
}

export function visibleBackgroundJobs(state: Pick<IKnoxGuiState, 'backgroundJobs' | 'history'>): IKnoxGuiBackgroundJob[] {
	return mergeBackgroundJobs(state.backgroundJobs, collectRunningTaskJobs(state.history));
}

export function parseBackgroundJobs(value: unknown): IKnoxGuiBackgroundJob[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map(item => parseBackgroundJob(item)).filter((job): job is IKnoxGuiBackgroundJob => Boolean(job));
}

export function parseBackgroundJob(value: unknown): IKnoxGuiBackgroundJob | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const rec = value as Record<string, unknown>;
	const id = rec.id ?? rec.jobId;
	if (id == null) {
		return undefined;
	}
	const status = rec.status;
	return {
		id: String(id),
		kind: rec.kind === 'task' ? 'task' : 'shell',
		title: String(rec.title ?? rec.command ?? 'Job'),
		status: status === 'exited' || status === 'killed' || status === 'failed' ? status : 'running',
		startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : undefined,
		endedAt: typeof rec.endedAt === 'number' ? rec.endedAt : undefined,
		exitCode: typeof rec.exitCode === 'number' ? rec.exitCode : undefined,
		detail: rec.detail ? String(rec.detail) : undefined,
		output: rec.output ? String(rec.output) : undefined,
	};
}

export function splitSelectiveMemories(items: IKnoxGuiInjectedMemory[], memoryMode: string): { visible: IKnoxGuiInjectedMemory[]; collapsed: IKnoxGuiInjectedMemory[] } {
	if (memoryMode !== 'selective') {
		return { visible: items, collapsed: [] };
	}
	const visible = items.filter(item =>
		item.kind === 'timeout' || item.kind === 'goal' || typeof item.score !== 'number' || item.score >= SELECTIVE_COLLAPSE_BELOW,
	);
	const collapsed = items.filter(item => !visible.includes(item));
	return { visible, collapsed };
}

export function isInjectedMemoryTimeout(items: IKnoxGuiInjectedMemory[]): boolean {
	return items.length === 1 && items[0].kind === 'timeout';
}

export function parseInjectedMemories(value: unknown): IKnoxGuiInjectedMemory[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const items: IKnoxGuiInjectedMemory[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const rec = item as Record<string, unknown>;
		items.push({
			id: typeof rec.id === 'number' ? rec.id : rec.id == null ? null : Number(rec.id) || null,
			kind: String(rec.kind ?? 'semantic'),
			title: String(rec.title ?? ''),
			reason: String(rec.reason ?? ''),
			category: rec.category ? String(rec.category) : undefined,
			score: typeof rec.score === 'number' ? rec.score : undefined,
			pinned: Boolean(rec.pinned),
			evidence: Array.isArray(rec.evidence) ? rec.evidence.map(String) : undefined,
		});
	}
	return items;
}

export function idleAutonomous(): IKnoxGuiAutonomous {
	return { status: 'idle', iteration: 0, max: 0 };
}

export function autonomousMax(loop: IKnoxGuiAutonomous): number {
	return loop.max ?? 0;
}

export function autonomousBannerKey(loop: IKnoxGuiAutonomous): string {
	const unlimited = autonomousMax(loop) <= 0;
	if (loop.status === 'completed') {
		return unlimited ? 'autonomousBannerCompletedUnlimited' : 'autonomousBannerCompleted';
	}
	if (loop.status === 'cancelled') {
		return unlimited ? 'autonomousBannerCancelledUnlimited' : 'autonomousBannerCancelled';
	}
	return unlimited ? 'autonomousBannerRunningUnlimited' : 'autonomousBannerRunning';
}

export function autonomousProgress(loop: IKnoxGuiAutonomous): { percent: number; nearCap: boolean } | undefined {
	const max = autonomousMax(loop);
	if (max <= 0) {
		return undefined;
	}
	return {
		percent: Math.min(100, Math.round((loop.iteration / max) * 100)),
		nearCap: loop.iteration / max >= 0.8,
	};
}

export function shouldShowAutonomousBanner(loop: IKnoxGuiAutonomous | undefined): loop is IKnoxGuiAutonomous {
	return Boolean(loop && loop.status !== 'idle');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function toolOutputFromUnknown(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.map(item => {
		const rec = asRecord(item);
		return rec?.content ? String(rec.content) : '';
	}).filter(Boolean).join('\n') || undefined;
}

function lastAssistantIndex(history: IKnoxGuiHistoryItem[]): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'assistant') {
			return i;
		}
	}
	return -1;
}

function cloneHistory(history: IKnoxGuiHistoryItem[]): IKnoxGuiHistoryItem[] {
	return history.map(item => ({
		...item,
		toolCalls: item.toolCalls?.map(call => ({ ...call })),
	}));
}

export function applyKnoxGuiAutonomousEvent(state: IKnoxGuiState, rec: Record<string, unknown>): Partial<IKnoxGuiState> | undefined {
	const type = String(rec.type ?? '');
	if (!type.startsWith('autonomous:')) {
		return undefined;
	}
	const data = asRecord(rec.data) ?? rec;
	if (typeof data.session_id === 'string' && data.session_id && data.session_id !== state.sessionId) {
		return undefined;
	}
	const current = state.autonomous ?? idleAutonomous();
	if (type === 'autonomous:started') {
		return {
			autonomous: {
				status: 'running',
				iteration: 0,
				max: typeof data.max_iterations === 'number' ? data.max_iterations : 0,
				goal: typeof data.goal === 'string' ? data.goal : undefined,
			},
		};
	}
	if (type === 'autonomous:iteration') {
		return {
			autonomous: {
				...current,
				status: 'running',
				iteration: typeof data.iteration === 'number' ? data.iteration : current.iteration,
				max: typeof data.max_iterations === 'number' ? data.max_iterations : current.max,
				goal: current.goal,
			},
		};
	}
	if (type === 'autonomous:completed') {
		return {
			autonomous: {
				...current,
				status: 'completed',
				iteration: typeof data.iterations === 'number' ? data.iterations : current.iteration,
			},
		};
	}
	if (type === 'autonomous:cancelled') {
		return {
			autonomous: {
				...current,
				status: 'cancelled',
				iteration: typeof data.iteration === 'number' ? data.iteration : current.iteration,
			},
		};
	}
	if (type === 'autonomous:tool_start' || type === 'autonomous:tool_ask') {
		const history = cloneHistory(state.history);
		const index = lastAssistantIndex(history);
		if (index < 0) {
			return undefined;
		}
		const name = typeof data.name === 'string' ? data.name : '';
		const callId = typeof data.call_id === 'string' && data.call_id ? data.call_id : `${name}-${Date.now()}`;
		const args = asRecord(data.args) ?? {};
		const item = history[index];
		const calls = [...(item.toolCalls ?? [])];
		const existing = calls.findIndex(call => call.id === callId);
		const status = type === 'autonomous:tool_ask' ? 'generated' as const : 'calling' as const;
		if (existing >= 0) {
			calls[existing] = { ...calls[existing], status };
		} else {
			calls.push({
				id: callId,
				name,
				arguments: JSON.stringify(args),
				status,
				parsedArgs: args,
			});
		}
		history[index] = { ...item, toolCalls: calls };
		return { history };
	}
	if (type === 'autonomous:tool_end') {
		const history = cloneHistory(state.history);
		const callId = typeof data.call_id === 'string' ? data.call_id : '';
		for (let i = history.length - 1; i >= 0; i--) {
			const calls = history[i].toolCalls;
			if (!calls?.length) {
				continue;
			}
			const found = callId ? calls.find(call => call.id === callId) : calls[calls.length - 1];
			if (!found) {
				continue;
			}
			found.status = data.ok === false ? 'canceled' : 'done';
			found.output = toolOutputFromUnknown(data.output) ?? found.output;
			return { history, toolLoopSteps: state.toolLoopSteps + 1 };
		}
		return undefined;
	}
	if (type === 'autonomous:assistant') {
		const chunk = typeof data.content === 'string' ? data.content : '';
		if (!chunk.trim()) {
			return undefined;
		}
		const history = cloneHistory(state.history);
		const index = lastAssistantIndex(history);
		if (index < 0) {
			return undefined;
		}
		const currentContent = history[index].content ?? '';
		if (currentContent.includes(chunk.trim())) {
			return undefined;
		}
		history[index] = { ...history[index], content: currentContent ? `${currentContent}${chunk}` : chunk };
		return { history };
	}
	return {
		autonomous: {
			...current,
			iteration: Number(data.iteration ?? rec.iteration ?? current.iteration),
			max: data.max_iterations != null ? Number(data.max_iterations) : rec.max != null ? Number(rec.max) : current.max,
			status: type.includes('complete') ? 'completed' : type.includes('cancel') ? 'cancelled' : 'running',
		},
	};
}
