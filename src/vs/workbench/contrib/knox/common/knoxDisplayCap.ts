/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Display-only session slimming. Port of `knox/core/util/sessionDisplayCap.ts`.
 * Never truncate tool `message.content` or `tools/call` payloads.
 */

import {
	IKnoxChatHistoryItem,
	IKnoxContextItem,
	IKnoxSession,
	IKnoxToolCallState,
} from './knoxChatTypes.js';

/** GUI display tail for tool dumps. Model-facing `message.content` stays full. */
export const GUI_DISPLAY_MAX_CHARS = 32_000;

/** Soft max for `history/load` after slimming (CSLD-21). */
export const GUI_SESSION_HYDRATE_BUDGET_BYTES = 8_000_000;

function historyToolStates(item: IKnoxChatHistoryItem): IKnoxToolCallState[] {
	if (item.toolCallStates?.length) {
		return item.toolCallStates;
	}
	return item.toolCallState ? [item.toolCallState] : [];
}

export function capDisplayText(
	text: string,
	maxChars = GUI_DISPLAY_MAX_CHARS,
): { text: string; truncated: boolean; originalLength: number } {
	if (!text || text.length <= maxChars) {
		return { text: text ?? '', truncated: false, originalLength: text?.length ?? 0 };
	}
	let tail = text.slice(-maxChars);
	const nl = tail.indexOf('\n');
	if (nl !== -1 && nl < tail.length - 1) {
		tail = tail.slice(nl + 1);
	}
	return {
		text: tail,
		truncated: true,
		originalLength: text.length,
	};
}

export function capContextItems<T extends { content: string; description?: string }>(
	items: T[] | undefined,
	maxChars = GUI_DISPLAY_MAX_CHARS,
): T[] {
	if (!items?.length) {
		return items ?? [];
	}
	let changed = false;
	const next = items.map(item => {
		const capped = capDisplayText(item.content, maxChars);
		if (!capped.truncated) {
			return item;
		}
		changed = true;
		const hint = `truncated ${capped.originalLength} chars`;
		const description =
			item.description && !item.description.includes('truncated')
				? `${item.description} (${hint})`
				: hint;
		return { ...item, content: capped.text, description };
	});
	return changed ? next : items;
}

export function dropSettledToolCallOutputs(
	history: IKnoxChatHistoryItem[],
): IKnoxChatHistoryItem[] {
	const completedIds = new Set<string>();
	for (const item of history) {
		if (item.message.role === 'tool' && item.message.toolCallId) {
			completedIds.add(item.message.toolCallId);
		}
	}
	if (completedIds.size === 0) {
		return history;
	}

	let changed = false;
	const next = history.map(item => {
		const states = historyToolStates(item);
		if (!states.length) {
			return item;
		}
		let stateChanged = false;
		const nextStates = states.map(state => {
			const id = state.toolCallId || state.toolCall?.id;
			if (
				id
				&& completedIds.has(id)
				&& state.output
				&& state.output.length > 0
			) {
				stateChanged = true;
				const { output: _drop, ...rest } = state;
				return rest;
			}
			if (state.output?.length) {
				const capped = capContextItems(state.output);
				if (capped !== state.output) {
					stateChanged = true;
					return { ...state, output: capped };
				}
			}
			return state;
		});
		if (!stateChanged) {
			return item;
		}
		changed = true;
		return {
			...item,
			toolCallStates: nextStates,
			toolCallState: nextStates[0],
		};
	});
	return changed ? next : history;
}

export function capToolRoleContextItems(
	history: IKnoxChatHistoryItem[],
): IKnoxChatHistoryItem[] {
	let changed = false;
	const next = history.map(item => {
		if (item.message.role !== 'tool' || !item.contextItems?.length) {
			return item;
		}
		const capped = capContextItems(item.contextItems);
		if (capped === item.contextItems) {
			return item;
		}
		changed = true;
		return { ...item, contextItems: capped };
	});
	return changed ? next : history;
}

function dropPromptLogsFromHistory(history: IKnoxChatHistoryItem[]): IKnoxChatHistoryItem[] {
	let changed = false;
	const next = history.map(item => {
		if (!item.promptLogs?.length) {
			return item;
		}
		changed = true;
		const { promptLogs: _drop, ...rest } = item;
		return rest;
	});
	return changed ? next : history;
}

/** Normalize a loaded session for GUI memory. Does not touch tool `message.content`. */
export function normalizeHistoryForGui(
	history: IKnoxChatHistoryItem[],
): IKnoxChatHistoryItem[] {
	return capToolRoleContextItems(dropSettledToolCallOutputs(history));
}

export function contextItemDisplayCopy<T extends IKnoxContextItem>(item: T): T {
	const capped = capDisplayText(item.content);
	if (!capped.truncated) {
		return item;
	}
	return {
		...item,
		content: capped.text,
		description: item.description
			? `${item.description} (truncated ${capped.originalLength} chars)`
			: `truncated ${capped.originalLength} chars`,
	};
}

function stringBytes(value: unknown): number {
	if (typeof value === 'string') {
		return value.length * 2;
	}
	return 0;
}

function estimateHistoryItemBytes(item: IKnoxChatHistoryItem): number {
	let n = 64;
	const content = item.message?.content;
	if (typeof content === 'string') {
		n += stringBytes(content);
	} else if (Array.isArray(content)) {
		for (const part of content) {
			if (part && typeof part === 'object' && 'text' in part) {
				n += stringBytes((part as { text?: string }).text);
			}
		}
	}
	n += stringBytes(item.reasoning?.text);
	for (const ctx of item.contextItems ?? []) {
		n += stringBytes(ctx.content);
		n += stringBytes(ctx.description);
	}
	const states = historyToolStates(item);
	for (const state of states) {
		n += stringBytes(state.toolCall?.function?.arguments);
		for (const out of state.output ?? []) {
			n += stringBytes(out.content);
		}
	}
	for (const log of item.promptLogs ?? []) {
		n += stringBytes(log.prompt);
		n += stringBytes(log.completion);
	}
	return n;
}

/** Approximate UTF-16 payload size without JSON.stringify of the whole tree. */
export function estimateSessionPayloadBytes(session: IKnoxSession): number {
	let n = 64 + stringBytes(session.title) + stringBytes(session.sessionId);
	n += stringBytes(session.workspaceDirectory);
	for (const item of session.history ?? []) {
		n += estimateHistoryItemBytes(item);
	}
	return n;
}

export type IKnoxSlimSessionResult = {
	session: IKnoxSession;
	slimmed: boolean;
	overBudget: boolean;
	originalBytes: number;
	resultBytes: number;
};

function historyHasTruncatedDisplay(history: IKnoxChatHistoryItem[]): boolean {
	return history.some(item =>
		item.contextItems?.some(ctx => ctx.description?.includes('truncated')),
	);
}

/**
 * Slim a session for GUI hydrate. Drops promptLogs, duplicate settled tool
 * outputs, and caps display strings. Does not truncate tool `message.content`.
 */
export function slimSessionForGui(session: IKnoxSession): IKnoxSlimSessionResult {
	const originalBytes = estimateSessionPayloadBytes(session);
	const history = normalizeHistoryForGui(
		dropPromptLogsFromHistory(session.history ?? []),
	);
	const slimmed = history !== session.history;
	const resultBytes = slimmed
		? estimateSessionPayloadBytes({
			...session,
			history,
		})
		: originalBytes;
	const overBudget =
		originalBytes > GUI_SESSION_HYDRATE_BUDGET_BYTES
		|| resultBytes > GUI_SESSION_HYDRATE_BUDGET_BYTES;
	const warn = overBudget || historyHasTruncatedDisplay(history);
	const next: IKnoxSession = slimmed
		? {
			sessionId: session.sessionId,
			title: session.title,
			workspaceDirectory: session.workspaceDirectory,
			history,
			...(warn ? { guiHydrateSlimmed: true } : {}),
		}
		: warn
			? { ...session, guiHydrateSlimmed: true }
			: session;
	return {
		session: next,
		slimmed,
		overBudget,
		originalBytes,
		resultBytes,
	};
}

export function shouldWarnLargeSession(session: IKnoxSession): boolean {
	if (session.guiHydrateSlimmed) {
		return true;
	}
	return estimateSessionPayloadBytes(session) > GUI_SESSION_HYDRATE_BUDGET_BYTES;
}

export type KnoxHistoryHydrateNotice = 'large' | null;

export function knoxHydrateNoticeForSession(session: IKnoxSession): KnoxHistoryHydrateNotice {
	const slim = slimSessionForGui(session);
	return slim.overBudget || shouldWarnLargeSession(slim.session) ? 'large' : null;
}
