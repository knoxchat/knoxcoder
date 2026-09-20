/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IKnoxSession, IKnoxSessionMetadata, renderKnoxChatMessage } from './knoxChatTypes.js';

export type KnoxDateGroup = 'today' | 'thisWeek' | 'thisMonth' | 'earlier';

export interface IKnoxSearchDocument {
	id: string;
	fields: string[];
}

export interface IKnoxHistoryDateGroup<T> {
	id: KnoxDateGroup;
	header: string;
	items: T[];
}

const SESSION_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
};

/** GUI `parseDate`: ISO first, then integer millis. */
export function parseKnoxSessionDate(date: string | undefined | null): Date {
	if (date === undefined || date === null || date === '') {
		return new Date(NaN);
	}
	let dateObj = new Date(date);
	if (isNaN(dateObj.getTime())) {
		dateObj = new Date(Number.parseInt(date, 10));
	}
	return dateObj;
}

export function formatKnoxSessionDate(date: Date, compact = false): string {
	if (isNaN(date.getTime())) {
		return '';
	}
	return date.toLocaleString(undefined, {
		...SESSION_DATE_OPTIONS,
		year: compact ? '2-digit' : 'numeric',
	});
}

export function knoxWorkspaceBasename(workspaceDirectory?: string): string {
	if (!workspaceDirectory) {
		return '';
	}
	try {
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(workspaceDirectory)) {
			return basename(URI.parse(workspaceDirectory).fsPath) || basename(workspaceDirectory);
		}
	} catch {
		// Fall through to path basename.
	}
	return basename(workspaceDirectory.replace(/^file:\/\//, ''));
}

/** MiniSearch-style tokenizer: letters/numbers, split on punctuation and space. */
export function knoxSearchTokens(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

export function knoxLevenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (!a.length) {
		return b.length;
	}
	if (!b.length) {
		return a.length;
	}
	const prev = new Array<number>(b.length + 1);
	const next = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) {
		prev[j] = j;
	}
	for (let i = 1; i <= a.length; i++) {
		next[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		for (let j = 0; j <= b.length; j++) {
			prev[j] = next[j];
		}
	}
	return prev[b.length];
}

function termMatchesToken(term: string, token: string, fuzzy: number): boolean {
	if (token === term || token.startsWith(term)) {
		return true;
	}
	const maxDistance = Math.round(term.length * fuzzy);
	if (maxDistance <= 0) {
		return false;
	}
	return knoxLevenshtein(term, token) <= maxDistance;
}

/**
 * MiniSearch-equivalent filter used by GUI History (title field, `fuzzy: 0.1`).
 * Prefix matches are included so short queries still hit title tokens; callers
 * that need extra substring fallbacks (checkpoints) layer them on top.
 */
export function knoxMiniSearchIds(
	documents: readonly IKnoxSearchDocument[],
	query: string,
	fuzzy = 0.1,
): string[] {
	const terms = knoxSearchTokens(query);
	if (!terms.length) {
		return documents.map(document => document.id);
	}
	const ids: string[] = [];
	for (const document of documents) {
		const tokens = document.fields.flatMap(knoxSearchTokens);
		const matches = terms.every(term =>
			tokens.some(token => termMatchesToken(term, token, fuzzy)),
		);
		if (matches) {
			ids.push(document.id);
		}
	}
	return ids;
}

export function knoxSessionSearchDocument(session: IKnoxSessionMetadata): IKnoxSearchDocument {
	return {
		id: session.sessionId,
		fields: [session.title ?? ''],
	};
}

export function knoxFilterSessions(
	sessions: readonly IKnoxSessionMetadata[],
	query: string,
): IKnoxSessionMetadata[] {
	const term = query.trim();
	const allowed = term
		? new Set(knoxMiniSearchIds(sessions.map(knoxSessionSearchDocument), term))
		: undefined;
	return sessions
		.filter(session => !allowed || allowed.has(session.sessionId))
		.slice()
		.sort((a, b) => parseKnoxSessionDate(b.dateCreated).getTime() - parseKnoxSessionDate(a.dateCreated).getTime());
}

export function knoxDateGroup(date: Date, now = Date.now()): KnoxDateGroup {
	const yesterday = now - 1000 * 60 * 60 * 24;
	const lastWeek = now - 1000 * 60 * 60 * 24 * 7;
	const lastMonth = now - 1000 * 60 * 60 * 24 * 30;
	const time = date.getTime();
	if (!isNaN(time) && time > yesterday) {
		return 'today';
	}
	if (!isNaN(time) && time > lastWeek) {
		return 'thisWeek';
	}
	if (!isNaN(time) && time > lastMonth) {
		return 'thisMonth';
	}
	return 'earlier';
}

export function knoxDateGroupLabel(group: KnoxDateGroup): string {
	switch (group) {
		case 'today': return localize('knox.today', "Today");
		case 'thisWeek': return localize('knox.thisWeek', "This Week");
		case 'thisMonth': return localize('knox.thisMonth', "This Month");
		case 'earlier': return localize('knox.earlierConversations', "Older");
	}
}

export function knoxGroupByDate<T>(
	items: readonly T[],
	dateOf: (item: T) => Date,
	now = Date.now(),
): IKnoxHistoryDateGroup<T>[] {
	const sections: IKnoxHistoryDateGroup<T>[] = [];
	for (const item of items) {
		const id = knoxDateGroup(dateOf(item), now);
		const last = sections.at(-1);
		if (last?.id === id) {
			last.items.push(item);
		} else {
			sections.push({ id, header: knoxDateGroupLabel(id), items: [item] });
		}
	}
	return sections;
}

export function knoxSessionExportFilename(title: string, now = new Date()): string {
	const safeTitle = title
		.replace(/[^a-z0-9]/gi, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.substring(0, 50) || 'session';
	const timestamp = now.toISOString().split('T')[0];
	return `${timestamp}_${safeTitle}.md`;
}

export function knoxSessionExportMarkdown(session: IKnoxSession, now = new Date()): string {
	let content = `### [Knox](https://knox.chat) ${localize('knox.sessionTranscript', "Knox session transcript")}\n ${localize('knox.exported', "Exported")}: ${now.toLocaleString()}`;
	content += `\n\n**${localize('knox.sessionLabel', "Session")}:** ${session.title}`;
	const workspace = knoxWorkspaceBasename(session.workspaceDirectory);
	if (workspace) {
		content += `\n**${localize('knox.workspaceLabel', "Workspace")}:** ${workspace}`;
	}
	if (session.history?.length) {
		for (const historyItem of session.history) {
			const msg = historyItem.message;
			let msgText = renderKnoxChatMessage(msg);
			msgText = msgText.replace(/^/gm, '> ');
			const role = msg.role === 'user'
				? localize('knox.userRole', "User")
				: localize('knox.assistantRole', "Knox");
			content += `\n\n#### _${role}_\n\n${msgText}`;
		}
	} else {
		content += `\n\n_${localize('knox.noMessagesInSession', "No messages in this session.")}_`;
	}
	return content;
}

export function parseKnoxSessionMetadata(value: unknown): IKnoxSessionMetadata | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.sessionId !== 'string' || !record.sessionId) {
		return undefined;
	}
	return {
		sessionId: record.sessionId,
		title: typeof record.title === 'string' ? record.title : '',
		dateCreated: typeof record.dateCreated === 'string' ? record.dateCreated : undefined,
		workspaceDirectory: typeof record.workspaceDirectory === 'string' ? record.workspaceDirectory : undefined,
	};
}

export function parseKnoxSession(value: unknown): IKnoxSession | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.sessionId !== 'string' || !record.sessionId) {
		return undefined;
	}
	return {
		sessionId: record.sessionId,
		title: typeof record.title === 'string' ? record.title : '',
		workspaceDirectory: typeof record.workspaceDirectory === 'string' ? record.workspaceDirectory : undefined,
		history: Array.isArray(record.history) ? record.history as IKnoxSession['history'] : [],
		guiHydrateSlimmed: record.guiHydrateSlimmed === true ? true : undefined,
	};
}
