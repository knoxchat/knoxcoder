/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { incrementalParseJson, isAskUserToolName, parseToolArgs } from '../knoxGuiChat.js';
import { IKnoxGuiTool, IKnoxGuiToolCall } from '../knoxGuiState.js';
import { knoxGuiSanitizeToolFilePath } from '../knoxGuiToolFilePath.js';
import { parseAskUserQuestionsForGui } from './askUser.js';
import { resolveGuiToolName } from './names.js';

/** Path/code argument keys, streaming extraction, and tool-call delta merge. */

export const FILEPATH_KEYS = [
	'target_file', 'filepath', 'file_path', 'path', 'file', 'filename', 'relativeFilepath', 'outputPath',
] as const;

const GUI_PATH_ARG_KEYS = new Set<string>([
	...FILEPATH_KEYS,
	'directory_path',
	'directory',
	'dir',
	'target_directory',
	'working_directory',
	'cwd',
	'filePath',
]);

function sanitizeGuiPathArgs(args: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...args };
	for (const [key, value] of Object.entries(out)) {
		if (typeof value === 'string' && GUI_PATH_ARG_KEYS.has(key)) {
			out[key] = knoxGuiSanitizeToolFilePath(value);
		}
	}
	return out;
}

export const CODE_CONTENT_KEYS = [
	'code_edit', 'contents', 'content', 'code', 'new_contents', 'new_string', 'replacement', 'patch', 'diff', 'body', 'text', 'source', 'old_string',
] as const;

export interface IKnoxGuiStreamingToolCode {
	filepath: string;
	codeContent: string;
	contentKey?: string;
	started: boolean;
}

function asDeltaRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * GUI `mergeToolCallDeltas` + `toolCallDeltaToState`: match by OpenAI `index`
 * or Anthropic `id`, concatenate argument fragments, keep the first non-empty
 * name, and incrementally parse args for live titles.
 */
export function mergeStreamedToolCalls(
	toolCalls: IKnoxGuiToolCall[],
	raw: unknown[],
	options?: { tools?: readonly IKnoxGuiTool[]; nextId?: () => string },
): void {
	const tools = options?.tools ?? [];
	let generated = 0;
	const nextId = options?.nextId ?? (() => `call_${++generated}`);
	for (const callUnknown of raw) {
		const call = asDeltaRecord(callUnknown);
		if (!call) {
			continue;
		}
		const fn = asDeltaRecord(call.function);
		const incomingIndex = typeof call.index === 'number' && call.index >= 0 ? call.index : undefined;
		const incomingId = typeof call.id === 'string' && call.id ? call.id : undefined;
		let target = -1;
		if (incomingIndex !== undefined) {
			target = incomingIndex;
		} else if (incomingId) {
			target = toolCalls.findIndex(item => item.id === incomingId);
		}
		if (target < 0) {
			target = toolCalls.length;
		}
		while (toolCalls.length <= target) {
			toolCalls.push({
				id: nextId(),
				name: '',
				arguments: '',
				status: 'generating',
				parsedArgs: {},
			});
		}
		const existing = toolCalls[target];
		const incomingArgs = String(fn?.arguments ?? call.arguments ?? '');
		const args = mergeToolArguments(existing.arguments ?? '', incomingArgs);
		const parsed = sanitizeGuiPathArgs(parseToolArgs(args));
		const incomingName = String(fn?.name ?? call.name ?? '');
		const name = resolveGuiToolName(incomingName || existing.name, tools, parsed);
		const settled = existing.status === 'calling' || existing.status === 'done' || existing.status === 'canceled' || existing.status === 'errored';
		existing.id = incomingId || existing.id;
		existing.name = name || existing.name;
		existing.arguments = args;
		existing.parsedArgs = parsed;
		existing.questions = isAskUserToolName(name || existing.name)
			? parseAskUserQuestionsForGui(parsed)
			: parseAskUserQuestionsForGui(parsed.questions);
		if (!settled) {
			existing.status = 'generating';
		}
	}
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
		const [, incrementallyParsed] = incrementalParseJson(raw);
		fromRaw = asArgsRecord(incrementallyParsed) ?? {};
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
	const filepath = knoxGuiSanitizeToolFilePath(filepathHit?.value ?? '');
	const started = filepath.length > 0 || codeContent.length > 0 || (!!raw && fieldStartedInRaw(raw, [...FILEPATH_KEYS, ...CODE_CONTENT_KEYS]));
	return { filepath, codeContent, contentKey: contentHit?.key, started };
}

export function displayArgsForToolCall(parsedArgs: unknown, rawArguments?: unknown): Record<string, unknown> {
	const parsed = asArgsRecord(parsedArgs) ?? {};
	const raw = typeof rawArguments === 'string' ? rawArguments : '';
	const [, incremental] = raw ? incrementalParseJson(raw) : [false, {}];
	const fromRaw = asArgsRecord(incremental) ?? {};
	const extracted = extractStreamingToolCode({ parsedArgs, rawArguments });
	return sanitizeGuiPathArgs({
		...fromRaw,
		...parsed,
		...(extracted.filepath ? { filepath: extracted.filepath } : {}),
	});
}

/**
 * Original `mergeToolCallDeltas` always concatenates argument fragments.
 * Also accept a snapshot that already contains the previous prefix. Never
 * replace on `JSON.parse` — a streamed `"path"` fragment is valid JSON and
 * would wipe `{"directory_path": `.
 */
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
		const parsed = JSON.parse(incoming);
		if (parsed && typeof parsed === 'object') {
			return incoming;
		}
	} catch {
		// Streaming deltas are concatenated until they form an object.
	}
	return previous + incoming;
}
