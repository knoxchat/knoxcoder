/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiHistoryItem, IKnoxGuiHistorySession } from './knoxGuiState.js';

/**
 * K-043: pure helpers for session management: pinning, forking a conversation at a message,
 * and merging content-search hits into the history list.
 */

export const KNOX_PINNED_SESSIONS_KEY = 'knox.gui.pinnedSessions';
export const KNOX_PINNED_SESSIONS_MAX = 50;

export function knoxGuiTogglePinned(pinned: readonly string[], id: string): string[] {
	if (!id) {
		return [...pinned];
	}
	if (pinned.includes(id)) {
		return pinned.filter(item => item !== id);
	}
	const next = [id, ...pinned];
	return next.length > KNOX_PINNED_SESSIONS_MAX ? next.slice(0, KNOX_PINNED_SESSIONS_MAX) : next;
}

export function knoxGuiParsePinned(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && !!item).slice(0, KNOX_PINNED_SESSIONS_MAX) : [];
	} catch {
		return [];
	}
}

export function knoxGuiSerializePinned(pinned: readonly string[]): string {
	return JSON.stringify(pinned);
}

/** Marks pinned sessions and attaches the content-search snippet, when there is one. */
export function knoxGuiDecorateSessions(sessions: readonly IKnoxGuiHistorySession[], pinned: readonly string[], hits: Readonly<Record<string, string>>): IKnoxGuiHistorySession[] {
	return sessions.map(session => {
		const isPinned = pinned.includes(session.id);
		const snippet = hits[session.id];
		return isPinned || snippet ? { ...session, ...(isPinned ? { pinned: true } : {}), ...(snippet ? { snippet } : {}) } : session;
	});
}

/** Sessions the content search found that the title filter did not. */
export function knoxGuiMergeContentHits(titleMatches: readonly IKnoxGuiHistorySession[], all: readonly IKnoxGuiHistorySession[], hits: Readonly<Record<string, string>>): IKnoxGuiHistorySession[] {
	const have = new Set(titleMatches.map(session => session.id));
	return [...titleMatches, ...all.filter(session => !have.has(session.id) && hits[session.id] !== undefined)];
}

/**
 * The history of a new session that continues from one message. Forking at a reply keeps the
 * reply; forking at a user message keeps everything before it, so the user can ask differently.
 * Tool calls that never finished are marked canceled: the fork has no running tool to wait for.
 */
export function knoxGuiForkHistory(history: readonly IKnoxGuiHistoryItem[], index: number): IKnoxGuiHistoryItem[] {
	if (index < 0 || index >= history.length) {
		return [];
	}
	const end = history[index].role === 'user' ? index : index + 1;
	return history.slice(0, end).map(item => {
		if (!item.toolCalls?.some(call => call.status !== 'done' && call.status !== 'errored' && call.status !== 'canceled')) {
			return item;
		}
		return {
			...item,
			toolCalls: item.toolCalls.map(call => call.status === 'done' || call.status === 'errored' || call.status === 'canceled' ? call : { ...call, status: 'canceled' as const }),
		};
	});
}

export function knoxGuiForkTitle(title: string, suffix: string): string {
	const base = title.trim() || suffix;
	return base.endsWith(suffix) ? base : `${base} ${suffix}`;
}
