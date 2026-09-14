/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxNls } from './knoxI18n.js';
import type { IKnoxContextProviderDescription } from './knoxChatTypes.js';

/** Visible rows in the top-level @ dropdown. */
export const TOP_LEVEL_MENTION_LIMIT = 40;

/** Open/recent files shown when the query is empty (do not dump the whole index). */
export const EMPTY_QUERY_FILE_LIMIT = 8;

export const LIVE_MENTION_MIN_QUERY = 2;
export const LIVE_MENTION_HIT_THRESHOLD = 8;
export const LIVE_MENTION_DEBOUNCE_MS = 150;
export const LIVE_MENTION_SEARCH_CAP = 200;

export const MENTION_LOADING_ID = 'loading';
export const MENTION_TRUNCATED_ID = 'mention-truncated';
export const MENTION_NEW_PROMPT_FILE_ID = 'knox-new-prompt-file';
export const KNOX_PROMPT_FILE_SUBMENU_TITLE = '.prompt file';

export const KNOX_MENTION_ENTER_SUBMENU_COMMAND_ID = 'knox.native.mention.enterSubmenu';
export const KNOX_MENTION_NEW_PROMPT_FILE_COMMAND_ID = 'knox.native.mention.newPromptFile';
export const KNOX_MENTION_ACCEPT_CHIP_COMMAND_ID = 'knox.native.mention.acceptChip';
export const KNOX_MENTION_QUERY_PROVIDER_COMMAND_ID = 'knox.native.mention.queryProvider';

export const SUBMENU_HIT_LIMIT = 70;

export type KnoxMentionItemType =
	| 'contextProvider'
	| 'slashCommand'
	| 'file'
	| 'query'
	| 'folder'
	| 'action';

export type KnoxMentionActionId = 'newPromptFile' | 'enterSubmenu' | 'openFile' | 'queryProvider';

export interface IKnoxMentionItem {
	title: string;
	description: string;
	id?: string;
	type: KnoxMentionItemType;
	contextProvider?: IKnoxContextProviderDescription;
	query?: string;
	label?: string;
	icon?: string;
	renderInlineAs?: string;
	actionId?: KnoxMentionActionId;
	score?: number;
	providerTitle?: string;
	metadata?: {
		truncated?: boolean;
		truncatedCount?: number;
	};
}

export type KnoxMentionSectionId = 'open' | 'files' | 'folders' | 'providers' | 'other';

export interface IKnoxMentionSection {
	id: KnoxMentionSectionId;
	labelKey: string;
	items: IKnoxMentionItem[];
}

export interface IKnoxMentionChip {
	id: string;
	label: string;
	itemType: string;
	query?: string;
	renderInlineAs?: string;
	icon?: string;
	description?: string;
}

export interface IKnoxMentionTrigger {
	/** 0-based offset of the `@`. */
	at: number;
	query: string;
}

export type KnoxMentionListKeyAction =
	| { type: 'move'; index: number }
	| { type: 'select' }
	| { type: 'close' }
	| { type: 'ignore' };

const OPEN_FILE = 1_000_000;
const EXACT_BASENAME = 100_000;
const BASENAME_PREFIX = 50_000;
const CAMEL_TOKEN = 25_000;
const PATH_SUBSTRING = 10_000;
const PATH_SEGMENTS = 5_000;

const SECTION_LABEL_KEYS: Record<KnoxMentionSectionId, string> = {
	open: 'mentionSectionOpen',
	files: 'mentionSectionFiles',
	folders: 'mentionSectionFolders',
	providers: 'mentionSectionProviders',
	other: 'mentionSectionOther',
};

const OPENABLE_MENTION_ITEM_TYPES = new Set(['file', 'folder']);

export function knoxSplitCamelCaseAndNonAlphaNumeric(value: string): string[] {
	return value
		.split(/(?<=[a-z0-9])(?=[A-Z])|[^a-zA-Z0-9]/)
		.filter(token => token.length > 0)
		.map(token => token.toLowerCase());
}

export function knoxMentionOptionId(index: number): string {
	return `mention-option-${index}`;
}

export function wrapMentionIndex(current: number, total: number, delta: number): number {
	if (total <= 0) {
		return 0;
	}
	return (current + delta + total) % total;
}

export function jumpMentionIndex(total: number, to: 'home' | 'end'): number {
	if (total <= 0) {
		return 0;
	}
	return to === 'home' ? 0 : total - 1;
}

export function mentionListKeyAction(
	key: string,
	selectedIndex: number,
	total: number,
): KnoxMentionListKeyAction {
	switch (key) {
		case 'ArrowUp':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, -1) };
		case 'ArrowDown':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, 1) };
		case 'Home':
			return { type: 'move', index: jumpMentionIndex(total, 'home') };
		case 'End':
			return { type: 'move', index: jumpMentionIndex(total, 'end') };
		case 'Enter':
		case 'Tab':
			return { type: 'select' };
		case 'Escape':
			return { type: 'close' };
		case ' ':
			return total === 1 ? { type: 'select' } : { type: 'ignore' };
		default:
			return { type: 'ignore' };
	}
}

export function knoxMentionContextProviderName(item: {
	id?: string;
	itemType?: string | null;
}): string {
	if (item.itemType === 'file' || item.itemType === 'folder') {
		return 'file';
	}
	if (item.itemType === 'contextProvider' || !item.itemType) {
		return item.id ?? '';
	}
	return item.itemType;
}

export function isFolderMention(attrs: { itemType?: string | null; icon?: string | null }): boolean {
	return attrs.itemType === 'folder' || attrs.icon === 'folder';
}

export function isPathMention(attrs: { itemType?: string | null; icon?: string | null }): boolean {
	return OPENABLE_MENTION_ITEM_TYPES.has(attrs.itemType ?? '')
		|| attrs.icon === 'file'
		|| attrs.icon === 'folder';
}

export function getMentionOpenUri(attrs: {
	itemType?: string | null;
	icon?: string | null;
	query?: string | null;
	id?: string | null;
}): string | null {
	if (!isPathMention(attrs)) {
		return null;
	}
	const uri = (attrs.query || attrs.id || '').trim();
	return uri.length > 0 ? uri : null;
}

export function mentionChipLabel(
	attrs: { label?: string | null; id?: string | null; renderInlineAs?: string | null },
	char = '@',
): string {
	if (typeof attrs.renderInlineAs === 'string' && attrs.renderInlineAs.length > 0) {
		return attrs.renderInlineAs;
	}
	return `${char}${attrs.label ?? attrs.id ?? ''}`;
}

export function mentionChipTooltip(attrs: {
	description?: string | null;
	itemType?: string | null;
	icon?: string | null;
	query?: string | null;
	id?: string | null;
}): string | undefined {
	const description = attrs.description?.trim();
	if (description) {
		return description;
	}
	return getMentionOpenUri(attrs) ?? undefined;
}

export function knoxMentionInsertText(item: IKnoxMentionItem, query?: string): string {
	if (item.type === 'action' || item.actionId === 'enterSubmenu' || item.actionId === 'newPromptFile') {
		return '';
	}
	if (item.actionId === 'queryProvider') {
		if (!query?.trim()) {
			return '';
		}
		const label = item.label ?? item.title;
		return `@${label}: ${query.trim()} `;
	}
	return `${mentionChipLabel({
		label: item.label ?? item.title,
		id: item.id,
		renderInlineAs: item.renderInlineAs,
	})} `;
}

export function knoxMentionChipFromItem(item: IKnoxMentionItem, query?: string): IKnoxMentionChip {
	const label = query?.trim()
		? `${item.label ?? item.title}: ${query.trim()}`
		: (item.label ?? item.title);
	return {
		id: item.id ?? item.title,
		label,
		itemType: item.type,
		query: query ?? item.query,
		renderInlineAs: item.renderInlineAs,
		icon: item.icon,
		description: item.description,
	};
}

/**
 * Mention trigger at `offset` (0-based, exclusive end). Mentions do not cross
 * spaces or newlines, matching TipTap `allow()`.
 */
export function knoxMentionTriggerAt(text: string, offset: number): IKnoxMentionTrigger | undefined {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let at = -1;
	for (let i = clamped - 1; i >= 0; i--) {
		const ch = text.charAt(i);
		if (ch === '@') {
			at = i;
			break;
		}
		if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
			return undefined;
		}
	}
	if (at < 0) {
		return undefined;
	}
	return { at, query: text.slice(at + 1, clamped) };
}

export function providerMatchesQuery(
	provider: IKnoxContextProviderDescription,
	query: string,
): boolean {
	if (!query) {
		return true;
	}
	const q = query.toLowerCase();
	const title = provider.title.toLowerCase();
	const display = provider.displayTitle.toLowerCase();
	return title.startsWith(q) || display.startsWith(q) || title.includes(q) || display.includes(q);
}

export function pathMentionItemType(
	icon: string | undefined,
	fallback: KnoxMentionItemType = 'file',
): KnoxMentionItemType {
	return icon === 'folder' ? 'folder' : fallback;
}

export function isFolderMentionItem(item: IKnoxMentionItem): boolean {
	return item.icon === 'folder' || item.type === 'folder';
}

export function isPathMentionItem(item: IKnoxMentionItem): boolean {
	return item.type === 'file' || item.type === 'folder' || item.icon === 'file' || item.icon === 'folder';
}

export function isMentionUtilityItem(item: IKnoxMentionItem): boolean {
	return item.id === MENTION_LOADING_ID || item.id === MENTION_TRUNCATED_ID;
}

export function isOpenableMentionRow(item: { type?: string; icon?: string }): boolean {
	if (item.type === 'contextProvider' || item.type === 'slashCommand') {
		return false;
	}
	return item.type === 'file' || item.type === 'folder' || item.icon === 'file' || item.icon === 'folder';
}

export function knoxMentionSubAction(item: {
	id?: string;
	query?: string;
	type?: string;
	icon?: string;
}): 'openFile' | undefined {
	const uri = (item.query || item.id || '').trim();
	if (!uri || !isOpenableMentionRow(item)) {
		return undefined;
	}
	return 'openFile';
}

export function attachMentionSubActions(items: IKnoxMentionItem[]): IKnoxMentionItem[] {
	return items.map(item => {
		if (item.actionId) {
			return item;
		}
		const actionId = knoxMentionSubAction(item);
		return actionId ? { ...item, actionId } : item;
	});
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/\\/g, '/');
}

function pathMatchesQuery(path: string, query: string): 'substring' | 'segments' | false {
	const p = normalize(path);
	const q = normalize(query);
	if (!q) {
		return false;
	}
	if (p.includes(q)) {
		return 'substring';
	}
	if (!q.includes('/')) {
		return false;
	}
	const parts = q.split('/').filter(Boolean);
	let from = 0;
	for (const part of parts) {
		const found = p.indexOf(part, from);
		if (found === -1) {
			return false;
		}
		from = found + part.length;
	}
	return 'segments';
}

function camelTokenMatches(title: string, query: string): boolean {
	const q = normalize(query);
	return knoxSplitCamelCaseAndNonAlphaNumeric(title).some(token => token === q || token.startsWith(q));
}

export function mentionItemMatchesQuery(
	item: { title: string; description?: string },
	query: string,
): boolean {
	const q = query.trim();
	if (!q) {
		return true;
	}
	const title = normalize(item.title);
	const needle = normalize(q);
	if (title === needle || title.startsWith(needle) || title.includes(needle)) {
		return true;
	}
	if (camelTokenMatches(item.title, q)) {
		return true;
	}
	return pathMatchesQuery(item.description ?? '', q) !== false;
}

export function scoreMentionItem(
	item: IKnoxMentionItem,
	query: string,
	openFileIds: Set<string>,
): number {
	let score = 0;
	if (item.id && openFileIds.has(item.id)) {
		score += OPEN_FILE;
	}

	const q = query.trim();
	const path = item.description ?? '';
	if (!q) {
		score -= Math.min(path.length, 200);
		return score;
	}

	const title = normalize(item.title);
	const needle = normalize(q);

	if (title === needle) {
		score += EXACT_BASENAME;
	} else if (title.startsWith(needle)) {
		score += BASENAME_PREFIX;
	} else if (camelTokenMatches(item.title, q)) {
		score += CAMEL_TOKEN;
	}

	const pathHit = pathMatchesQuery(path, q);
	if (pathHit === 'substring') {
		score += PATH_SUBSTRING;
	} else if (pathHit === 'segments') {
		score += PATH_SEGMENTS;
	}

	score += Math.min(item.score ?? 0, 999);
	score -= Math.min(path.length, 200);
	return score;
}

export function rankMentionItems(
	items: IKnoxMentionItem[],
	query: string,
	openFileIds: Iterable<string> = [],
): IKnoxMentionItem[] {
	const open = openFileIds instanceof Set ? openFileIds : new Set(openFileIds);
	return [...items].sort((a, b) => {
		const scoreDelta = scoreMentionItem(b, query, open) - scoreMentionItem(a, query, open);
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		const folderDelta = Number(isFolderMentionItem(a)) - Number(isFolderMentionItem(b));
		if (folderDelta !== 0) {
			return folderDelta;
		}
		const pathDelta = (a.description ?? '').length - (b.description ?? '').length;
		if (pathDelta !== 0) {
			return pathDelta;
		}
		return a.title.localeCompare(b.title);
	});
}

function bucketOf(item: IKnoxMentionItem): KnoxMentionSectionId {
	if (item.type === 'contextProvider') {
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

function section(id: KnoxMentionSectionId, items: IKnoxMentionItem[]): IKnoxMentionSection | undefined {
	if (items.length === 0) {
		return undefined;
	}
	return { id, labelKey: SECTION_LABEL_KEYS[id], items };
}

export function groupMentionItems(
	items: IKnoxMentionItem[],
	options: { query?: string; inSubmenu?: string } = {},
): IKnoxMentionSection[] {
	const query = (options.query ?? '').trim();
	const selectable = items.filter(item => !isMentionUtilityItem(item));

	const files: IKnoxMentionItem[] = [];
	const folders: IKnoxMentionItem[] = [];
	const providers: IKnoxMentionItem[] = [];
	const other: IKnoxMentionItem[] = [];
	const open: IKnoxMentionItem[] = [];

	for (const item of selectable) {
		const bucket = bucketOf(item);
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
		return [section('files', files), section('folders', folders), section('other', other)]
			.filter((row): row is IKnoxMentionSection => row != null);
	}

	if (!query) {
		return [section('open', open), section('providers', providers), section('other', other)]
			.filter((row): row is IKnoxMentionSection => row != null);
	}

	return [
		section('files', files),
		section('folders', folders),
		section('providers', providers),
		section('other', other),
	].filter((row): row is IKnoxMentionSection => row != null);
}

export function shouldShowMentionSectionHeaders(
	sections: Array<{ id: string }>,
	inSubmenu?: string,
): boolean {
	const labeled = sections.filter(row => row.id !== 'other');
	if (inSubmenu) {
		return labeled.length > 1;
	}
	return labeled.length >= 1;
}

export function mentionIndexIsTruncated(
	items: Array<{ id?: string; metadata?: IKnoxMentionItem['metadata'] }>,
): { truncated: boolean; count: number } {
	const marker = items.find(item => item.id === MENTION_TRUNCATED_ID || item.metadata?.truncated === true);
	return {
		truncated: marker != null,
		count: marker?.metadata?.truncatedCount ?? 10_000,
	};
}

export function knoxMentionSectionLabel(id: KnoxMentionSectionId): string {
	switch (id) {
		case 'open': return knoxNls('mentionSectionOpen');
		case 'files': return knoxNls('mentionSectionFiles');
		case 'folders': return knoxNls('mentionSectionFolders');
		case 'providers': return knoxNls('mentionSectionProviders');
		case 'other': return knoxNls('other');
	}
}

function sortProviders(a: IKnoxMentionItem, b: IKnoxMentionItem): number {
	if (a.id === 'file') {
		return -1;
	}
	if (b.id === 'file') {
		return 1;
	}
	const aIntegration = a.contextProvider?.category === 'integration' ? 1 : 0;
	const bIntegration = b.contextProvider?.category === 'integration' ? 1 : 0;
	return aIntegration - bIntegration;
}

function providerToMention(provider: IKnoxContextProviderDescription): IKnoxMentionItem {
	return {
		description: provider.description,
		id: provider.title,
		title: provider.displayTitle,
		label: provider.displayTitle,
		type: 'contextProvider',
		contextProvider: provider,
		renderInlineAs: provider.renderInlineAs,
		actionId: provider.type === 'submenu'
			? 'enterSubmenu'
			: provider.type === 'query'
				? 'queryProvider'
				: undefined,
	};
}

export function submenuItemToMention(
	result: { id: string; title: string; description: string; icon?: string; providerTitle?: string; score?: number },
	fallbackType: KnoxMentionItemType = 'file',
): IKnoxMentionItem {
	return {
		id: result.id,
		title: result.title,
		description: result.description,
		label: result.title,
		type: pathMentionItemType(result.icon, fallbackType),
		query: result.id,
		icon: result.icon,
		providerTitle: result.providerTitle,
		score: result.score,
		actionId: knoxMentionSubAction({
			id: result.id,
			query: result.id,
			type: pathMentionItemType(result.icon, fallbackType),
			icon: result.icon,
		}),
	};
}

function dedupeById(items: IKnoxMentionItem[]): IKnoxMentionItem[] {
	const seen = new Set<string>();
	const out: IKnoxMentionItem[] = [];
	for (const item of items) {
		const key = item.id ?? item.title;
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
	providers: IKnoxContextProviderDescription[];
	submenuItems: Array<{ id?: string; title: string; description: string; icon?: string; providerTitle?: string; score?: number }>;
	limit?: number;
}): IKnoxMentionItem[] {
	const query = args.query.trim();
	const limit = args.limit ?? TOP_LEVEL_MENTION_LIMIT;

	const providerMatches = args.providers
		.filter(provider => providerMatchesQuery(provider, query))
		.map(providerToMention)
		.sort(sortProviders);

	const fileHits = args.submenuItems
		.filter((item): item is { id: string; title: string; description: string; icon?: string; providerTitle?: string; score?: number } => typeof item.id === 'string')
		.map(item => submenuItemToMention(item));

	if (!query) {
		return dedupeById([
			...fileHits.slice(0, EMPTY_QUERY_FILE_LIMIT),
			...providerMatches,
		]).slice(0, limit);
	}

	const fileCap = Math.max(0, limit - providerMatches.length);
	return dedupeById([
		...fileHits.slice(0, fileCap),
		...providerMatches,
	]).slice(0, limit);
}

export function knoxSubmenuHits(args: {
	query: string;
	submenu?: string;
	itemsByProvider: Record<string, IKnoxMentionItem[]>;
	openFiles: IKnoxMentionItem[];
	limit?: number;
	truncated?: boolean;
}): IKnoxMentionItem[] {
	const query = args.query.trim();
	const limit = args.limit ?? SUBMENU_HIT_LIMIT;
	const includeOpenFiles = !args.submenu || args.submenu === 'file';
	const openFileIds = new Set(args.openFiles.map(item => item.id).filter((id): id is string => !!id));

	const pool = args.submenu
		? (args.itemsByProvider[args.submenu] ?? [])
		: Object.values(args.itemsByProvider).flat();

	const matching = pool.filter(item => mentionItemMatchesQuery(item, query));
	const seen = new Set(matching.map(item => item.id ?? item.title));
	if (includeOpenFiles) {
		for (const open of args.openFiles) {
			const key = open.id ?? open.title;
			if (seen.has(key) || !mentionItemMatchesQuery(open, query)) {
				continue;
			}
			matching.push(open);
			seen.add(key);
		}
	}

	const ranked = rankMentionItems(matching, query, openFileIds).slice(0, limit);
	if (args.truncated && (!args.submenu || args.submenu === 'file')) {
		ranked.push({
			id: MENTION_TRUNCATED_ID,
			title: '',
			description: '',
			type: 'action',
			metadata: { truncated: true, truncatedCount: 10_000 },
		});
	}
	return ranked;
}

export function knoxLoadingMentionItem(): IKnoxMentionItem {
	return {
		id: MENTION_LOADING_ID,
		title: knoxNls('loading'),
		description: knoxNls('loadingItemsPleaseWait'),
		type: 'action',
	};
}

export function shouldOfferNewPromptFile(submenuTitle: string | undefined, submenuId: string | undefined): boolean {
	return submenuTitle === KNOX_PROMPT_FILE_SUBMENU_TITLE || submenuId === 'prompts';
}

export function knoxNewPromptFileItem(): IKnoxMentionItem {
	return {
		id: MENTION_NEW_PROMPT_FILE_ID,
		title: knoxNls('addNewPromptFile'),
		description: knoxNls('createNewPromptFile'),
		type: 'action',
		actionId: 'newPromptFile',
	};
}

export function liveSubmenuItemToMention(item: {
	id: string;
	title: string;
	description: string;
	icon?: string;
}): IKnoxMentionItem {
	return submenuItemToMention(item);
}

export function mergeLiveMentionItems(
	existing: IKnoxMentionItem[],
	live: IKnoxMentionItem[],
): IKnoxMentionItem[] {
	const seen = new Set(existing.map(item => item.id ?? item.title).filter(Boolean));
	const extras = live.filter(item => {
		const key = item.id ?? item.title;
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return extras.length ? [...existing, ...extras] : existing;
}

export function shouldLiveSearchMentions(query: string, existing: IKnoxMentionItem[]): boolean {
	if (query.trim().length < LIVE_MENTION_MIN_QUERY) {
		return false;
	}
	const selectable = existing.filter(item => item.type !== 'action');
	if (selectable.length > 0 && selectable.every(item => item.type === 'slashCommand')) {
		return false;
	}
	return existing.filter(item => isPathMentionItem(item)).length < LIVE_MENTION_HIT_THRESHOLD;
}

export function mergeMatchingLiveMentionItems(
	existing: IKnoxMentionItem[],
	live: IKnoxMentionItem[],
	query: string,
): IKnoxMentionItem[] {
	if (!shouldLiveSearchMentions(query, existing)) {
		return existing;
	}
	const extras = live.filter(item => mentionItemMatchesQuery(item, query));
	return mergeLiveMentionItems(existing, extras);
}

export function createKnoxDebouncedLiveFileSearch(
	request: (query: string, limit: number) => Promise<IKnoxMentionItem[]>,
	waitMs: number = LIVE_MENTION_DEBOUNCE_MS,
): (query: string) => Promise<IKnoxMentionItem[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let waiters: Array<{
		resolve: (items: IKnoxMentionItem[]) => void;
		reject: (err: unknown) => void;
	}> = [];

	return (query: string) => new Promise<IKnoxMentionItem[]>((resolve, reject) => {
		waiters.push({ resolve, reject });
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			const current = waiters;
			waiters = [];
			void (async () => {
				try {
					const items = await request(query, LIVE_MENTION_SEARCH_CAP);
					current.forEach(waiter => waiter.resolve(items));
				} catch (err) {
					current.forEach(waiter => waiter.reject(err));
				}
			})();
		}, waitMs);
	});
}

export function knoxFlattenMentionSections(sections: IKnoxMentionSection[]): IKnoxMentionItem[] {
	return sections.flatMap(section => section.items);
}

export function knoxSelectableMentionItems(items: IKnoxMentionItem[]): IKnoxMentionItem[] {
	return items.filter(item => !isMentionUtilityItem(item));
}
