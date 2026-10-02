/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxGuiRoute, type KnoxGuiOverlay } from './knoxGuiProtocol.js';
import { isAskUserToolName } from './knoxGuiChat.js';
import { countRunningJobs } from './knoxGuiPanels.js';
import type { IKnoxGuiBackgroundJob, IKnoxGuiHistoryItem, IKnoxGuiSessionTab, IKnoxGuiState, IKnoxGuiToolCall, KnoxChatMode, KnoxToolSetting } from './knoxGuiState.js';

/** Lump toolbar sections in `BlockSettingsTopToolbar` (context is overlay-only). Icons match lucide. */
export const KNOX_GUI_LUMP_TOOLBAR = [
	{ id: 'models' as const, key: 'models', svg: 'cpu' as const },
	{ id: 'rules' as const, key: 'rules', svg: 'square-pen' as const },
	{ id: 'prompts' as const, key: 'prompts', svg: 'scroll-text' as const },
	{ id: 'tools' as const, key: 'tools', svg: 'wrench' as const },
	{ id: 'history' as const, key: 'history', svg: 'history' as const },
	{ id: 'settings' as const, key: 'settings', svg: 'settings' as const },
];

/** Session Chat/Agent tabs are gone; Jev (or Agent-only) picks. Edit is Cmd+I only. */
export const KNOX_GUI_MODE_TABS: KnoxChatMode[] = [];

export function knoxGuiLumpLabelVisible(overlay: KnoxGuiOverlay, id: string): boolean {
	return overlay === id;
}

export function knoxGuiEmptyTranscriptShowsPlaceholder(): boolean {
	return false;
}

export function knoxGuiToolbarShowsAlwaysOnLabels(): boolean {
	return false;
}

export function knoxGuiComposerShowsJobsButton(): boolean {
	return false;
}

export function knoxGuiPermissionModeIsTopTab(): boolean {
	return true;
}

export function knoxGuiRunningJobCount(jobs: IKnoxGuiBackgroundJob[]): number {
	return countRunningJobs(jobs);
}

/** `InputToolbar` only cancels from the main composer. Historical Send stays Send. */
export function knoxGuiCanCancel(state: { isStreaming: boolean; history: IKnoxGuiHistoryItem[] }, isMainInput = true): boolean {
	if (!isMainInput) {
		return false;
	}
	if (state.isStreaming) {
		return true;
	}
	return state.history.some(item => item.toolCalls?.some(call =>
		call.status === 'calling' || call.status === 'generating' || call.status === 'generated'));
}

/** `Chat.tsx`: hide the bottom composer after the first edit-mode turn. */
export function knoxGuiShowsMainComposer(state: {
	route: KnoxGuiRoute;
	mode: KnoxChatMode;
	history: readonly unknown[];
	lockedRoute?: KnoxGuiRoute;
}): boolean {
	if (state.lockedRoute === KnoxGuiRoute.Memory || state.lockedRoute === KnoxGuiRoute.CheckpointGraph) {
		return false;
	}
	if (state.route !== KnoxGuiRoute.Chat) {
		return false;
	}
	return !(state.mode === 'edit' && state.history.length > 0);
}

/** TabBar is hidden while there is only one tab, matching TabBar. Dedicated editors never show it. */
export function knoxGuiShowsSessionTabs(state: { showSessionTabs: boolean; tabs: IKnoxGuiSessionTab[]; route?: KnoxGuiRoute; lockedRoute?: KnoxGuiRoute }): boolean {
	if (state.lockedRoute === KnoxGuiRoute.Memory || state.lockedRoute === KnoxGuiRoute.CheckpointGraph) {
		return false;
	}
	if (state.route === KnoxGuiRoute.Memory || state.route === KnoxGuiRoute.CheckpointGraph) {
		return false;
	}
	return Boolean(state.showSessionTabs && state.tabs.length > 1);
}

export function knoxGuiShowsFatalBanner(state: { fatalConfig: boolean; route: KnoxGuiRoute }): boolean {
	return state.fatalConfig && state.route !== KnoxGuiRoute.ConfigError;
}

export function knoxGuiShowsScrollButtons(historyLength: number, hasScrollableContent: boolean): boolean {
	return hasScrollableContent && historyLength > 0;
}

export function knoxGuiShowsLargeSessionBanner(state: Pick<IKnoxGuiState, 'historyHydrateNotice'>): boolean {
	return state.historyHydrateNotice === 'large';
}

/** Send-button copy: chat `Send`, edit `Edit`, accepting diffs `Retry`. */
export function knoxGuiEditSendKey(state: { mode: KnoxChatMode; applyStates?: Array<{ status: string }> }): 'send' | 'edit' | 'retry' {
	if (state.mode !== 'edit') {
		return 'send';
	}
	return (state.applyStates ?? []).some(item => item.status === 'done') ? 'retry' : 'edit';
}

/**
 * Chat.tsx `input-container` then KnoxInputBox: pending tool bar → lump →
 * overlay → meter → panels → editor → context peek → accept/reject.
 */
export const KNOX_GUI_COMPOSER_SLOTS = [
	'pendingToolBar',
	'lump',
	'overlay',
	'agentMeter',
	'panels',
	'editor',
	'contextPeek',
	'acceptRejectAll',
] as const;

export type KnoxGuiComposerSlot = typeof KNOX_GUI_COMPOSER_SLOTS[number];

/** GUI hides lump overlays while streaming except Tools with a pending generated call. */
/** `Lump/index.tsx` fades the section in and out over 300ms. */
export const KNOX_LUMP_FADE_MS = 300;

export function knoxGuiShowsLumpOverlay(state: {
	overlay: KnoxGuiOverlay | null;
	isStreaming: boolean;
	history: IKnoxGuiHistoryItem[];
}): boolean {
	if (!state.overlay) {
		return false;
	}
	if (!state.isStreaming) {
		return true;
	}
	return state.overlay === 'tools' && state.history.some(item => item.toolCalls?.some(call => call.status === 'generated'));
}

export function knoxGuiShowsAgentMeter(mode: KnoxChatMode): boolean {
	return mode === 'agent';
}

/** Chat.tsx ToolCallButtons: generated, not AskUser, not auto-approved. */
export function knoxGuiShowsChatPermissionBar(
	call: IKnoxGuiToolCall | undefined,
	opts: { toolSettings: Record<string, KnoxToolSetting>; sessionAllowlist: string[] },
): call is IKnoxGuiToolCall {
	if (!call || call.status !== 'generated') {
		return false;
	}
	if (isAskUserToolName(call.name)) {
		return false;
	}
	const setting = opts.toolSettings[call.name] ?? 'allowedWithoutPermission';
	if (setting === 'allowedWithoutPermission' || opts.sessionAllowlist.includes(call.name)) {
		return false;
	}
	return true;
}

/** `ToolCallButtonsDiv.tsx`: generating / calling / generated sit under the composer. */
export function knoxGuiShowsChatToolButtons(call: IKnoxGuiToolCall | undefined): call is IKnoxGuiToolCall {
	if (!call || isAskUserToolName(call.name)) {
		return false;
	}
	return call.status === 'generating' || call.status === 'calling' || call.status === 'generated';
}

/** Chat.tsx sits AcceptRejectAll below the composer only for single-range edit. */
export function knoxGuiShowsComposerAcceptReject(hasPendingApplies: boolean, isSingleRange: boolean): boolean {
	return hasPendingApplies && isSingleRange;
}

/** Multi-file pending diffs open the native `/batch-diff` page instead of composer accept/reject. */
export function knoxGuiShowsBatchDiffEntry(hasPendingApplies: boolean, isSingleRange: boolean): boolean {
	return hasPendingApplies && !isSingleRange;
}

/** EditActions on the edit-mode response. */
export function knoxGuiShowsEditResponseAcceptReject(mode: KnoxChatMode, isStreaming: boolean, hasPendingApplies: boolean): boolean {
	return mode === 'edit' && !isStreaming && hasPendingApplies;
}

export function knoxGuiRelativeFontSize(fontSize: number, delta: number): number {
	return Math.max(1, fontSize + delta);
}

export function knoxGuiMetaKeyLabel(isMac: boolean): string {
	return isMac ? '⌘' : 'Ctrl';
}

export function knoxGuiAltKeyLabel(isMac: boolean): string {
	return isMac ? '⌥' : 'Alt';
}

const SHORTCUT_META_KEYS = ['meta', '⌘', 'ctrl', 'cmd', '^', 'cmd/ctrl'];
const SHORTCUT_ALT_KEYS = ['alt', 'option', 'opt', '⌥'];

/**
 * `gui/Shortcut.tsx` `parseShortcut`: combos split on `,`, keys on spaces; meta and alt
 * spellings become the platform label. Unlike the reference, a bare `+` is a separator
 * and `cmd/ctrl` is a meta key, so `shift + cmd/ctrl + p` reads Shift + ⌘ + P.
 */
export function knoxGuiShortcutKeys(shortcut: string, isMac: boolean): string[][] {
	const backspace = isMac ? 'Delete ⌫' : 'Backspace ⌫';
	const special: Record<string, string> = {
		uparrow: 'UpArrow ↑',
		downarrow: 'DownArrow ↓',
		leftarrow: 'LeftArrow ←',
		rightarrow: 'RightArrow →',
		enter: 'Enter ⏎',
		esc: 'Esc',
		backspace,
		delete: backspace,
		'⌫': backspace,
	};
	return shortcut.split(',')
		.map(combo => combo.trim().split(' ').filter(key => key && key !== '+').map(key => {
			const lower = key.toLowerCase();
			if (SHORTCUT_META_KEYS.includes(lower)) {
				return knoxGuiMetaKeyLabel(isMac);
			}
			if (SHORTCUT_ALT_KEYS.includes(lower)) {
				return knoxGuiAltKeyLabel(isMac);
			}
			return special[lower] ?? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
		}))
		.filter(combo => combo.length > 0);
}

export function knoxGuiAcceptRejectLabelKeys(isSingleRange: boolean): { reject: string; accept: string } {
	return isSingleRange
		? { reject: 'reject', accept: 'accept' }
		: { reject: 'rejectAllChanges', accept: 'acceptAllChanges' };
}

/** `AcceptRejectAllButtons.tsx`: short < sm, mid sm–md, long ≥ md. */
export function knoxGuiAcceptRejectWidthKeys(): { short: { reject: string; accept: string }; mid: { reject: string; accept: string }; long: { reject: string; accept: string } } {
	return {
		short: { reject: 'reject', accept: 'accept' },
		mid: { reject: 'rejectAll', accept: 'acceptAll' },
		long: { reject: 'rejectAllChanges', accept: 'acceptAllChanges' },
	};
}

export function knoxGuiAcceptRejectShortcut(isMac: boolean, kind: 'accept' | 'reject'): string {
	const meta = knoxGuiMetaKeyLabel(isMac);
	return kind === 'accept' ? `${meta}⇧⏎` : `${meta}⇧⌫`;
}

/** `Chat.tsx` localStorage key for the main-composer send counter. */
export const KNOX_GUI_MAIN_TEXT_ENTRY_KEY = 'mainTextEntryCounter';
export const KNOX_GUI_MAIN_TEXT_ENTRY_SHOWN_KEY = 'mainTextEntryDialogShown';
export const KNOX_GUI_MAIN_TEXT_ENTRY_DIALOG_AT = 300;

/** `FindWidget.tsx` SEARCH_DEBOUNCE / resize debounce. */
export const KNOX_GUI_FIND_DEBOUNCE_MS = 300;
export const KNOX_GUI_FIND_RESIZE_DEBOUNCE_MS = 200;

/** `showChatScrollbar ?? window.innerHeight > 5000`. */
export const KNOX_GUI_CHAT_SCROLLBAR_MIN_HEIGHT = 5000;

/** Reference Tailwind `@theme` breakpoints: 2xs 170 / xs 250 / sm 330 / md 460. */
export const KNOX_GUI_2XS_MAX_PX = 169;
export const KNOX_GUI_XS_MAX_PX = 249;
export const KNOX_GUI_SM_MAX_PX = 329;
export const KNOX_GUI_MD_MAX_PX = 459;
export const KNOX_GUI_SM_MIN_PX = 330;

export function knoxGuiNextMainTextEntry(count: number, shown: boolean): { count: number; shown: boolean; open: boolean } {
	if (shown || count >= KNOX_GUI_MAIN_TEXT_ENTRY_DIALOG_AT) {
		return { count, shown: true, open: false };
	}
	const next = count + 1;
	if (next === KNOX_GUI_MAIN_TEXT_ENTRY_DIALOG_AT) {
		return { count: next, shown: true, open: true };
	}
	return { count: next, shown: false, open: false };
}

export function knoxGuiShowsChatScrollbar(showSetting: boolean, heightPx: number): boolean {
	return showSetting || heightPx > KNOX_GUI_CHAT_SCROLLBAR_MIN_HEIGHT;
}

export function knoxGuiParseMainTextEntryCount(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? '0', 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Headless UI `ListboxOptions anchor="bottom start"` / Radix Select portal box. `align: 'end'` matches ModeSelect `anchor="bottom end"`. */
export function knoxGuiAnchorPopoverBox(args: {
	trigger: { left: number; top: number; bottom: number; width: number };
	viewport: { width: number; height: number };
	menu: { width: number; height: number };
	gap?: number;
	pad?: number;
	prefer?: 'top' | 'bottom';
	align?: 'start' | 'end';
	maxHeight?: number;
}): { left: number; top: number; maxHeight: number; placement: 'top' | 'bottom' } {
	const gap = args.gap ?? 4;
	const pad = args.pad ?? 4;
	const cap = args.maxHeight ?? 300;
	const above = Math.max(0, args.trigger.top - gap - pad);
	const below = Math.max(0, args.viewport.height - args.trigger.bottom - gap - pad);
	let placement = args.prefer ?? 'bottom';
	const room = placement === 'top' ? above : below;
	const other = placement === 'top' ? below : above;
	if (args.menu.height > room && other > room) {
		placement = placement === 'top' ? 'bottom' : 'top';
	}
	const maxHeight = Math.min(placement === 'top' ? above : below, cap);
	const height = Math.min(args.menu.height, maxHeight);
	const startLeft = args.trigger.left;
	const endLeft = args.trigger.left + args.trigger.width - args.menu.width;
	const rawLeft = args.align === 'end' ? endLeft : startLeft;
	const left = Math.max(pad, Math.min(rawLeft, args.viewport.width - pad - args.menu.width));
	const top = placement === 'top' ? args.trigger.top - gap - height : args.trigger.bottom + gap;
	return { left, top, maxHeight, placement };
}
