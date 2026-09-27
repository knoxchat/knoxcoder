/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxGuiRoute, type KnoxGuiOverlay } from './knoxGuiProtocol.js';
import { ASK_USER_TOOL_NAMES } from './knoxGuiChat.js';
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

/** ModeSelect tabs. Edit is not a always-on tab; it appears only while in edit mode. */
export const KNOX_GUI_MODE_TABS: KnoxChatMode[] = ['chat', 'agent'];

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
	return false;
}

export function knoxGuiRunningJobCount(jobs: IKnoxGuiBackgroundJob[]): number {
	return countRunningJobs(jobs);
}

export function knoxGuiCanCancel(state: { isStreaming: boolean; history: IKnoxGuiHistoryItem[] }): boolean {
	if (state.isStreaming) {
		return true;
	}
	return state.history.some(item => item.toolCalls?.some(call =>
		call.status === 'calling' || call.status === 'generating' || call.status === 'generated'));
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
 * KnoxInputBox + Chat.tsx stack: lump → overlay → meter → panels → editor →
 * context peek → pending tool bar → accept/reject.
 */
export const KNOX_GUI_COMPOSER_SLOTS = [
	'lump',
	'overlay',
	'agentMeter',
	'panels',
	'editor',
	'contextPeek',
	'pendingToolBar',
	'acceptRejectAll',
] as const;

export type KnoxGuiComposerSlot = typeof KNOX_GUI_COMPOSER_SLOTS[number];

/** GUI hides lump overlays while streaming except Tools with a pending generated call. */
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
	if (ASK_USER_TOOL_NAMES.has(call.name)) {
		return false;
	}
	const setting = opts.toolSettings[call.name] ?? 'allowedWithoutPermission';
	if (setting === 'allowedWithoutPermission' || opts.sessionAllowlist.includes(call.name)) {
		return false;
	}
	return true;
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

export function knoxGuiAcceptRejectLabelKeys(isSingleRange: boolean): { reject: string; accept: string } {
	return isSingleRange
		? { reject: 'reject', accept: 'accept' }
		: { reject: 'rejectAllChanges', accept: 'acceptAllChanges' };
}

export function knoxGuiAcceptRejectShortcut(isMac: boolean, kind: 'accept' | 'reject'): string {
	const meta = knoxGuiMetaKeyLabel(isMac);
	return kind === 'accept' ? `${meta}⇧⏎` : `${meta}⇧⌫`;
}
