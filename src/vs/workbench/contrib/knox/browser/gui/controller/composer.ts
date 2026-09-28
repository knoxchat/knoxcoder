/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { saveProfilePreferences } from './persistence.js';
import { findMatchingHistoryIndexes } from '../../../common/knoxGuiChat.js';
import { appendMentionChip, appendTriggerToDoc, applySuggestAt, appendTextToDoc, buildTopLevelMentionItems, clearMentionQueryAt, detectComposerTrigger, docEndCaret, EMPTY_QUERY_FILE_LIMIT, fileHitToSuggestItem, filterProvidersForMode, IKnoxGuiDocCaret, IKnoxGuiInputBlock, insertCodeBlock, inputDocFromPlainText, isFolderMentionItem, isMentionUtilityItem, isSlashBookmarked, LIVE_MENTION_DEBOUNCE_MS, LIVE_MENTION_SEARCH_CAP, mentionItemMatchesQuery, mergeContextProvidersWithDefaults, mergeLiveMentionItems, mergeOpenFileMentions, mergeSlashCommandsWithBuiltins, nextMentionSelectedIndex, openFilesChanged, openFileSuggestItems, rankMentionItems, rankSlashCommands, removeCodeToEditTrigger, shouldLiveSearchMentions, slashCommandBareName, slashCommandToSuggestItem, submenuHitToSuggestItem, toggleSlashBookmark, TOP_LEVEL_MENTION_LIMIT, truncatedMentionMarker } from '../../../common/knoxGuiInput.js';
import { mergeCodeToEdit, parseCodeToEdit } from '../../../common/knoxGuiEdit.js';
import { appendNewPromptFileMentionAction, formatPromptCommandName, isNewPromptFileMentionAction } from '../../../common/knoxGuiOverlays.js';
import { IKnoxGuiContextProvider, IKnoxGuiFindState, IKnoxGuiSuggestItem } from '../../../common/knoxGuiState.js';
import { knoxGuiT } from '../knoxGuiI18n.js';

export function savePrompt(controller: KnoxGuiController, draft: { name: string; description: string; prompt: string }): void {
	controller.messenger.post('config/addPrompt', {
		name: formatPromptCommandName(draft.name),
		description: draft.description.trim(),
		prompt: draft.prompt.trim(),
	});
	controller.store.patch({ promptDraft: undefined });
}

export function insertContextProvider(controller: KnoxGuiController, title: string): void {
	controller.store.setOverlay(null);
	const doc = appendTriggerToDoc(controller.store.state.inputDoc, '@');
	setComposerDoc(controller, { doc, caret: docEndCaret(doc) });
	controller.store.patch({ inputFocused: true, mentionOpen: true, slashOpen: false, suggestSubmenu: title, suggestSubmenuTitle: title, suggestQuery: '' });
	void controller.loadMentions('');
}

export function toggleBookmark(controller: KnoxGuiController, name: string): void {
	const next = toggleSlashBookmark(controller.store.state.bookmarkedSlash, name);
	controller.store.patch({ bookmarkedSlash: next });
	saveProfilePreferences(controller);
}

/**
 * `FindWidget.tsx`: no matches while streaming; a new query, option or open
 * jumps to the closest (latest) match once the query is longer than one character.
 */
export function updateFind(controller: KnoxGuiController, partial: Partial<IKnoxGuiFindState>): void { // KN-377
	const previous = controller.store.state.find;
	const find = { ...previous, ...partial };
	const matchIndexes = controller.store.state.isStreaming || !find.open
		? []
		: findMatchingHistoryIndexes(controller.store.state.history, find.query, { caseSensitive: find.caseSensitive, regex: find.regex });
	const closest = find.query !== previous.query || find.caseSensitive !== previous.caseSensitive || find.regex !== previous.regex || (find.open && !previous.open);
	let current = matchIndexes.length ? Math.min(find.current, matchIndexes.length - 1) : 0;
	if (closest && matchIndexes.length) {
		current = find.query.length > 1 ? matchIndexes.length - 1 : 0;
	}
	controller.store.patch({ find: { ...find, matchIndexes, total: matchIndexes.length, current } });
}

export function openFind(controller: KnoxGuiController): void {
	controller.updateFind({ open: true });
}

export function closeFind(controller: KnoxGuiController): void {
	controller.store.patch({ find: { ...controller.store.state.find, open: false } });
}

export function stepFind(controller: KnoxGuiController, delta: number): void {
	const find = controller.store.state.find;
	if (!find.matchIndexes.length) {
		controller.updateFind({});
		return;
	}
	const next = (find.current + delta + find.matchIndexes.length) % find.matchIndexes.length;
	controller.store.patch({ find: { ...find, current: next } });
}

/** Rows per submenu, matching `MAX_LENGTH` in the reference submenu search. */
const SUBMENU_MENTION_LIMIT = 70;
const OPEN_FILES_POLL_MS = 2000;

async function loadSubmenuRows(controller: KnoxGuiController, title: string): Promise<IKnoxGuiSuggestItem[]> {
	const cached = controller.submenuItems.get(title);
	if (cached) {
		return cached;
	}
	try {
		const raw = await controller.messenger.request<Array<Record<string, unknown>>>('context/loadSubmenuItems', { title, query: '' });
		const rows = asArray(raw).map(hit => submenuHitToSuggestItem(asRecord(hit) ?? {}, title));
		controller.submenuItems.set(title, rows);
		return rows;
	} catch {
		return [];
	}
}

/** Index every non-file submenu provider once per picker session so a top-level query searches them all. */
function ensureSubmenuIndex(controller: KnoxGuiController, providers: IKnoxGuiContextProvider[]): void {
	if (controller.submenuIndexing) {
		return;
	}
	controller.submenuIndexing = true;
	const titles = providers.filter(provider => provider.type === 'submenu' && provider.title !== 'file' && !controller.submenuItems.has(provider.title)).map(provider => provider.title);
	if (!titles.length) {
		return;
	}
	void Promise.allSettled(titles.map(title => loadSubmenuRows(controller, title))).then(() => {
		const state = controller.store.state;
		if (state.mentionOpen && !state.suggestSubmenu && !state.suggestCodeToEdit && state.suggestQuery.trim()) {
			void controller.loadMentions(state.suggestQuery);
		}
	});
}

export async function refreshOpenFiles(controller: KnoxGuiController): Promise<void> {
	try {
		const [uris, dirs] = await Promise.all([
			controller.messenger.request<string[]>('getOpenFiles', undefined),
			controller.messenger.request<string[]>('getWorkspaceDirs', undefined).catch(() => []),
		]);
		const next = asArray(uris).filter((uri): uri is string => typeof uri === 'string');
		if (!openFilesChanged(next, controller.openFileUris)) {
			return;
		}
		controller.openFileUris = next;
		controller.openFileItems = openFileSuggestItems(next, asArray(dirs).filter((dir): dir is string => typeof dir === 'string'));
		const state = controller.store.state;
		if (state.mentionOpen && !state.suggestQueryItem) {
			void controller.loadMentions(state.suggestQuery);
		}
	} catch {
		// open-file ranking is optional
	}
}

/** Poll open editors every 2 s while the `@` / `#` picker is open. */
function startOpenFilesPolling(controller: KnoxGuiController): void {
	if (controller.openFilesTimer) {
		return;
	}
	void controller.refreshOpenFiles();
	controller.openFilesTimer = setInterval(() => void controller.refreshOpenFiles(), OPEN_FILES_POLL_MS);
}

function stopOpenFilesPolling(controller: KnoxGuiController): void {
	if (controller.openFilesTimer) {
		clearInterval(controller.openFilesTimer);
		controller.openFilesTimer = undefined;
	}
}

function patchMentionItems(controller: KnoxGuiController, items: IKnoxGuiSuggestItem[]): void {
	const state = controller.store.state;
	controller.store.patch({
		suggestItems: items,
		suggestLoading: false,
		suggestSelected: nextMentionSelectedIndex(items, state.suggestItems, state.suggestSelected),
	});
}

export async function loadMentions(controller: KnoxGuiController, query: string): Promise<void> {
	// KN-374: composer @ picker always includes KN-300 defaults even before config hydrates.
	const seq = ++controller.mentionRequestSeq;
	controller.store.patch({ mentionOpen: true, slashOpen: false, suggestQuery: query, suggestLoading: true });
	startOpenFilesPolling(controller);
	const providers = filterProvidersForMode(mergeContextProvidersWithDefaults(controller.store.state.contextProviders), controller.store.state.mode);
	const codeToEdit = controller.store.state.suggestCodeToEdit;
	const submenu = codeToEdit ? 'file' : controller.store.state.suggestSubmenu;
	const openIds = controller.openFileUris;
	if (submenu) {
		const promptFileAction = {
			title: knoxGuiT(controller.store.state.language, 'addNewPromptFile'),
			description: knoxGuiT(controller.store.state.language, 'createNewPromptFile'),
		};
		const rows = await loadSubmenuRows(controller, submenu);
		if (seq !== controller.mentionRequestSeq) {
			return;
		}
		let matches = rows.filter(row => mentionItemMatchesQuery(row, query));
		if (submenu === 'file') {
			matches = mergeOpenFileMentions(matches, controller.openFileItems, query);
		}
		if (codeToEdit) {
			const added = new Set(controller.store.state.codeToEdit.map(code => code.filepath));
			matches = matches.filter(row => !isFolderMentionItem(row) && !added.has(row.id) && !added.has(row.query ?? ''));
		}
		const ranked = rankMentionItems(matches, query, openIds).slice(0, SUBMENU_MENTION_LIMIT);
		if (submenu === 'file' && rows.some(row => row.truncated)) {
			ranked.push(truncatedMentionMarker(rows.length));
		}
		const items = codeToEdit ? ranked : appendNewPromptFileMentionAction(ranked, controller.store.state.suggestSubmenuTitle, submenu, promptFileAction);
		patchMentionItems(controller, items);
		if (submenu === 'file' && shouldLiveSearchMentions(query, items)) {
			controller.scheduleLiveMentionSearch(query, items);
		}
		return;
	}
	ensureSubmenuIndex(controller, providers);
	let files: IKnoxGuiSuggestItem[] = [];
	try {
		const raw = await controller.messenger.request<Array<Record<string, unknown>>>(query ? 'context/searchFiles' : 'context/loadSubmenuItems', query ? { query, limit: 40 } : { title: 'file', query: '' });
		files = asArray(raw).map(file => fileHitToSuggestItem(asRecord(file) ?? {}));
	} catch {
		try {
			const raw = await controller.messenger.request<Array<Record<string, unknown>>>('context/searchFiles', { query, limit: query ? 40 : 8 });
			files = asArray(raw).map(file => fileHitToSuggestItem(asRecord(file) ?? {}));
		} catch {
			files = [];
		}
	}
	if (seq !== controller.mentionRequestSeq) {
		return;
	}
	const truncated = files.some(file => file.truncated);
	let rows = mergeOpenFileMentions(files, controller.openFileItems, query);
	if (query.trim()) {
		const providerTitles = new Set(providers.map(provider => provider.title));
		for (const [title, items] of controller.submenuItems) {
			if (title !== 'file' && providerTitles.has(title)) {
				rows = [...rows, ...items.filter(item => mentionItemMatchesQuery(item, query))];
			}
		}
	}
	const ranked = rankMentionItems(rows, query, openIds);
	const items = buildTopLevelMentionItems({ query, providers, files: ranked });
	const cap = query ? TOP_LEVEL_MENTION_LIMIT : EMPTY_QUERY_FILE_LIMIT;
	if (truncated || files.length >= cap) {
		items.push(truncatedMentionMarker(files.length));
	}
	patchMentionItems(controller, items);
	if (shouldLiveSearchMentions(query, items)) {
		controller.scheduleLiveMentionSearch(query, items);
	}
}

export async function loadSlash(controller: KnoxGuiController, query: string): Promise<void> {
	if (controller.store.state.mode === 'edit') {
		controller.closeSuggest();
		return;
	}
	controller.store.patch({ slashOpen: true, mentionOpen: false, suggestQuery: query, suggestSubmenu: undefined });
	const all = mergeSlashCommandsWithBuiltins(controller.store.state.slashCommands);
	const items = all.map(item => slashCommandToSuggestItem(item, {
		bookmarked: isSlashBookmarked(controller.store.state.bookmarkedSlash, item.name),
		recent: controller.store.state.recentSlash.includes(slashCommandBareName(item.name)),
		recentIndex: controller.store.state.recentSlash.indexOf(slashCommandBareName(item.name)),
	}));
	controller.store.patch({
		suggestItems: rankSlashCommands(items, query),
		suggestSelected: 0,
		suggestLoading: false,
	});
}

export function insertSuggest(controller: KnoxGuiController, item: IKnoxGuiSuggestItem): void {
	controller.applySuggest(item);
}

/** Doc of the editor that owns the picker: a history message editor or the main composer. */
function targetDoc(controller: KnoxGuiController): IKnoxGuiInputBlock[] {
	const target = controller.suggestTarget;
	return target && controller.historyComposer ? controller.historyComposer.doc(target) : controller.store.state.inputDoc;
}

function setComposerDoc(controller: KnoxGuiController, next: { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret }): void {
	controller.composerCaret = next.caret;
	const target = controller.suggestTarget;
	if (target && controller.historyComposer) {
		controller.historyComposer.set(target, next.doc, next.caret);
		return;
	}
	controller.pendingComposerCaret = next.caret;
	controller.store.setInputDoc(next.doc);
}

/** After a pick, focus returns to the editor that opened the picker. */
function refocusTarget(controller: KnoxGuiController): void {
	if (!controller.suggestTarget) {
		controller.store.patch({ inputFocused: true });
	}
}

export function applySuggest(controller: KnoxGuiController, item: IKnoxGuiSuggestItem): void {
	if (isMentionUtilityItem(item)) {
		return;
	}
	const state = controller.store.state;
	const doc = targetDoc(controller);
	if (isNewPromptFileMentionAction(item)) {
		controller.messenger.post('config/newPromptFile', undefined);
		setComposerDoc(controller, clearMentionQueryAt(doc, controller.composerCaret));
		controller.closeSuggest();
		return;
	}
	if (state.suggestCodeToEdit) {
		setComposerDoc(controller, removeCodeToEditTrigger(doc, controller.composerCaret));
		controller.closeSuggest();
		controller.store.patch({ inputFocused: true });
		void controller.addFilesToEdit([item.query || item.id]);
		return;
	}
	if (state.mentionOpen && item.itemType === 'contextProvider' && item.providerType === 'submenu') {
		setComposerDoc(controller, clearMentionQueryAt(doc, controller.composerCaret));
		controller.store.patch({
			suggestSubmenu: item.id,
			suggestSubmenuTitle: item.id === 'file' ? undefined : item.label,
			suggestSelected: 0,
		});
		void controller.loadMentions('');
		return;
	}
	if (state.mentionOpen && item.itemType === 'contextProvider' && item.providerType === 'query') {
		controller.store.patch({ suggestQueryItem: item, suggestSubmenuTitle: item.label });
		return;
	}
	const kind = state.slashOpen ? 'slash' : 'mention';
	setComposerDoc(controller, applySuggestAt(doc, item, kind, controller.composerCaret));
	if (kind === 'slash') {
		const name = slashCommandBareName(item.id || item.label);
		controller.store.patch({ recentSlash: [name, ...controller.store.state.recentSlash.filter(existing => existing !== name)].slice(0, 8) });
		saveProfilePreferences(controller);
	}
	refocusTarget(controller);
	controller.closeSuggest();
}

/** Query providers insert a `Title: query` chip once the query box is submitted. */
export function submitQueryProvider(controller: KnoxGuiController, value: string): void {
	const item = controller.store.state.suggestQueryItem;
	if (!item) {
		return;
	}
	controller.store.patch({ suggestQueryItem: undefined });
	controller.applySuggest({
		...item,
		providerType: 'normal',
		query: value,
		label: `${item.label}: ${value}`,
	});
}

export function cancelQueryProvider(controller: KnoxGuiController): void {
	controller.store.patch({ suggestQueryItem: undefined, suggestSubmenuTitle: undefined, inputFocused: !controller.suggestTarget });
}

export function closeSuggest(controller: KnoxGuiController): void {
	if (controller.mentionLiveTimer) {
		clearTimeout(controller.mentionLiveTimer);
		controller.mentionLiveTimer = undefined;
	}
	stopOpenFilesPolling(controller);
	controller.mentionRequestSeq++;
	controller.submenuItems.clear();
	controller.submenuIndexing = false;
	controller.suggestTarget = undefined;
	controller.store.patch({
		mentionOpen: false,
		slashOpen: false,
		suggestItems: [],
		suggestQuery: '',
		suggestSelected: 0,
		suggestSubmenu: undefined,
		suggestSubmenuTitle: undefined,
		suggestLoading: false,
		suggestQueryItem: undefined,
		suggestCodeToEdit: false,
	});
}

export function exitSuggestSubmenu(controller: KnoxGuiController): void {
	controller.store.patch({ suggestSubmenu: undefined, suggestSubmenuTitle: undefined, suggestQueryItem: undefined, suggestSelected: 0 });
	void controller.loadMentions('');
}

export function onComposerInput(controller: KnoxGuiController, caret?: IKnoxGuiDocCaret, target?: string): void {
	controller.composerCaret = caret;
	const state = controller.store.state;
	if ((state.mentionOpen || state.slashOpen) && controller.suggestTarget !== target) {
		controller.closeSuggest();
	}
	controller.suggestTarget = target;
	const trigger = detectComposerTrigger(targetDoc(controller), caret, { mode: target ? 'chat' : state.mode });
	if (trigger?.kind === 'mention') {
		if (state.suggestCodeToEdit) {
			controller.store.patch({ suggestCodeToEdit: false, suggestItems: [] });
		}
		void controller.loadMentions(trigger.query);
	} else if (trigger?.kind === 'codeToEdit') {
		if (!state.suggestCodeToEdit) {
			controller.store.patch({ suggestCodeToEdit: true, suggestSubmenu: undefined, suggestSubmenuTitle: undefined, suggestItems: [] });
		}
		void controller.loadMentions(trigger.query);
	} else if (trigger?.kind === 'slash') {
		void controller.loadSlash(trigger.query);
	} else if (state.mentionOpen || state.slashOpen) {
		controller.closeSuggest();
	}
}

export function beginEditUser(controller: KnoxGuiController, index: number): void {
	const item = controller.store.state.history[index];
	if (!item || item.role !== 'user') {
		return;
	}
	controller.store.patch({
		editingUserIndex: index,
		historicalImages: item.images ?? [],
	});
}

export function cancelEditUser(controller: KnoxGuiController): void {
	controller.store.patch({ editingUserIndex: undefined, historicalImages: [] });
}

export async function submitEditedUser(controller: KnoxGuiController, index: number, doc: ReturnType<typeof inputDocFromPlainText>, images?: string[], altKey?: boolean): Promise<void> {
	await controller.submit(undefined, { index, doc, images, altKey });
}

export function removeHistoricalImage(controller: KnoxGuiController, index: number): void {
	controller.store.patch({ historicalImages: controller.store.state.historicalImages.filter((_, i) => i !== index) });
}

export function removeImage(controller: KnoxGuiController, index: number): void {
	controller.store.patch({ images: controller.store.state.images.filter((_, i) => i !== index) });
}

export function removeContextItem(controller: KnoxGuiController, index: number): void {
	controller.store.patch({ contextItems: controller.store.state.contextItems.filter((_, i) => i !== index) });
}

export function removeCodeToEdit(controller: KnoxGuiController, index: number): void {
	controller.store.patch({ codeToEdit: controller.store.state.codeToEdit.filter((_, i) => i !== index) });
}

export function mentionDroppedFile(controller: KnoxGuiController, uri: string): void {
	const label = uri.split(/[/\\]/).pop() ?? uri;
	controller.store.setInputDoc(appendMentionChip(controller.store.state.inputDoc, { id: uri, label, itemType: 'file', query: uri, icon: 'file' }));
}

export async function searchAddFiles(controller: KnoxGuiController, query: string): Promise<IKnoxGuiSuggestItem[]> {
	try {
		const raw = await controller.messenger.request<Array<Record<string, unknown>>>('context/searchFiles', { query, limit: 40 });
		const existing = new Set(controller.store.state.codeToEdit.map(file => file.filepath));
		return asArray(raw)
			.map(file => fileHitToSuggestItem(asRecord(file) ?? {}))
			.filter(item => !existing.has(item.id) && !existing.has(item.query ?? ''));
	} catch {
		return [];
	}
}

export async function addFilesToEdit(controller: KnoxGuiController, uris: string[]): Promise<void> {
	for (const uri of uris) {
		try {
			const items = await controller.messenger.request<Array<Record<string, unknown>>>('context/getContextItems', {
				name: 'file',
				query: uri,
				fullInput: '',
				selectedCode: [],
				selectedModelTitle: controller.store.state.modelTitle,
			});
			const first = asRecord(asArray(items)[0]);
			controller.store.patch({
				codeToEdit: mergeCodeToEdit(controller.store.state.codeToEdit, { filepath: uri, contents: first?.content ? String(first.content): undefined }),
			});
		} catch {
			controller.store.patch({ codeToEdit: mergeCodeToEdit(controller.store.state.codeToEdit, { filepath: uri }) });
		}
	}
}

export async function addAllOpenFilesToEdit(controller: KnoxGuiController): Promise<void> {
	try {
		const uris = asArray(await controller.messenger.request<string[]>('getOpenFiles', undefined)).filter((uri): uri is string => typeof uri === 'string');
		await controller.addFilesToEdit(uris);
	} catch {
		// no open editors
	}
}

/** Ranges jump to their lines; whole files open in the editor. */
export function openCodeToEdit(controller: KnoxGuiController, code: { filepath: string; range?: { start: { line: number }; end: { line: number } } }): void {
	if (code.range) {
		controller.messenger.post('showLines', { filepath: code.filepath, startLine: code.range.start.line, endLine: code.range.end.line });
		return;
	}
	controller.showFile(code.filepath);
}

export function scheduleLiveMentionSearch(controller: KnoxGuiController, query: string, existing: ReturnType<typeof fileHitToSuggestItem>[]): void {
	if (controller.mentionLiveTimer) {
		clearTimeout(controller.mentionLiveTimer);
	}
	controller.mentionLiveTimer = setTimeout(() => {
		void (async () => {
			try {
				const live = await controller.messenger.request<Array<Record<string, unknown>>>('context/searchFiles', { query, limit: LIVE_MENTION_SEARCH_CAP });
				if (controller.store.state.suggestQuery !== query || !controller.store.state.mentionOpen) {
					return;
				}
				const mapped = asArray(live).map(file => fileHitToSuggestItem(asRecord(file) ?? {}));
				controller.store.patch({ suggestItems: mergeLiveMentionItems(controller.store.state.suggestItems.length ? controller.store.state.suggestItems : existing, mapped) });
			} catch {
				// live search optional
			}
		})();
	}, LIVE_MENTION_DEBOUNCE_MS);
}

export function applyHighlightedCode(controller: KnoxGuiController, rec: Record<string, unknown>): void {
	const rif = asRecord(rec.rangeInFileWithContents) ?? asRecord(rec.rangeInFile) ?? rec;
	const filepath = String(rif?.filepath ?? rec.filepath ?? 'selection');
	const contents = String(rif?.contents ?? rec.contents ?? '');
	const range = asRecord(rif?.range);
	const start = Number(asRecord(range?.start)?.line);
	const end = Number(asRecord(range?.end)?.line);
	controller.store.setInputDoc(insertCodeBlock(controller.store.state.inputDoc, {
		type: 'codeBlock',
		filepath,
		code: contents,
		itemName: filepath,
		...(Number.isFinite(start) && Number.isFinite(end) ? { range: { start, end } } : {}),
	}));
	if (typeof rec.prompt === 'string' && rec.prompt) {
		controller.store.setInputDoc(appendTextToDoc(controller.store.state.inputDoc, rec.prompt));
	}
	controller.store.patch({ inputFocused: true });
	if (rec.shouldRun) {
		void controller.submit(undefined, { noContext: true });
	}
}

export function pushCodeToEdit(controller: KnoxGuiController, rec: Record<string, unknown>): void {
	const code = parseCodeToEdit(rec);
	if (!code) {
		return;
	}
	controller.store.patch({
		codeToEdit: mergeCodeToEdit(controller.store.state.codeToEdit, code),
	});
}
