/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/** Kept for existing `settings.json` keys. The sidebar is always native after T13.5. */
export const KNOX_NATIVE_GUI_SETTING = 'knoxchat.nativeGui';

export function isKnoxNativeGuiEnabled(_value?: unknown): boolean {
	return true;
}

export type KnoxChatMode = 'chat' | 'agent' | 'edit';

export type KnoxPermissionMode = 'default' | 'acceptEdits' | 'fullAuto';

export type KnoxLumpSection = 'models' | 'rules' | 'prompts' | 'tools' | 'history' | 'checkpoints';

/** Full-pane overlay hosted by the native Knox view (not Lump). */
export type KnoxNativeOverlay =
	| 'chat'
	| 'history'
	| 'memory'
	| 'config'
	| 'restore'
	| 'configError'
	| 'addModel'
	| 'configureProvider'
	| 'batchDiff'
	| 'stats';

export type KnoxAutonomousLoopStatus = 'idle' | 'running' | 'completed' | 'cancelled';

export const KNOX_DEFAULT_NATIVE_OVERLAY: KnoxNativeOverlay = 'chat';

export const KNOX_NATIVE_NEW_SESSION_COMMAND_ID = 'knox.native.newSession';
export const KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID = 'knox.native.viewHistory';
export const KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID = 'knox.native.viewMemory';
export const KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID = 'knox.native.openConfig';
export const KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID = 'knox.native.viewConfigError';
export const KNOX_NATIVE_ADD_MODEL_COMMAND_ID = 'knox.native.addModel';
export const KNOX_NATIVE_BATCH_DIFF_COMMAND_ID = 'knox.native.batchDiff';
export const KNOX_NATIVE_VIEW_STATS_COMMAND_ID = 'knox.native.viewStats';
export const KNOX_NATIVE_NAVIGATE_COMMAND_ID = 'knox.native.navigateTo';
export const KNOX_NATIVE_CYCLE_PROFILE_COMMAND_ID = 'knox.native.cycleProfile';
export const KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID = 'knox.native.viewRestore';
export const KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID = 'knox.native.focusInput';
export const KNOX_NATIVE_FOCUS_INPUT_WITHOUT_CLEAR_COMMAND_ID = 'knox.native.focusInputWithoutClear';
export const KNOX_NATIVE_FOCUS_INPUT_WITH_NEW_SESSION_COMMAND_ID = 'knox.native.focusInputWithNewSession';
export const KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID = 'knox.native.focusEdit';
export const KNOX_NATIVE_FOCUS_EDIT_WITHOUT_CLEAR_COMMAND_ID = 'knox.native.focusEditWithoutClear';
export const KNOX_NATIVE_EXIT_EDIT_MODE_COMMAND_ID = 'knox.native.exitEditMode';
export const KNOX_NATIVE_FIND_COMMAND_ID = 'knox.native.findInThread';
export const KNOX_NATIVE_HIDE_FIND_COMMAND_ID = 'knox.native.hideFind';
export const KNOX_NATIVE_FIND_NEXT_COMMAND_ID = 'knox.native.findNext';
export const KNOX_NATIVE_FIND_PREVIOUS_COMMAND_ID = 'knox.native.findPrevious';
export const KNOX_NATIVE_SCROLL_TO_TOP_COMMAND_ID = 'knox.native.scrollToTop';
export const KNOX_NATIVE_SCROLL_TO_BOTTOM_COMMAND_ID = 'knox.native.scrollToBottom';
export const KNOX_NATIVE_STICK_TO_BOTTOM_COMMAND_ID = 'knox.native.stickToBottom';
export const KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID = 'knox.native.cyclePermissionMode';
export const KNOX_NATIVE_CYCLE_MODEL_COMMAND_ID = 'knox.native.cycleChatModel';
export const KNOX_NATIVE_CYCLE_MODEL_PREV_COMMAND_ID = 'knox.native.cycleChatModelPrev';
export const KNOX_NATIVE_APPLY_CODE_COMMAND_ID = 'knox.native.applyCodeFromChat';
export const KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID = 'knox.native.sendUserInput';
export const KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID = 'knox.native.focusSession';

export const KNOX_PERMISSION_MODES: readonly KnoxPermissionMode[] = ['default', 'acceptEdits', 'fullAuto'];

export function knoxNextPermissionMode(current: KnoxPermissionMode): KnoxPermissionMode {
	const idx = KNOX_PERMISSION_MODES.indexOf(current);
	return KNOX_PERMISSION_MODES[(idx + 1) % KNOX_PERMISSION_MODES.length];
}

export const KNOX_WEB_SEARCH_STORAGE_KEY = 'knox.webSearchEnabled';
export const KNOX_REASONING_EFFORT_STORAGE_KEY = 'knox.reasoningEffort';
export const KNOX_REASONING_EFFORT_BY_MODEL_STORAGE_KEY = 'knox.reasoningEffortByModel';
export const KNOX_JOBS_PANEL_STORAGE_KEY = 'knox.jobsPanelOpen';
export const KNOX_GIT_DIFF_PANEL_EXPANDED_KEY = 'knox.gitDiffPanelExpanded';
export const KNOX_LUMP_SECTION_STORAGE_KEY = 'knox.lumpSection';
export const KNOX_TOOL_SETTINGS_STORAGE_KEY = 'knox.toolSettings';
export const KNOX_TOOL_GROUP_SETTINGS_STORAGE_KEY = 'knox.toolGroupSettings';

const NATIVE_OVERLAY_COMMANDS: ReadonlyArray<readonly [string, KnoxNativeOverlay]> = [
	[KNOX_NATIVE_NEW_SESSION_COMMAND_ID, 'chat'],
	[KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID, 'history'],
	[KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID, 'memory'],
	[KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID, 'config'],
	[KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID, 'configError'],
	[KNOX_NATIVE_ADD_MODEL_COMMAND_ID, 'addModel'],
	[KNOX_NATIVE_BATCH_DIFF_COMMAND_ID, 'batchDiff'],
	[KNOX_NATIVE_VIEW_STATS_COMMAND_ID, 'stats'],
	[KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID, 'restore'],
];

export function overlayFromNativeCommand(commandId: string): KnoxNativeOverlay | undefined {
	return NATIVE_OVERLAY_COMMANDS.find(([id]) => id === commandId)?.[1];
}

export function nativeCommandForOverlay(overlay: Exclude<KnoxNativeOverlay, 'chat'>): string | undefined {
	switch (overlay) {
		case 'history': return KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID;
		case 'memory': return KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID;
		case 'config': return KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID;
		case 'configError': return KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID;
		case 'addModel': return KNOX_NATIVE_ADD_MODEL_COMMAND_ID;
		case 'batchDiff': return KNOX_NATIVE_BATCH_DIFF_COMMAND_ID;
		case 'stats': return KNOX_NATIVE_VIEW_STATS_COMMAND_ID;
		case 'restore': return KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID;
		case 'configureProvider': return KNOX_NATIVE_ADD_MODEL_COMMAND_ID;
	}
}

export const KNOX_DEFAULT_CHAT_MODE: KnoxChatMode = 'agent';

export const KNOX_DEFAULT_PERMISSION_MODE: KnoxPermissionMode = 'fullAuto';

export const KNOX_NEW_CHAT_TITLE = localize('knox.newChat', "New Chat");

/** Storage key for the native agent turn-meter expanded preference. */
export const KNOX_ACTIVITY_PANEL_EXPANDED_KEY = 'knox.activityPanelExpanded';

export const KnoxNativeGuiContext = new RawContextKey<boolean>('knox.nativeGui', true, {
	type: 'boolean',
	description: localize('knox.nativeGui', "True when the Knox sidebar uses native workbench widgets."),
});

export const KnoxSessionStreamingContext = new RawContextKey<boolean>('knox.session.streaming', false, {
	type: 'boolean',
	description: localize('knox.session.streaming', "True while the Knox chat session is streaming a response."),
});

export const KnoxModeContext = new RawContextKey<KnoxChatMode>('knox.mode', KNOX_DEFAULT_CHAT_MODE, {
	type: 'string',
	description: localize('knox.mode', "Knox session mode: chat, agent, or edit."),
});

export const KnoxToolPendingContext = new RawContextKey<boolean>('knox.tool.pending', false, {
	type: 'boolean',
	description: localize('knox.tool.pending', "True when a Knox tool call is waiting for user approval."),
});

export const KnoxPermissionModeContext = new RawContextKey<KnoxPermissionMode>('knox.permissionMode', KNOX_DEFAULT_PERMISSION_MODE, {
	type: 'string',
	description: localize('knox.permissionMode', "Knox tool permission mode: default, acceptEdits, or fullAuto."),
});

export const KnoxLumpSectionContext = new RawContextKey<string>('knox.lumpSection', '', {
	type: 'string',
	description: localize('knox.lumpSection', "Open Knox Lump section id, or empty when collapsed."),
});

export const KnoxOverlayContext = new RawContextKey<KnoxNativeOverlay>('knox.overlay', KNOX_DEFAULT_NATIVE_OVERLAY, {
	type: 'string',
	description: localize('knox.overlay', "Open Knox native overlay: chat, history, memory, config, restore, models, or stats."),
});

export const KnoxInputFocusedContext = new RawContextKey<boolean>('knox.inputFocused', false, {
	type: 'boolean',
	description: localize('knox.inputFocused', "True when the native Knox chat input has keyboard focus."),
});

export const KnoxFindVisibleContext = new RawContextKey<boolean>('knox.findVisible', false, {
	type: 'boolean',
	description: localize('knox.findVisible', "True when the native Knox find-in-thread widget is visible."),
});

export const KnoxScrolledUpContext = new RawContextKey<boolean>('knox.scrolledUp', false, {
	type: 'boolean',
	description: localize('knox.scrolledUp', "True when the native Knox thread is not stuck to the bottom."),
});
