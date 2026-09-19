/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getHistoryToolStates } from './knoxChatHistory.js';
import {
	IKnoxChatHistoryItem,
	IKnoxToolCallState,
	renderKnoxChatMessage,
} from './knoxChatTypes.js';

/**
 * Native port of GUI `streamThunkWrapper.tsx` post-turn memory:
 * `collectTurnToolSummary`, `formatSettledToolSummary`, `extractSoulFiles`.
 * The workbench must not import `extensions/knox` `core`.
 */

const PATH_KEYS = [
	'filepath',
	'file_path',
	'target_file',
	'path',
	'outputPath',
	'output_path',
	'test_file_path',
	'directory_path',
	'target_directory',
] as const;

/** Core `extractSoulFiles`: paths a tool call touched, for the tool summary. */
export function knoxExtractSoulFiles(toolName: string, args: unknown): string[] {
	const parsed = knoxParseToolArgs(args);
	if (!parsed) {
		return [];
	}
	const files = new Set<string>();
	for (const key of PATH_KEYS) {
		const value = parsed[key];
		if (typeof value === 'string' && value.trim()) {
			files.add(value.trim());
		}
	}
	if (Array.isArray(parsed.paths)) {
		for (const value of parsed.paths) {
			if (typeof value === 'string' && value.trim()) {
				files.add(value.trim());
			}
		}
	}
	void toolName;
	return [...files];
}

function knoxParseToolArgs(args: unknown): Record<string, unknown> | undefined {
	if (!args) {
		return undefined;
	}
	if (typeof args === 'object' && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	if (typeof args === 'string') {
		try {
			const parsed = JSON.parse(args) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** Core `formatSettledToolSummary`: compact list so memory sees paths, not prose. */
export function knoxFormatSettledToolSummary(
	tools: Array<{ name?: string; status?: string; files?: string[]; ok?: boolean }>,
): string {
	if (tools.length === 0) {
		return '';
	}
	const lines = tools.map(tool => {
		const name = tool.name || 'tool';
		const ok = tool.ok ?? tool.status === 'done';
		const status = tool.status && tool.status !== 'done' ? ` status=${tool.status}` : '';
		const files = tool.files?.length ? ` files=${tool.files.slice(0, 8).join(', ')}` : '';
		return `- ${name} ${ok ? 'ok' : 'fail'}${status}${files}`;
	});
	return ['## Tools this turn', ...lines].join('\n');
}

/**
 * GUI `collectTurnToolSummary`: every tool state from the last user message to
 * the end of history (settled or not), rendered as the summary block.
 */
export function knoxCollectTurnToolSummary(history: readonly IKnoxChatHistoryItem[]): string {
	let start = 0;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].message.role === 'user') {
			start = i;
			break;
		}
	}
	const tools: Array<{ name: string; status: string; files: string[]; ok: boolean }> = [];
	for (let i = start; i < history.length; i++) {
		for (const state of getHistoryToolStates(history[i])) {
			const name = state.toolCall.function.name;
			tools.push({
				name,
				status: state.status,
				files: knoxExtractSoulFiles(name, state.parsedArgs ?? state.toolCall.function.arguments),
				ok: state.status === 'done',
			});
		}
	}
	return knoxFormatSettledToolSummary(tools);
}

export interface IKnoxPostTurnMemory {
	userMessage: string;
	assistantMessage: string;
	toolSummary: string;
	/** True when the turn should be stored (length threshold or tools ran). */
	substantial: boolean;
}

/**
 * GUI `streamThunkWrapper.tsx` substantial-turn rule:
 * `user + assistant chars >= post_turn_min_chars` or a tool ran.
 */
export function knoxPostTurnMemoryFor(
	history: readonly IKnoxChatHistoryItem[],
	postTurnMinChars: number,
): IKnoxPostTurnMemory | undefined {
	const lastUser = [...history].reverse().find(item => item.message.role === 'user');
	const lastAssistant = [...history].reverse().find(item => item.message.role === 'assistant');
	const userMessage = lastUser ? renderKnoxChatMessage(lastUser.message) : '';
	const assistantMessage = lastAssistant ? renderKnoxChatMessage(lastAssistant.message) : '';
	const toolSummary = knoxCollectTurnToolSummary(history);
	const substantial = userMessage.length + assistantMessage.length >= postTurnMinChars
		|| !!lastAssistant?.toolCallState
		|| !!toolSummary;
	if (!substantial || (!userMessage && !assistantMessage && !toolSummary)) {
		return undefined;
	}
	return { userMessage, assistantMessage, toolSummary, substantial };
}

/** GUI `streamThunkWrapper.tsx` default when `brain/getConfig` has no value. */
export const KNOX_POST_TURN_MIN_CHARS = 80;

/** Read `post_turn_min_chars` from `brain/getConfig` (default 80). */
export function knoxPostTurnMinChars(content: unknown): number {
	const record = content && typeof content === 'object' ? content as { config?: { post_turn_min_chars?: unknown } } : undefined;
	const min = record?.config?.post_turn_min_chars;
	return typeof min === 'number' && min >= 0 ? min : KNOX_POST_TURN_MIN_CHARS;
}

/** The last assistant reply text, for `brain/recordMessage`. */
export function knoxLastAssistantContent(history: readonly IKnoxChatHistoryItem[]): string {
	const lastAssistant = [...history].reverse().find(item => item.message.role === 'assistant');
	return lastAssistant ? renderKnoxChatMessage(lastAssistant.message) : '';
}

/** Tool states in the last turn, regardless of status (GUI parity). */
export function knoxTurnToolStates(history: readonly IKnoxChatHistoryItem[]): IKnoxToolCallState[] {
	let start = 0;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].message.role === 'user') {
			start = i;
			break;
		}
	}
	const states: IKnoxToolCallState[] = [];
	for (let i = start; i < history.length; i++) {
		states.push(...getHistoryToolStates(history[i]));
	}
	return states;
}
