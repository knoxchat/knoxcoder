/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KNOX_GUI_OVERLAYS, KnoxGuiOverlay } from './knoxGuiProtocol.js';
import { IKnoxGuiHistoryItem, IKnoxGuiSessionTab, IKnoxGuiState, KnoxChatMode, KnoxGuiLanguage, KnoxPermissionMode, KnoxToolSetting } from './knoxGuiState.js';

/** `redux/store.ts` persisted `ui` subset plus `session.mode`. */
export interface IKnoxGuiPersistedUi {
	toolSettings: Record<string, KnoxToolSetting>;
	toolGroupExcluded: string[];
	webSearchEnabled: boolean;
	permissionMode: KnoxPermissionMode;
	/** `session.mode`, including `edit`: redux-persist keeps it "in case the window closes mid-edit". */
	mode: KnoxChatMode;
	/** `session.codeToEdit` (persisted together with the mode). */
	codeToEdit: IKnoxGuiState['codeToEdit'];
	/** `ui.selectedBlockSettingsSection`. */
	overlay: KnoxGuiOverlay;
}

/** `profiles.preferencesByProfileId` entry. */
export interface IKnoxGuiProfilePreferences {
	bookmarkedSlashCommands: string[];
	recentSlashCommands: string[];
}

/** `session` subset kept by redux-persist: the current chat survives a reload before it is saved. */
export interface IKnoxGuiDraftSession {
	sessionId: string;
	title: string;
	history: IKnoxGuiHistoryItem[];
}

/** `persistControl.ts`: session writes are throttled and paused while streaming. */
export const KNOX_PERSIST_THROTTLE_MS = 2000;

/** `util/lastActiveSession.ts`, stored per workspace. */
export interface IKnoxGuiLastActiveSession {
	sessionId: string;
	isEmpty: boolean;
}

export interface IKnoxGuiPersistedTabs {
	tabs: IKnoxGuiSessionTab[];
	activeTabId: string;
}

/** `i18n.ts:applyUserLanguage`: a stored choice wins, otherwise `zh*` locales get Chinese. */
export function knoxGuiResolveLanguage(stored: string | undefined, locale: string): KnoxGuiLanguage {
	if (stored === 'en' || stored === 'zh') {
		return stored;
	}
	return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** `autoSaveSessionMiddleware.ts`. */
export const KNOX_AUTOSAVE_DEBOUNCE_MS = 2000;
export const KNOX_AUTOSAVE_MIN_INTERVAL_MS = 5000;

const TOOL_SETTINGS = new Set<string>(['allowedWithPermission', 'allowedWithoutPermission', 'disabled']);
const PERMISSION_MODES = new Set<string>(['default', 'acceptEdits', 'fullAuto']);
const PERSISTED_MODES = new Set<string>(['chat', 'agent', 'edit']);

function parseJson(raw: string | undefined): Record<string, unknown> | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const value = JSON.parse(raw);
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

export function knoxGuiSerializePersistedUi(state: IKnoxGuiState): string {
	const ui: IKnoxGuiPersistedUi = {
		toolSettings: state.toolSettings,
		toolGroupExcluded: state.toolGroupExcluded,
		webSearchEnabled: state.webSearchEnabled,
		permissionMode: state.permissionMode,
		mode: state.mode,
		codeToEdit: state.codeToEdit,
		overlay: state.overlay,
	};
	return JSON.stringify(ui);
}

/** Only well-formed fields come back. */
export function knoxGuiParsePersistedUi(raw: string | undefined): Partial<IKnoxGuiPersistedUi> {
	const rec = parseJson(raw);
	if (!rec) {
		return {};
	}
	const out: Partial<IKnoxGuiPersistedUi> = {};
	const settings = rec.toolSettings;
	if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
		const toolSettings: Record<string, KnoxToolSetting> = {};
		for (const [name, value] of Object.entries(settings as Record<string, unknown>)) {
			if (typeof value === 'string' && TOOL_SETTINGS.has(value)) {
				toolSettings[name] = value as KnoxToolSetting;
			}
		}
		out.toolSettings = toolSettings;
	}
	if (Array.isArray(rec.toolGroupExcluded)) {
		out.toolGroupExcluded = rec.toolGroupExcluded.filter((group): group is string => typeof group === 'string');
	}
	if (typeof rec.webSearchEnabled === 'boolean') {
		out.webSearchEnabled = rec.webSearchEnabled;
	}
	if (typeof rec.permissionMode === 'string' && PERMISSION_MODES.has(rec.permissionMode)) {
		out.permissionMode = rec.permissionMode as KnoxPermissionMode;
	}
	if (typeof rec.mode === 'string' && PERSISTED_MODES.has(rec.mode)) {
		out.mode = rec.mode as KnoxChatMode;
	}
	if (Array.isArray(rec.codeToEdit)) {
		out.codeToEdit = rec.codeToEdit.filter((code): code is IKnoxGuiState['codeToEdit'][number] => {
			const entry = code as Record<string, unknown> | null;
			return Boolean(entry) && typeof entry === 'object' && typeof entry!.filepath === 'string' && entry!.filepath !== '';
		});
	}
	if (rec.overlay === null || (typeof rec.overlay === 'string' && (KNOX_GUI_OVERLAYS as readonly string[]).includes(rec.overlay))) {
		out.overlay = rec.overlay as KnoxGuiOverlay;
	}
	return out;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function knoxGuiParseProfilePreferences(raw: string | undefined): Record<string, IKnoxGuiProfilePreferences> {
	const rec = parseJson(raw);
	const out: Record<string, IKnoxGuiProfilePreferences> = {};
	for (const [profileId, value] of Object.entries(rec ?? {})) {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const prefs = value as Record<string, unknown>;
			out[profileId] = {
				bookmarkedSlashCommands: stringList(prefs.bookmarkedSlashCommands),
				recentSlashCommands: stringList(prefs.recentSlashCommands),
			};
		}
	}
	return out;
}

/**
 * `initializeProfilePreferences`: a profile seen for the first time starts with
 * no bookmarks (the reference passes no default slash commands) and no recents.
 */
export function knoxGuiProfilePreferences(all: Record<string, IKnoxGuiProfilePreferences>, profileId: string): IKnoxGuiProfilePreferences {
	return all[profileId] ?? { bookmarkedSlashCommands: [], recentSlashCommands: [] };
}

/** `stripPromptLogs.ts`: prompt logs never reach persisted history; a live thinking block is closed. */
export function knoxGuiSerializeDraftSession(state: Pick<IKnoxGuiState, 'sessionId' | 'sessionTitle' | 'history'>): string {
	const draft: IKnoxGuiDraftSession = {
		sessionId: state.sessionId,
		title: state.sessionTitle,
		history: state.history.map(item => {
			const { promptLogs: _promptLogs, ...rest } = item;
			return rest.thinkingActive ? { ...rest, thinkingActive: false } : rest;
		}),
	};
	return JSON.stringify(draft);
}

const HISTORY_ROLES = new Set<string>(['user', 'assistant', 'system', 'thinking', 'tool']);

export function knoxGuiParseDraftSession(raw: string | undefined): IKnoxGuiDraftSession | undefined {
	const rec = parseJson(raw);
	if (!rec || typeof rec.sessionId !== 'string' || !rec.sessionId || !Array.isArray(rec.history)) {
		return undefined;
	}
	const history = rec.history.filter((item): item is IKnoxGuiHistoryItem => {
		const entry = item as Record<string, unknown> | null;
		return Boolean(entry) && typeof entry === 'object'
			&& typeof entry!.id === 'string'
			&& typeof entry!.role === 'string' && HISTORY_ROLES.has(entry!.role)
			&& typeof entry!.content === 'string';
	});
	return { sessionId: rec.sessionId, title: typeof rec.title === 'string' ? rec.title : '', history };
}

export function knoxGuiParseLastActiveSession(raw: string | undefined): IKnoxGuiLastActiveSession | undefined {
	const rec = parseJson(raw);
	return rec && typeof rec.sessionId === 'string' && typeof rec.isEmpty === 'boolean'
		? { sessionId: rec.sessionId, isEmpty: rec.isEmpty }
		: undefined;
}

export function knoxGuiParsePersistedTabs(raw: string | undefined): IKnoxGuiPersistedTabs | undefined {
	const rec = parseJson(raw);
	if (!rec || !Array.isArray(rec.tabs)) {
		return undefined;
	}
	const tabs = rec.tabs
		.filter((tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === 'object')
		.filter(tab => typeof tab.id === 'string' && typeof tab.title === 'string')
		.map(tab => ({ id: String(tab.id), title: String(tab.title), sessionId: typeof tab.sessionId === 'string' ? tab.sessionId : undefined }));
	if (!tabs.length) {
		return undefined;
	}
	const activeTabId = typeof rec.activeTabId === 'string' && tabs.some(tab => tab.id === rec.activeTabId) ? rec.activeTabId : tabs[0].id;
	return { tabs, activeTabId };
}

/** `selectProfileThunk`: no profiles clears the id; an unknown or empty id falls back to the first profile. */
export function knoxGuiResolveProfileId(available: readonly string[], requested: string | null | undefined): string | null {
	if (!available.length) {
		return null;
	}
	return requested && available.includes(requested) ? requested : available[0];
}

/** Same comparison as core `history.ts` list: drop `file://` and a trailing slash. */
export function knoxGuiNormalizeWorkspace(path: string | undefined): string {
	return (path ?? '').replace(/^file:\/\//, '').replace(/\/$/, '');
}

/**
 * `useSetup.ts` initial workspace load: keep an intentionally empty New Chat,
 * otherwise reopen the last active session if it belongs to this workspace,
 * otherwise the newest workspace session. Without a workspace only the last
 * active session is reopened (the reference rehydrates it from storage).
 */
export function knoxGuiStartupSession(params: {
	workspace: string;
	lastActive: IKnoxGuiLastActiveSession | undefined;
	sessions: ReadonlyArray<{ id: string }>;
}): string | undefined {
	if (params.lastActive?.isEmpty) {
		return undefined;
	}
	const last = params.lastActive?.sessionId;
	if (last && params.sessions.some(session => session.id === last)) {
		return last;
	}
	if (!params.workspace) {
		return undefined;
	}
	return params.sessions.length ? params.sessions[0].id : undefined;
}
