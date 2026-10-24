/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiToolCall, KnoxChatMode } from '../knoxGuiState.js';
import { isAskUserToolName } from '../knoxGuiChat.js';

/** Send-button gating, pending tools, and active-file submit invert. */

export function useActiveFileFromDefaultContext(defaultContext: string[] | undefined): boolean {
	return (defaultContext ?? []).some(item => item === 'activeFile' || item === 'currentFile');
}

/** Alt/option inverts the configured default, matching InputToolbar + editorConfig. */
export function submitUsesActiveFile(useActiveFile: boolean, altKey: boolean): boolean {
	return useActiveFile !== altKey;
}

export function knoxGuiShouldBlockSubmit(state: {
	isStreaming: boolean;
	input: string;
	images: unknown[];
	mode: KnoxChatMode;
	codeToEdit: unknown[];
	history: Array<{ toolCalls?: IKnoxGuiToolCall[] }>;
	resubmitting?: boolean;
}): boolean {
	if (state.isStreaming && !state.resubmitting) {
		return true;
	}
	if (state.mode === 'edit' && state.codeToEdit.length === 0) {
		return true;
	}
	if (!state.input.trim() && !state.images.length) {
		return true;
	}
	if (state.resubmitting) {
		return false;
	}
	return knoxGuiPendingToolBlocksSubmit(state);
}

/** True when a generated (non-AskUser) tool confirm is waiting — `cannotSubmitWhileAwaitingTool`. */
export function knoxGuiPendingToolBlocksSubmit(state: {
	isStreaming: boolean;
	history: Array<{ toolCalls?: IKnoxGuiToolCall[] }>;
	resubmitting?: boolean;
}): boolean {
	if (state.resubmitting || (state.isStreaming && !state.resubmitting)) {
		return false;
	}
	for (let i = state.history.length - 1; i >= 0; i--) {
		const pending = state.history[i].toolCalls?.find(call => call.status === 'generated');
		if (pending) {
			return !isAskUserToolName(pending.name);
		}
	}
	return false;
}

/** `InputToolbar.tsx` isEnterDisabled: empty input keeps Send enabled (submitting it is a no-op). */
export function knoxGuiSendButtonDisabled(state: Parameters<typeof knoxGuiShouldBlockSubmit>[0]): boolean {
	return knoxGuiShouldBlockSubmit({ ...state, input: state.input.trim() ? state.input : ' x' });
}
