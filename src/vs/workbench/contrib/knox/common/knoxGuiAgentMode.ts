/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KNOX_GUI_DEFAULT_SESSION_MODE, KnoxChatMode } from './knoxGuiState.js';

/**
 * KN-350: VS Code when-clause owned by AgentModeManager. Undo/redo keybindings
 * and the status bar switch all read this one flag.
 */
export const KNOX_AGENT_MODE_CONTEXT_KEY = 'knoxAgentModeActive';

export function knoxGuiSessionModeIsAgent(mode: KnoxChatMode): boolean {
	return mode === 'agent';
}

/** Chat/Agent tabs only. Edit is a temporary overlay that returns here. */
export function knoxGuiIsSessionTabMode(mode: KnoxChatMode): mode is 'chat' | 'agent' {
	return mode === 'chat' || mode === 'agent';
}

/**
 * Native Composer Cmd+I: leave edit on the Chat/Agent tab you were on.
 * First-run and a missing return tab are Agent, matching ModeSelect.
 */
export function knoxGuiModeAfterEditExit(returnMode?: KnoxChatMode, nextMode?: KnoxChatMode): KnoxChatMode {
	if (nextMode && knoxGuiIsSessionTabMode(nextMode)) {
		return nextMode;
	}
	if (returnMode && knoxGuiIsSessionTabMode(returnMode)) {
		return returnMode;
	}
	return KNOX_GUI_DEFAULT_SESSION_MODE;
}

/**
 * Next Chat/Agent tab after AgentModeManager's boolean switch.
 * Turning the switch off never leaves Cmd+I edit mode.
 */
export function knoxGuiModeAfterHostAgentFlag(mode: KnoxChatMode, active: boolean): KnoxChatMode | undefined {
	if (active) {
		return mode === 'agent' ? undefined : 'agent';
	}
	return mode === 'agent' ? 'chat' : undefined;
}

/**
 * Parse host `agentModeChanged` `{ active }`. Request/response envelopes from
 * `setAgentMode` (same messageType on the reply path) are ignored so a success
 * reply cannot flip Agent → Chat.
 */
export function knoxGuiHostAgentActiveFromPayload(data: unknown): boolean | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}
	const rec = data as Record<string, unknown>;
	if (rec.done === true || rec.status === 'success' || rec.status === 'error') {
		return undefined;
	}
	return typeof rec.active === 'boolean' ? rec.active : undefined;
}
