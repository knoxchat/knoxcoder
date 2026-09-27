/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { BOOKMARK_KEY, asRecord, asArray } from './helpers.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { findMatchingHistoryIndexes } from '../../../common/knoxGuiChat.js';
import { appendMentionChip, appendTriggerToDoc, applySuggestToDoc, appendTextToDoc, buildTopLevelMentionItems, clearMentionQuery, detectComposerTrigger, EMPTY_QUERY_FILE_LIMIT, fileHitToSuggestItem, filterProvidersForMode, insertCodeBlock, inputDocFromPlainText, isMentionUtilityItem, LIVE_MENTION_DEBOUNCE_MS, LIVE_MENTION_SEARCH_CAP, mergeContextProvidersWithDefaults, mergeLiveMentionItems, mergeSlashCommandsWithBuiltins, rankSlashCommands, shouldLiveSearchMentions, slashCommandBareName, slashCommandToSuggestItem, TOP_LEVEL_MENTION_LIMIT, truncatedMentionMarker } from '../../../common/knoxGuiInput.js';
import { mergeCodeToEdit, parseCodeToEdit } from '../../../common/knoxGuiEdit.js';
import { appendNewPromptFileMentionAction, formatPromptCommandName, isNewPromptFileMentionAction } from '../../../common/knoxGuiOverlays.js';
import { IKnoxGuiFindState, IKnoxGuiSuggestItem } from '../../../common/knoxGuiState.js';
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
	controller.store.setInputDoc(appendTriggerToDoc(controller.store.state.inputDoc, '@'));
	controller.store.patch({ inputFocused: true, mentionOpen: true, slashOpen: false, suggestSubmenu: title, suggestSubmenuTitle: title, suggestQuery: '' });
	void controller.loadMentions('');
}

export function toggleBookmark(controller: KnoxGuiController, name: string): void {
	const current = controller.store.state.bookmarkedSlash;
	const next = current.includes(name) ? current.filter(item => item !== name): [...current, name];
	controller.store.patch({ bookmarkedSlash: next });
	controller.storageService.store(BOOKMARK_KEY, next.join(','), StorageScope.PROFILE, StorageTarget.USER);
}

export function updateFind(controller: KnoxGuiController, partial: Partial<IKnoxGuiFindState>): void { // KN-377
	const find = { ...controller.store.state.find, ...partial };
	const matchIndexes = findMatchingHistoryIndexes(controller.store.state.history, find.query, { caseSensitive: find.caseSensitive, regex: find.regex });
	const current = matchIndexes.length ? Math.min(find.current, matchIndexes.length - 1): 0;
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

export async function loadMentions(controller: KnoxGuiController, query: string): Promise<void> {
	// KN-374: composer @ picker always includes KN-300 defaults even before config hydrates.
	controller.store.patch({ mentionOpen: true, slashOpen: false, suggestQuery: query, suggestLoading: true });
	const providers = filterProvidersForMode(mergeContextProvidersWithDefaults(controller.store.state.contextProviders), controller.store.state.mode);
	const submenu = controller.store.state.suggestSubmenu;
	if (submenu) {
		const promptFileAction = {
			title: knoxGuiT(controller.store.state.language, 'addNewPromptFile'),
			description: knoxGuiT(controller.store.state.language, 'createNewPromptFile'),
		};
		try {
			const files = await controller.messenger.request<Array<Record<string, unknown>>>('context/loadSubmenuItems', { title: submenu, query });
			controller.store.patch({
				suggestItems: appendNewPromptFileMentionAction(
					asArray(files).map(file => fileHitToSuggestItem(asRecord(file) ?? {})),
					controller.store.state.suggestSubmenuTitle,
					submenu,
					promptFileAction,
				),
				suggestLoading: false,
				suggestSelected: 0,
			});
		} catch {
			controller.store.patch({
				suggestItems: appendNewPromptFileMentionAction([], controller.store.state.suggestSubmenuTitle, submenu, promptFileAction),
				suggestLoading: false,
			});
		}
		return;
	}
	let files: ReturnType<typeof fileHitToSuggestItem>[] = [];
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
	const items = buildTopLevelMentionItems({ query, providers, files });
	const cap = query ? TOP_LEVEL_MENTION_LIMIT : EMPTY_QUERY_FILE_LIMIT;
	if (files.length >= cap) {
		items.push(truncatedMentionMarker(files.length));
	}
	controller.store.patch({ suggestItems: items, suggestLoading: false, suggestSelected: 0 });
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
		bookmarked: controller.store.state.bookmarkedSlash.includes(item.name) || controller.store.state.bookmarkedSlash.includes(slashCommandBareName(item.name)),
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

export function applySuggest(controller: KnoxGuiController, item: IKnoxGuiSuggestItem): void {
	if (isMentionUtilityItem(item)) {
		return;
	}
	if (isNewPromptFileMentionAction(item)) {
		controller.messenger.post('config/newPromptFile', undefined);
		controller.store.setInputDoc(clearMentionQuery(controller.store.state.inputDoc));
		controller.closeSuggest();
		return;
	}
	if (controller.store.state.mentionOpen && item.itemType === 'contextProvider' && item.providerType === 'submenu') {
		controller.store.setInputDoc(clearMentionQuery(controller.store.state.inputDoc));
		controller.store.patch({
			suggestSubmenu: item.id,
			suggestSubmenuTitle: item.id === 'file' ? undefined : item.label,
			suggestSelected: 0,
		});
		void controller.loadMentions('');
		return;
	}
	const kind = controller.store.state.slashOpen ? 'slash' : 'mention';
	controller.store.setInputDoc(applySuggestToDoc(controller.store.state.inputDoc, item, kind));
	if (kind === 'slash') {
		const name = slashCommandBareName(item.id || item.label);
		controller.store.patch({ recentSlash: [name, ...controller.store.state.recentSlash.filter(existing => existing !== name)].slice(0, 8) });
	}
	controller.closeSuggest();
}

export function closeSuggest(controller: KnoxGuiController): void {
	if (controller.mentionLiveTimer) {
		clearTimeout(controller.mentionLiveTimer);
		controller.mentionLiveTimer = undefined;
	}
	controller.store.patch({
		mentionOpen: false,
		slashOpen: false,
		suggestItems: [],
		suggestQuery: '',
		suggestSelected: 0,
		suggestSubmenu: undefined,
		suggestSubmenuTitle: undefined,
		suggestLoading: false,
	});
}

export function exitSuggestSubmenu(controller: KnoxGuiController): void {
	controller.store.patch({ suggestSubmenu: undefined, suggestSubmenuTitle: undefined, suggestSelected: 0 });
	void controller.loadMentions('');
}

export function onComposerInput(controller: KnoxGuiController): void {
	const trigger = detectComposerTrigger(controller.store.state.inputDoc);
	if (trigger?.kind === 'mention') {
		void controller.loadMentions(trigger.query);
	} else if (trigger?.kind === 'slash') {
		void controller.loadSlash(trigger.query);
	} else if (controller.store.state.mentionOpen || controller.store.state.slashOpen) {
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

export async function submitEditedUser(controller: KnoxGuiController, index: number, doc: ReturnType<typeof inputDocFromPlainText>, images?: string[]): Promise<void> {
	await controller.submit(undefined, { index, doc, images });
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
				addFileOpen: false,
			});
		} catch {
			controller.store.patch({ codeToEdit: mergeCodeToEdit(controller.store.state.codeToEdit, { filepath: uri }), addFileOpen: false });
		}
	}
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
	controller.store.setInputDoc(insertCodeBlock(controller.store.state.inputDoc, {
		type: 'codeBlock',
		filepath,
		code: contents,
		itemName: filepath,
	}));
	if (typeof rec.prompt === 'string' && rec.prompt) {
		controller.store.setInputDoc(appendTextToDoc(controller.store.state.inputDoc, rec.prompt));
	}
	controller.store.patch({ inputFocused: true });
	if (rec.shouldRun) {
		void controller.submit();
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
