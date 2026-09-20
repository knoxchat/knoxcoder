/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Display window for long chats. Port of `knox/gui/src/pages/gui/chatHistoryWindow.ts`.
 *
 * Full history stays in the session service. The thread list mounts the latest N
 * messages, always including the live turn's user prompt, and prepends earlier
 * messages on demand.
 */

export const CHAT_DISPLAY_WINDOW = 25;
export const CHAT_LOAD_MORE_COUNT = 25;
export const CHAT_LOAD_EARLIER_SCROLL_TOP = 48;

export const AUTO_DISPLAY_START = Number.POSITIVE_INFINITY;

export interface IKnoxChatTurn {
	/** Index of the user message that starts the turn, or -1 if none. */
	userIndex: number;
	startIndex: number;
	/** Exclusive. */
	endIndex: number;
}

type HistoryRoleItem = { message: { role: string } };

export function groupHistoryTurns(
	history: readonly HistoryRoleItem[],
): IKnoxChatTurn[] {
	const turns: IKnoxChatTurn[] = [];
	if (history.length === 0) {
		return turns;
	}

	let start = 0;
	let userIndex = history[0].message.role === 'user' ? 0 : -1;

	for (let i = 1; i <= history.length; i++) {
		const isNewUser = i < history.length && history[i].message.role === 'user';
		if (!isNewUser && i !== history.length) {
			continue;
		}
		turns.push({ userIndex, startIndex: start, endIndex: i });
		start = i;
		userIndex = isNewUser ? i : -1;
	}

	return turns;
}

export function snapStartToTurn(start: number, turns: readonly IKnoxChatTurn[]): number {
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
	const {
		historyLength,
		expandedStart,
		windowSize = CHAT_DISPLAY_WINDOW,
	} = args;
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
	turns: readonly IKnoxChatTurn[];
	windowSize?: number;
}): number {
	const raw = computeDisplayStart(args);
	if (!Number.isFinite(args.expandedStart)) {
		return raw;
	}
	return snapStartToTurn(raw, args.turns);
}

export function nextExpandedStart(
	displayStart: number,
	loadCount: number = CHAT_LOAD_MORE_COUNT,
): number {
	return Math.max(0, displayStart - loadCount);
}

/** Pin the real last-sent prompt above the scroller while following a live turn. */
export function shouldFloatLastUser(args: {
	isStreaming: boolean;
	followLive: boolean;
	lastUserIndex: number;
}): boolean {
	return args.isStreaming && args.followLive && args.lastUserIndex >= 0;
}

/**
 * Indexes to mount for a turn. The live last user prompt stays mounted even
 * when the rest of a long turn is windowed, so it can be portaled to the
 * floating host while follow-live is on.
 */
export function visibleTurnIndexes(
	turn: IKnoxChatTurn,
	displayStart: number,
	lastUserIndex: number,
): number[] {
	const start = Math.max(turn.startIndex, displayStart);
	const indexes: number[] = [];
	if (
		turn.userIndex === lastUserIndex
		&& lastUserIndex >= 0
		&& lastUserIndex < start
		&& lastUserIndex < turn.endIndex
	) {
		indexes.push(lastUserIndex);
	}
	for (let i = start; i < turn.endIndex; i++) {
		indexes.push(i);
	}
	return indexes;
}

export function knoxLastUserIndex(history: readonly HistoryRoleItem[]): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].message.role === 'user') {
			return i;
		}
	}
	return -1;
}

export function knoxVisibleHistoryIndexes(
	history: readonly HistoryRoleItem[],
	displayStart: number,
	lastUserIndex: number = knoxLastUserIndex(history),
): number[] {
	const indexes: number[] = [];
	for (const turn of groupHistoryTurns(history)) {
		indexes.push(...visibleTurnIndexes(turn, displayStart, lastUserIndex));
	}
	return indexes;
}
