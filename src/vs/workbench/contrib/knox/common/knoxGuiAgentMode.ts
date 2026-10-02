/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
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

/** Session modes the toolbar used to tab between. Edit is a temporary overlay that returns here. */
export function knoxGuiIsSessionTabMode(mode: KnoxChatMode): mode is 'chat' | 'agent' {
	return mode === 'chat' || mode === 'agent';
}

/**
 * Users do not pick Chat vs Agent. Chat remains only when the model cannot
 * call tools; Cmd+I edit is unchanged. Jev chooses tools per turn when enabled.
 */
export function knoxGuiResolveSessionMode(input: { mode: KnoxChatMode; toolsSupported: boolean }): KnoxChatMode {
	if (input.mode === 'edit') {
		return 'edit';
	}
	return input.toolsSupported ? 'agent' : 'chat';
}

/**
 * Native Composer Cmd+I: leave edit on Agent when tools work. Chat is only
 * restored for models that cannot call tools.
 */
export function knoxGuiModeAfterEditExit(returnMode?: KnoxChatMode, nextMode?: KnoxChatMode, toolsSupported = true): KnoxChatMode {
	const candidate = nextMode && knoxGuiIsSessionTabMode(nextMode)
		? nextMode
		: returnMode && knoxGuiIsSessionTabMode(returnMode)
			? returnMode
			: KNOX_GUI_DEFAULT_SESSION_MODE;
	return knoxGuiResolveSessionMode({ mode: candidate, toolsSupported });
}

/**
 * Host AgentModeManager can force Agent on. Turning the switch off no longer
 * means Chat — Jev picks Chat vs Agent when enabled, otherwise Agent only.
 * Cmd+I edit is left only when turning agent on.
 */
export function knoxGuiModeAfterHostAgentFlag(mode: KnoxChatMode, active: boolean): KnoxChatMode | undefined {
	if (active) {
		return mode === 'agent' ? undefined : 'agent';
	}
	return undefined;
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
