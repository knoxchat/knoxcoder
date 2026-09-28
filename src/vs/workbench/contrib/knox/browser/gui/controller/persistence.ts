/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';
import { composerInputHistoryFromStorage, type IKnoxGuiComposerInputHistory, type IKnoxGuiInputBlock } from '../../../common/knoxGuiInput.js';
import { KNOX_AUTOSAVE_DEBOUNCE_MS, KNOX_AUTOSAVE_MIN_INTERVAL_MS, KNOX_PERSIST_THROTTLE_MS, knoxGuiParseDraftSession, knoxGuiParseLastActiveSession, knoxGuiParsePersistedTabs, knoxGuiParsePersistedUi, knoxGuiParseProfilePreferences, knoxGuiProfilePreferences, knoxGuiSerializeDraftSession, knoxGuiSerializePersistedUi, type IKnoxGuiDraftSession, type IKnoxGuiLastActiveSession, type IKnoxGuiProfilePreferences } from '../../../common/knoxGuiPersist.js';
import { BOOKMARK_KEY } from './helpers.js';
import { KNOX_GUI_MAIN_TEXT_ENTRY_KEY, KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY, knoxGuiNextMainTextEntry, knoxGuiParseMainTextEntryCount } from '../../../common/knoxGuiChrome.js';

export const UI_STATE_KEY = 'knox.gui.uiState';
export const TABS_KEY = 'knox.gui.tabs';
export const LAST_ACTIVE_SESSION_KEY = 'knox.gui.lastActiveSession';
export const DRAFT_SESSION_KEY = 'knox.gui.draftSession';
export const PROFILE_PREFERENCES_KEY = 'knox.gui.profilePreferences';

export function restorePersistedState(controller: KnoxGuiController): void {
	const ui = knoxGuiParsePersistedUi(controller.storageService.get(UI_STATE_KEY, StorageScope.PROFILE));
	const tabs = knoxGuiParsePersistedTabs(controller.storageService.get(TABS_KEY, StorageScope.WORKSPACE));
	controller.store.patch({ ...ui, ...(tabs ?? {}) });
}

/** `useInputHistory.ts`: one history per composer mode, `inputHistory_chat` / `inputHistory_edit`. */
function inputHistoryKey(kind: 'chat' | 'edit'): string {
	return `knox.gui.inputHistory.${kind}`;
}

export function loadInputHistory(controller: KnoxGuiController, kind: 'chat' | 'edit'): IKnoxGuiComposerInputHistory {
	return composerInputHistoryFromStorage(controller.storageService.get(inputHistoryKey(kind), StorageScope.PROFILE));
}

export function saveInputHistory(controller: KnoxGuiController, kind: 'chat' | 'edit', entries: IKnoxGuiInputBlock[][]): void {
	controller.storageService.store(inputHistoryKey(kind), JSON.stringify(entries), StorageScope.PROFILE, StorageTarget.MACHINE);
}

/** `pages/error.tsx`: the reset button drops `persist:root` and `inputHistory_chat`. */
export function resetPersistedState(controller: KnoxGuiController): void {
	const storage = controller.storageService;
	storage.remove(UI_STATE_KEY, StorageScope.PROFILE);
	storage.remove(TABS_KEY, StorageScope.WORKSPACE);
	storage.remove(LAST_ACTIVE_SESSION_KEY, StorageScope.WORKSPACE);
	storage.remove(DRAFT_SESSION_KEY, StorageScope.WORKSPACE);
	storage.remove(PROFILE_PREFERENCES_KEY, StorageScope.PROFILE);
	storage.remove(inputHistoryKey('chat'), StorageScope.PROFILE);
}

export function draftSession(controller: KnoxGuiController): IKnoxGuiDraftSession | undefined {
	return knoxGuiParseDraftSession(controller.storageService.get(DRAFT_SESSION_KEY, StorageScope.WORKSPACE));
}

function allProfilePreferences(controller: KnoxGuiController): Record<string, IKnoxGuiProfilePreferences> {
	return knoxGuiParseProfilePreferences(controller.storageService.get(PROFILE_PREFERENCES_KEY, StorageScope.PROFILE));
}

/**
 * `initializeProfilePreferencesThunk`. Bookmarks saved before preferences were
 * kept per profile seed the first profile that has none.
 */
export function loadProfilePreferences(controller: KnoxGuiController, profileId: string): IKnoxGuiProfilePreferences {
	const all = allProfilePreferences(controller);
	if (!all[profileId]) {
		const legacy = controller.storageService.get(BOOKMARK_KEY, StorageScope.PROFILE, '');
		if (legacy) {
			all[profileId] = { bookmarkedSlashCommands: legacy.split(',').filter(Boolean), recentSlashCommands: [] };
			controller.storageService.store(PROFILE_PREFERENCES_KEY, JSON.stringify(all), StorageScope.PROFILE, StorageTarget.USER);
			controller.storageService.remove(BOOKMARK_KEY, StorageScope.PROFILE);
		}
	}
	return knoxGuiProfilePreferences(all, profileId);
}

/** Bookmark and recent changes are no-ops for storage until a profile is selected, as in `profilesSlice`. */
export function saveProfilePreferences(controller: KnoxGuiController): void {
	const { profileId, bookmarkedSlash, recentSlash } = controller.store.state;
	if (!profileId) {
		return;
	}
	const all = allProfilePreferences(controller);
	all[profileId] = { bookmarkedSlashCommands: bookmarkedSlash, recentSlashCommands: recentSlash };
	controller.storageService.store(PROFILE_PREFERENCES_KEY, JSON.stringify(all), StorageScope.PROFILE, StorageTarget.USER);
}

export function noteMainComposerSend(controller: KnoxGuiController): boolean {
	const storage = controller.storageService;
	const shown = storage.get(KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY, StorageScope.PROFILE) === 'true';
	const count = knoxGuiParseMainTextEntryCount(storage.get(KNOX_GUI_MAIN_TEXT_ENTRY_KEY, StorageScope.PROFILE));
	const next = knoxGuiNextMainTextEntry(count, shown);
	if (next.count !== count) {
		storage.store(KNOX_GUI_MAIN_TEXT_ENTRY_KEY, String(next.count), StorageScope.PROFILE, StorageTarget.MACHINE);
	}
	if (next.shown && !shown) {
		storage.store(KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY, 'true', StorageScope.PROFILE, StorageTarget.MACHINE);
	}
	return next.open;
}

export function lastActiveSession(controller: KnoxGuiController): IKnoxGuiLastActiveSession | undefined {
	return knoxGuiParseLastActiveSession(controller.storageService.get(LAST_ACTIVE_SESSION_KEY, StorageScope.WORKSPACE));
}

/**
 * Write-through for persisted UI state, tabs and the last active session, plus
 * `autoSaveSessionMiddleware.ts`: history edits save after a 2 s debounce, at
 * most every 5 s, never while streaming. Loading or switching sessions does not
 * schedule a save.
 */
export function installPersistence(controller: KnoxGuiController): IDisposable {
	const storage = controller.storageService;
	let lastUi = knoxGuiSerializePersistedUi(controller.store.state);
	let lastTabs = '';
	let lastActive = '';
	let lastSessionId = controller.store.state.sessionId;
	let lastHistory = controller.store.state.history;
	let lastTitle = controller.store.state.sessionTitle;
	let lastSaveAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastDraft = '';
	let lastStreaming = controller.store.state.isStreaming;
	let draftTimer: ReturnType<typeof setTimeout> | undefined;

	const writeDraft = () => {
		draftTimer = undefined;
		const state = controller.store.state;
		if (state.isStreaming || !state.sessionId) {
			return;
		}
		const draft = knoxGuiSerializeDraftSession(state);
		if (draft !== lastDraft) {
			lastDraft = draft;
			storage.store(DRAFT_SESSION_KEY, draft, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	};

	const scheduleSave = () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			const state = controller.store.state;
			if (Date.now() - lastSaveAt < KNOX_AUTOSAVE_MIN_INTERVAL_MS || !state.history.length || state.isStreaming) {
				return;
			}
			lastSaveAt = Date.now();
			void controller.saveCurrentSession({ generateTitle: false });
		}, KNOX_AUTOSAVE_DEBOUNCE_MS);
	};

	const listener = controller.store.onDidChange(state => {
		if (knoxGuiIsDedicatedEditor(state)) {
			return;
		}
		const ui = knoxGuiSerializePersistedUi(state);
		if (ui !== lastUi) {
			lastUi = ui;
			storage.store(UI_STATE_KEY, ui, StorageScope.PROFILE, StorageTarget.USER);
		}
		if (!state.setupComplete) {
			return;
		}
		const tabs = JSON.stringify({ tabs: state.tabs, activeTabId: state.activeTabId });
		if (tabs !== lastTabs) {
			lastTabs = tabs;
			storage.store(TABS_KEY, tabs, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		const active = JSON.stringify({ sessionId: state.sessionId, isEmpty: state.history.length === 0 });
		if (state.sessionId && !state.isLoadingHistory && active !== lastActive) {
			lastActive = active;
			storage.store(LAST_ACTIVE_SESSION_KEY, active, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		const switched = state.sessionId !== lastSessionId || state.isLoadingHistory;
		const edited = state.history !== lastHistory || state.sessionTitle !== lastTitle;
		const streamEnded = lastStreaming && !state.isStreaming;
		lastStreaming = state.isStreaming;
		if ((edited || streamEnded || state.sessionId !== lastSessionId) && !state.isLoadingHistory && !draftTimer) {
			draftTimer = setTimeout(writeDraft, KNOX_PERSIST_THROTTLE_MS);
		}
		lastSessionId = state.sessionId;
		lastHistory = state.history;
		lastTitle = state.sessionTitle;
		if (edited && !switched) {
			scheduleSave();
		}
	});

	return toDisposable(() => {
		listener.dispose();
		if (timer) {
			clearTimeout(timer);
		}
		if (draftTimer) {
			clearTimeout(draftTimer);
			writeDraft();
		}
	});
}
