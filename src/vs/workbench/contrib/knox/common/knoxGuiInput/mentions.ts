/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiContextProvider, IKnoxGuiSuggestItem } from '../knoxGuiState.js';

/** `@` mention items: convert, group, rank, live-search, and chip helpers. */

export type KnoxGuiMentionSectionId = 'open' | 'files' | 'folders' | 'providers' | 'other';

export interface IKnoxGuiSuggestSection {
	id: string;
	labelKey: string;
	items: IKnoxGuiSuggestItem[];
}

export const TOP_LEVEL_MENTION_LIMIT = 40;
export const EMPTY_QUERY_FILE_LIMIT = 8;
export const LIVE_MENTION_MIN_QUERY = 2;
export const LIVE_MENTION_HIT_THRESHOLD = 8;
export const LIVE_MENTION_DEBOUNCE_MS = 150;
export const LIVE_MENTION_SEARCH_CAP = 200;
export const MENTION_LOADING_ID = 'loading';
export const MENTION_TRUNCATED_ID = 'mention-truncated';

const MENTION_SECTION_KEYS: Record<KnoxGuiMentionSectionId, string> = {
	open: 'mentionSectionOpen',
	files: 'mentionSectionFiles',
	folders: 'mentionSectionFolders',
	providers: 'mentionSectionProviders',
	other: 'mentionSectionOther',
};

export function providerMatchesQuery(provider: IKnoxGuiContextProvider, query: string): boolean {
	if (!query) {
		return true;
	}
	const q = query.toLowerCase();
	const title = provider.title.toLowerCase();
	const display = (provider.displayTitle ?? provider.title).toLowerCase();
	return title.startsWith(q) || q.startsWith(title) || display.startsWith(q) || q.startsWith(display) || title.includes(q) || display.includes(q);
}

export function contextProviderToSuggestItem(provider: IKnoxGuiContextProvider): IKnoxGuiSuggestItem {
	return {
		id: provider.title,
		label: provider.displayTitle ?? provider.title,
		description: provider.description,
		itemType: 'contextProvider',
		providerType: provider.type,
		renderInlineAs: provider.renderInlineAs,
		icon: provider.title,
		providerCategory: provider.category,
	};
}

export function fileHitToSuggestItem(hit: { id?: unknown; title?: unknown; path?: unknown; description?: unknown; icon?: unknown; providerTitle?: string; score?: unknown; metadata?: unknown }): IKnoxGuiSuggestItem {
	const id = String(hit.id ?? hit.path ?? hit.title ?? 'file');
	const folder = hit.icon === 'folder';
	const item: IKnoxGuiSuggestItem = {
		id,
		label: String(hit.title ?? hit.path ?? id),
		description: typeof hit.description === 'string' ? hit.description : undefined,
		itemType: folder ? 'folder' : 'file',
		query: id,
		icon: folder ? 'folder' : 'file',
	};
	if (hit.providerTitle) {
		item.providerTitle = hit.providerTitle;
	}
	if (typeof hit.score === 'number') {
		item.score = hit.score;
	}
	if (hit.metadata && typeof hit.metadata === 'object' && (hit.metadata as { truncated?: unknown }).truncated === true) {
		item.truncated = true;
	}
	return item;
}

/** Non-file submenu rows (prompt files, repo maps, custom providers) keep their provider chip type. */
export function submenuHitToSuggestItem(hit: Record<string, unknown>, providerTitle: string): IKnoxGuiSuggestItem {
	const item = fileHitToSuggestItem({
		id: hit.id,
		title: hit.title,
		path: hit.path,
		description: hit.description,
		icon: hit.icon,
		providerTitle,
		score: hit.score,
		metadata: hit.metadata,
	});
	if (providerTitle !== 'file' && hit.icon !== 'folder') {
		item.itemType = providerTitle;
		item.icon = typeof hit.icon === 'string' ? hit.icon : undefined;
	}
	return item;
}

function dedupeSuggest(items: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestItem[] {
	const seen = new Set<string>();
	const out: IKnoxGuiSuggestItem[] = [];
	for (const item of items) {
		const key = item.id || item.label;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}

export function buildTopLevelMentionItems(args: {
	query: string;
	providers: IKnoxGuiContextProvider[];
	files: IKnoxGuiSuggestItem[];
	limit?: number;
}): IKnoxGuiSuggestItem[] {
	const query = args.query.trim();
	const limit = args.limit ?? TOP_LEVEL_MENTION_LIMIT;
	const providerMatches = args.providers
		.filter(provider => providerMatchesQuery(provider, query))
		.map(contextProviderToSuggestItem)
		.sort((a, b) => {
			if (a.id === 'file') {
				return -1;
			}
			if (b.id === 'file') {
				return 1;
			}
			return Number(a.providerCategory === 'integration') - Number(b.providerCategory === 'integration');
		});
	if (!query) {
		return dedupeSuggest([...args.files.slice(0, EMPTY_QUERY_FILE_LIMIT), ...providerMatches]).slice(0, limit);
	}
	const fileCap = Math.max(0, limit - providerMatches.length);
	return dedupeSuggest([...args.files.slice(0, fileCap), ...providerMatches]).slice(0, limit);
}

export function isFolderMentionItem(item: IKnoxGuiSuggestItem): boolean {
	return item.icon === 'folder' || item.itemType === 'folder';
}

export function isPathMentionItem(item: IKnoxGuiSuggestItem): boolean {
	return item.itemType === 'file' || item.itemType === 'folder' || item.icon === 'file' || item.icon === 'folder';
}

export function isOpenableMentionRow(item: IKnoxGuiSuggestItem): boolean {
	if (item.itemType === 'contextProvider' || item.itemType === 'slashCommand') {
		return false;
	}
	return isPathMentionItem(item);
}

export function isMentionUtilityItem(item: IKnoxGuiSuggestItem): boolean {
	return item.id === MENTION_LOADING_ID || item.id === MENTION_TRUNCATED_ID;
}

function mentionBucket(item: IKnoxGuiSuggestItem): KnoxGuiMentionSectionId {
	if (item.itemType === 'contextProvider') {
		return 'providers';
	}
	if (isFolderMentionItem(item)) {
		return 'folders';
	}
	if (isPathMentionItem(item)) {
		return 'files';
	}
	return 'other';
}

function mentionSection(id: KnoxGuiMentionSectionId, items: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestSection | undefined {
	if (!items.length) {
		return undefined;
	}
	return { id, labelKey: MENTION_SECTION_KEYS[id], items };
}

export function groupMentionItems(items: IKnoxGuiSuggestItem[], options: { query?: string; inSubmenu?: string } = {}): IKnoxGuiSuggestSection[] {
	const query = (options.query ?? '').trim();
	const selectable = items.filter(item => !isMentionUtilityItem(item));
	const files: IKnoxGuiSuggestItem[] = [];
	const folders: IKnoxGuiSuggestItem[] = [];
	const providers: IKnoxGuiSuggestItem[] = [];
	const other: IKnoxGuiSuggestItem[] = [];
	const open: IKnoxGuiSuggestItem[] = [];
	for (const item of selectable) {
		const bucket = mentionBucket(item);
		if (!query && !options.inSubmenu && (bucket === 'files' || bucket === 'folders')) {
			open.push(item);
			continue;
		}
		if (bucket === 'files') {
			files.push(item);
		} else if (bucket === 'folders') {
			folders.push(item);
		} else if (bucket === 'providers') {
			providers.push(item);
		} else {
			other.push(item);
		}
	}
	if (options.inSubmenu) {
		return [mentionSection('files', files), mentionSection('folders', folders), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
	}
	if (!query) {
		return [mentionSection('open', open), mentionSection('providers', providers), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
	}
	return [mentionSection('files', files), mentionSection('folders', folders), mentionSection('providers', providers), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
}

export function shouldShowMentionSectionHeaders(sections: IKnoxGuiSuggestSection[], inSubmenu?: string): boolean {
	const labeled = sections.filter(section => section.id !== 'other');
	return inSubmenu ? labeled.length > 1 : labeled.length >= 1;
}

export function shouldLiveSearchMentions(query: string, existing: IKnoxGuiSuggestItem[]): boolean {
	if (query.trim().length < LIVE_MENTION_MIN_QUERY) {
		return false;
	}
	const selectable = existing.filter(item => item.itemType !== 'action');
	if (selectable.length > 0 && selectable.every(item => item.itemType === 'slashCommand')) {
		return false;
	}
	return existing.filter(item => isPathMentionItem(item)).length < LIVE_MENTION_HIT_THRESHOLD;
}

export function mergeLiveMentionItems(existing: IKnoxGuiSuggestItem[], live: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestItem[] {
	const seen = new Set(existing.map(item => item.id || item.label).filter(Boolean));
	const extras = live.filter(item => {
		const key = item.id || item.label;
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return extras.length ? [...existing, ...extras] : existing;
}

export function splitCamelCaseAndNonAlphaNumeric(value: string): string[] {
	return value
		.split(/(?<=[a-z0-9])(?=[A-Z])|[^a-zA-Z0-9]/)
		.filter(token => token.length > 0)
		.map(token => token.toLowerCase());
}

function normalizeMentionText(value: string): string {
	return value.toLowerCase().replace(/\\/g, '/');
}

function pathMatchesQuery(path: string, query: string): 'substring' | 'segments' | false {
	const p = normalizeMentionText(path);
	const q = normalizeMentionText(query);
	if (!q) {
		return false;
	}
	if (p.includes(q)) {
		return 'substring';
	}
	if (!q.includes('/')) {
		return false;
	}
	let from = 0;
	for (const part of q.split('/').filter(Boolean)) {
		const found = p.indexOf(part, from);
		if (found === -1) {
			return false;
		}
		from = found + part.length;
	}
	return 'segments';
}

function camelTokenMatches(title: string, query: string): boolean {
	const q = normalizeMentionText(query);
	return splitCamelCaseAndNonAlphaNumeric(title).some(token => token === q || token.startsWith(q));
}

export function mentionItemMatchesQuery(item: { label: string; description?: string }, query: string): boolean {
	const q = query.trim();
	if (!q) {
		return true;
	}
	const title = normalizeMentionText(item.label);
	const needle = normalizeMentionText(q);
	if (title.includes(needle) || camelTokenMatches(item.label, q)) {
		return true;
	}
	return pathMatchesQuery(item.description ?? '', q) !== false;
}

const MENTION_SCORE_OPEN_FILE = 1_000_000;
const MENTION_SCORE_EXACT = 100_000;
const MENTION_SCORE_PREFIX = 50_000;
const MENTION_SCORE_CAMEL = 25_000;
const MENTION_SCORE_PATH_SUBSTRING = 10_000;
const MENTION_SCORE_PATH_SEGMENTS = 5_000;

export function scoreMentionItem(item: IKnoxGuiSuggestItem & { score?: number }, query: string, openFileIds: Set<string>): number {
	let score = openFileIds.has(item.id) ? MENTION_SCORE_OPEN_FILE : 0;
	const q = query.trim();
	const path = item.description ?? '';
	if (!q) {
		return score - Math.min(path.length, 200);
	}
	const title = normalizeMentionText(item.label);
	const needle = normalizeMentionText(q);
	if (title === needle) {
		score += MENTION_SCORE_EXACT;
	} else if (title.startsWith(needle)) {
		score += MENTION_SCORE_PREFIX;
	} else if (camelTokenMatches(item.label, q)) {
		score += MENTION_SCORE_CAMEL;
	}
	const pathHit = pathMatchesQuery(path, q);
	if (pathHit === 'substring') {
		score += MENTION_SCORE_PATH_SUBSTRING;
	} else if (pathHit === 'segments') {
		score += MENTION_SCORE_PATH_SEGMENTS;
	}
	score += Math.min(item.score ?? 0, 999);
	return score - Math.min(path.length, 200);
}

/**
 * File-picker order: open files, exact basename, prefix / camelCase token,
 * path match; files beat folders on a tie, then shorter paths.
 */
export function rankMentionItems<T extends IKnoxGuiSuggestItem & { score?: number }>(items: T[], query: string, openFileIds: Iterable<string> = []): T[] {
	const open = openFileIds instanceof Set ? openFileIds : new Set(openFileIds);
	return [...items].sort((a, b) => {
		const delta = scoreMentionItem(b, query, open) - scoreMentionItem(a, query, open);
		if (delta !== 0) {
			return delta;
		}
		const folderDelta = Number(isFolderMentionItem(a)) - Number(isFolderMentionItem(b));
		if (folderDelta !== 0) {
			return folderDelta;
		}
		const pathDelta = (a.description ?? '').length - (b.description ?? '').length;
		if (pathDelta !== 0) {
			return pathDelta;
		}
		return a.label.localeCompare(b.label);
	});
}

function uriPath(uri: string): string {
	return uri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/\\/g, '/');
}

function relativePathOrBasename(uri: string, dirs: string[]): string {
	const path = uriPath(uri);
	for (const dir of dirs) {
		const base = uriPath(dir).replace(/\/+$/, '');
		if (base && path.startsWith(`${base}/`)) {
			return path.slice(base.length + 1);
		}
	}
	return path.split('/').pop() ?? path;
}

/** Last `n` segments of the workspace-relative path (`getLastNUriRelativePathParts`). */
export function lastRelativePathParts(uri: string, dirs: string[], n: number): string {
	return relativePathOrBasename(uri, dirs).split('/').slice(-n).join('/');
}

/** Shortest path suffix that is unique among `uris`, relative to the workspace. */
export function shortestUniqueRelativePaths(uris: string[], dirs: string[]): Array<{ uri: string; uniquePath: string }> {
	const counts = new Map<string, number>();
	const info = uris.map(uri => {
		const relative = relativePathOrBasename(uri, dirs);
		const segments = relative.split('/');
		const suffixes: string[] = [];
		for (let i = segments.length - 1; i >= 0; i--) {
			const suffix = segments.slice(i).join('/');
			suffixes.push(suffix);
			counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
		}
		return { uri, relative, suffixes };
	});
	return info.map(({ uri, relative, suffixes }) => ({
		uri,
		uniquePath: suffixes.find(suffix => counts.get(suffix) === 1) ?? relative,
	}));
}

export function openFileSuggestItems(uris: string[], dirs: string[]): IKnoxGuiSuggestItem[] {
	return shortestUniqueRelativePaths(uris, dirs).map(({ uri, uniquePath }) => ({
		id: uri,
		label: uriPath(uri).split('/').pop() || uri,
		description: uniquePath,
		itemType: 'file',
		query: uri,
		icon: 'file',
	}));
}

export function openFilesChanged(next: string[], previous: string[]): boolean {
	if (next.length !== previous.length) {
		return true;
	}
	const old = new Set(previous);
	return next.some(uri => !old.has(uri));
}

/** Open files that match `query` and are not already in `rows`, appended for ranking. */
export function mergeOpenFileMentions(rows: IKnoxGuiSuggestItem[], openFiles: IKnoxGuiSuggestItem[], query: string): IKnoxGuiSuggestItem[] {
	const seen = new Set(rows.map(row => row.id));
	const extras = openFiles.filter(open => !seen.has(open.id) && mentionItemMatchesQuery(open, query));
	return extras.length ? [...rows, ...extras] : rows;
}

export function mentionItemKey(item: IKnoxGuiSuggestItem): string {
	return item.id || item.query || item.label;
}

/** Keep the same row selected when the list refreshes underneath it. */
export function nextMentionSelectedIndex(items: IKnoxGuiSuggestItem[], previousItems: IKnoxGuiSuggestItem[], previousIndex: number): number {
	if (!items.length) {
		return 0;
	}
	const prev = previousItems[previousIndex];
	if (!prev) {
		return 0;
	}
	const key = mentionItemKey(prev);
	const next = items.findIndex(item => mentionItemKey(item) === key);
	return next >= 0 ? next : 0;
}

/** Keep the last rows while a refetch is in flight so the panel does not blink. */
export function retainMentionItemsWhileLoading(incoming: IKnoxGuiSuggestItem[], previous: IKnoxGuiSuggestItem[], loading: boolean): IKnoxGuiSuggestItem[] {
	const selectable = incoming.filter(item => !isMentionUtilityItem(item));
	if (!selectable.length && previous.length && (loading || incoming.some(item => item.id === MENTION_LOADING_ID))) {
		return previous;
	}
	return incoming;
}

export function isPathMentionNode(node: { itemType?: string; icon?: string }): boolean {
	return node.itemType === 'file' || node.itemType === 'folder' || node.icon === 'file' || node.icon === 'folder';
}

export function isFolderMentionNode(node: { itemType?: string; icon?: string }): boolean {
	return node.itemType === 'folder' || node.icon === 'folder';
}

/** File and folder chips open in the editor; provider chips (diff, problems) do not. */
export function mentionChipOpenUri(node: { itemType?: string; icon?: string; query?: string; id?: string }): string | undefined {
	if (!isPathMentionNode(node)) {
		return undefined;
	}
	const uri = (node.query || node.id || '').trim();
	return uri || undefined;
}

/** Chip hover text: description, else the clean path of the file URI. */
export function mentionChipTooltip(node: { itemType?: string; icon?: string; query?: string; id?: string; description?: string }): string | undefined {
	const description = node.description?.trim();
	if (description) {
		return description;
	}
	const uri = mentionChipOpenUri(node);
	if (!uri) {
		return undefined;
	}
	const path = uriPath(uri);
	return path || uri;
}

export function mentionChipFilename(node: { label?: string; description?: string; id?: string }): string {
	return node.label || node.description || node.id || '';
}

export type MentionHighlightSegment = { text: string; matched: boolean };

export function highlightMentionMatch(text: string, query: string): MentionHighlightSegment[] {
	if (!text) {
		return [{ text: '', matched: false }];
	}
	const needle = query.trim();
	if (!needle) {
		return [{ text, matched: false }];
	}
	const idx = text.toLowerCase().indexOf(needle.toLowerCase());
	if (idx !== -1) {
		return [
			...(idx > 0 ? [{ text: text.slice(0, idx), matched: false }] : []),
			{ text: text.slice(idx, idx + needle.length), matched: true },
			...(idx + needle.length < text.length ? [{ text: text.slice(idx + needle.length), matched: false }] : []),
		];
	}
	return [{ text, matched: false }];
}

export function mentionIndexIsTruncated(items: Array<{ id?: string; truncated?: boolean; truncatedCount?: number }>): { truncated: boolean; count: number } {
	const marker = items.find(item => item.id === MENTION_TRUNCATED_ID || item.truncated);
	return { truncated: marker !== undefined, count: marker?.truncatedCount ?? 10_000 };
}

export function truncatedMentionMarker(count: number): IKnoxGuiSuggestItem {
	return { id: MENTION_TRUNCATED_ID, label: '', itemType: 'action', truncated: true, truncatedCount: count };
}
