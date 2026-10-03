/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-040: per-turn run summary. Pure functions over the chat history: files changed
 * (with +/- counts), commands run, test and oracle status, tokens and elapsed time.
 * Everything is derived from tool-call arguments and results already in the history,
 * so it works for restored sessions too.
 */

import { classifyAgentActivityKind, extractSoulCheckpointId, itemCreatedAtMs } from './knoxGuiTranscript.js';
import type { IKnoxGuiHistoryItem, IKnoxGuiToolCall } from './knoxGuiState.js';
import { knoxGuiSanitizeToolFilePath } from './knoxGuiToolFilePath.js';

export interface IKnoxGuiTurnFileChange {
	path: string;
	additions: number;
	deletions: number;
	/** `create` when the turn wrote a file that did not exist (write_file / new file / patch Add File). */
	kind: 'edit' | 'create' | 'delete';
}

export interface IKnoxGuiTurnCommand {
	command: string;
	status: 'done' | 'errored' | 'canceled' | 'running';
	isTest: boolean;
}

export interface IKnoxGuiTurnOracle {
	command: string;
	passed: boolean;
	errors?: number;
}

export interface IKnoxGuiTurnSummary {
	files: IKnoxGuiTurnFileChange[];
	totalAdditions: number;
	totalDeletions: number;
	commands: IKnoxGuiTurnCommand[];
	testsRun: number;
	testsFailed: number;
	/** The last `oracle: <cmd> -> pass|fail` line seen in an edit result. */
	oracle?: IKnoxGuiTurnOracle;
	toolCalls: number;
	failedToolCalls: number;
	/** Sum of provider-reported prompt + completion tokens over the turn's prompt logs; 0 when none were reported. */
	tokens: number;
	/** Wall clock from the user message to the last row of the turn; undefined without timestamps. */
	elapsedMs?: number;
	/** First workspace checkpoint of the turn (taken before its first mutation): "undo this turn" restores it. */
	checkpointId?: string;
}

const PATH_KEYS = ['filepath', 'file_path', 'filePath', 'path', 'target_file', 'filename'] as const;
const ORACLE_LINE_RE = /oracle:\s*(.+?)\s*->\s*(pass|fail)(?:\s*\((\d+)\s*errors?\))?/gi;

function toolBaseName(name: string): string {
	return name.replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
}

function argsOf(call: IKnoxGuiToolCall): Record<string, unknown> {
	if (call.parsedArgs && typeof call.parsedArgs === 'object') {
		return call.parsedArgs;
	}
	try {
		const parsed = JSON.parse(call.arguments);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function pathOf(args: Record<string, unknown>): string | undefined {
	for (const key of PATH_KEYS) {
		const value = args[key];
		if (typeof value === 'string' && value.trim()) {
			return knoxGuiSanitizeToolFilePath(value);
		}
	}
	return undefined;
}

function lineCount(text: unknown): number {
	if (typeof text !== 'string' || text === '') {
		return 0;
	}
	const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
	return trimmed.split('\n').length;
}

/** Keeps only lines that exist in one side: the common-prefix / common-suffix trim gives a stable +/- for a replace. */
function replaceDelta(oldText: unknown, newText: unknown): { additions: number; deletions: number } {
	const oldLines = typeof oldText === 'string' && oldText !== '' ? oldText.split('\n') : [];
	const newLines = typeof newText === 'string' && newText !== '' ? newText.split('\n') : [];
	let start = 0;
	while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
		start++;
	}
	let oldEnd = oldLines.length;
	let newEnd = newLines.length;
	while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}
	return { additions: newEnd - start, deletions: oldEnd - start };
}

function patchChanges(patch: string): IKnoxGuiTurnFileChange[] {
	const out: IKnoxGuiTurnFileChange[] = [];
	let current: IKnoxGuiTurnFileChange | undefined;
	for (const line of patch.split('\n')) {
		const header = /^\*\*\* (Update|Add|Delete) File:\s*(.+?)\s*$/.exec(line);
		if (header) {
			current = {
				path: knoxGuiSanitizeToolFilePath(header[2]),
				additions: 0,
				deletions: 0,
				kind: header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'edit',
			};
			out.push(current);
			continue;
		}
		if (!current || line.startsWith('***') || line.startsWith('@@')) {
			continue;
		}
		if (line.startsWith('+')) {
			current.additions++;
		} else if (line.startsWith('-')) {
			current.deletions++;
		}
	}
	return out;
}

function changesOfCall(call: IKnoxGuiToolCall): IKnoxGuiTurnFileChange[] {
	if (call.status !== 'done') {
		return [];
	}
	const args = argsOf(call);
	const name = toolBaseName(call.name);
	if (name === 'apply_patch' || name === 'applypatch') {
		const patch = typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : '';
		return patchChanges(patch);
	}
	const path = pathOf(args);
	if (!path) {
		return [];
	}
	if (name === 'write_file' || name === 'create_new_file' || name === 'create_file') {
		return [{ path, additions: lineCount(args.content ?? args.contents ?? args.file_text), deletions: 0, kind: name === 'write_file' ? 'edit' : 'create' }];
	}
	if (name === 'edit_file' || name === 'str_replace' || name === 'search_replace' || name === 'strreplace' || name === 'str_replace_editor') {
		if (Array.isArray(args.edits)) {
			let additions = 0;
			let deletions = 0;
			for (const edit of args.edits) {
				if (edit && typeof edit === 'object') {
					const delta = replaceDelta((edit as Record<string, unknown>).old_string, (edit as Record<string, unknown>).new_string);
					additions += delta.additions;
					deletions += delta.deletions;
				}
			}
			return [{ path, additions, deletions, kind: 'edit' }];
		}
		const delta = replaceDelta(args.old_string ?? args.old_str, args.new_string ?? args.new_str);
		return [{ path, ...delta, kind: 'edit' }];
	}
	if (name === 'edit_notebook') {
		return [{ path, additions: lineCount(args.source), deletions: 0, kind: 'edit' }];
	}
	return [];
}

function callOutput(call: IKnoxGuiToolCall): string {
	return [call.output ?? '', ...(call.outputItems?.map(item => item.content) ?? [])].join('\n');
}

function sumTokens(item: IKnoxGuiHistoryItem): number {
	let total = 0;
	for (const log of item.promptLogs ?? []) {
		const usage = (log as { usage?: { promptTokens?: unknown; completionTokens?: unknown } }).usage;
		if (usage) {
			total += (typeof usage.promptTokens === 'number' ? usage.promptTokens : 0) + (typeof usage.completionTokens === 'number' ? usage.completionTokens : 0);
		}
	}
	return total;
}

/** Summarizes the turn that starts at `userIndex` (a user row). Undefined when the turn did nothing worth a summary. */
export function summarizeTurn(history: readonly IKnoxGuiHistoryItem[], userIndex: number): IKnoxGuiTurnSummary | undefined {
	if (userIndex < 0 || userIndex >= history.length || history[userIndex]?.role !== 'user') {
		return undefined;
	}
	const byPath = new Map<string, IKnoxGuiTurnFileChange>();
	const commands: IKnoxGuiTurnCommand[] = [];
	let oracle: IKnoxGuiTurnOracle | undefined;
	let toolCalls = 0;
	let failedToolCalls = 0;
	let tokens = 0;
	let checkpointId: string | undefined;
	let lastIndex = userIndex;
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.role === 'user') {
			break;
		}
		lastIndex = i;
		tokens += sumTokens(item);
		for (const call of item.toolCalls ?? []) {
			toolCalls++;
			if (call.status === 'errored') {
				failedToolCalls++;
			}
			const args = argsOf(call);
			const kind = classifyAgentActivityKind(call.name, args);
			if (kind === 'shell' || kind === 'test') {
				const command = typeof args.command === 'string' ? args.command.trim() : '';
				if (command) {
					commands.push({
						command,
						status: call.status === 'done' ? 'done' : call.status === 'errored' ? 'errored' : call.status === 'canceled' ? 'canceled' : 'running',
						isTest: kind === 'test',
					});
				}
			}
			for (const change of changesOfCall(call)) {
				const existing = byPath.get(change.path);
				if (existing) {
					existing.additions += change.additions;
					existing.deletions += change.deletions;
					if (change.kind === 'delete') {
						existing.kind = 'delete';
					}
				} else {
					byPath.set(change.path, { ...change });
				}
			}
			const output = callOutput(call);
			if (output) {
				for (const match of output.matchAll(ORACLE_LINE_RE)) {
					oracle = { command: match[1], passed: match[2].toLowerCase() === 'pass', errors: match[3] ? Number(match[3]) : undefined };
				}
				// The turn checkpoint is taken before the first mutation, so the first one is the pre-turn state.
				checkpointId ??= extractSoulCheckpointId(output);
			}
		}
	}
	const files = [...byPath.values()];
	if (!files.length && !commands.length && !toolCalls) {
		return undefined;
	}
	const start = itemCreatedAtMs(history[userIndex]);
	const end = itemCreatedAtMs(history[lastIndex]);
	const tests = commands.filter(command => command.isTest);
	return {
		files,
		totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
		totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
		commands,
		testsRun: tests.length,
		testsFailed: tests.filter(command => command.status === 'errored').length,
		oracle,
		toolCalls,
		failedToolCalls,
		tokens,
		elapsedMs: start !== undefined && end !== undefined && end >= start ? end - start : undefined,
		checkpointId,
	};
}

export function formatTurnDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.max(0, Math.round(ms))}ms`;
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

export function formatTurnTokens(tokens: number): string {
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}
