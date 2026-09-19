/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxChatMode } from './knoxChat.js';
import { IKnoxChatHistoryItem } from './knoxChatTypes.js';
import { findCurrentToolCall, hasUnsettledToolCalls } from './knoxChatHistory.js';
import { IKnoxCodeToEdit, knoxCanSubmitEdit, knoxIsEditModeAndNoCodeToEdit } from './knoxEditMode.js';

export type KnoxToolbarPrimaryKind = 'send' | 'cancel' | 'edit' | 'retry';

export interface IKnoxToolbarPrimaryState {
	kind: KnoxToolbarPrimaryKind;
	canCancel: boolean;
	enabled: boolean;
}

export interface IKnoxToolbarPrimaryInput {
	mode: KnoxChatMode;
	isStreaming: boolean;
	history: readonly IKnoxChatHistoryItem[];
	codeToEdit: readonly IKnoxCodeToEdit[];
	editStatus?: string;
	runningJobs: number;
	disabled?: boolean;
}

/**
 * GUI InputToolbar: Stop while the LLM stream, an in-flight tool, or a
 * background job is live. Send/Edit otherwise, disabled while a generated
 * tool is waiting for Deny/Always/Approve.
 */
export function knoxToolbarCanCancel(input: IKnoxToolbarPrimaryInput): boolean {
	const tool = findCurrentToolCall(input.history);
	return input.isStreaming
		|| tool?.status === 'calling'
		|| hasUnsettledToolCalls(input.history)
		|| input.runningJobs > 0;
}

/**
 * GUI `Chat.tsx` `sendInput`: refuse to start a new turn while the current tool
 * is `generated` and waiting for Deny/Always/Approve. Without this, Enter (or
 * the send command) starts a second turn while a tool is pending.
 */
export function knoxSubmitBlockedByPendingTool(history: readonly IKnoxChatHistoryItem[]): boolean {
	return findCurrentToolCall(history)?.status === 'generated';
}

export function knoxToolbarEnterDisabled(input: IKnoxToolbarPrimaryInput): boolean {
	return !!input.disabled
		|| knoxIsEditModeAndNoCodeToEdit(input.mode, input.codeToEdit)
		|| knoxSubmitBlockedByPendingTool(input.history);
}

export function knoxToolbarPrimaryState(input: IKnoxToolbarPrimaryInput): IKnoxToolbarPrimaryState {
	const canCancel = knoxToolbarCanCancel(input);
	if (canCancel) {
		return { kind: 'cancel', canCancel: true, enabled: true };
	}
	if (input.mode === 'edit') {
		const retry = input.editStatus === 'accepting' || input.editStatus === 'accepting:full-diff';
		return {
			kind: retry ? 'retry' : 'edit',
			canCancel: false,
			enabled: knoxCanSubmitEdit(input.mode, input.codeToEdit, false) && !knoxToolbarEnterDisabled(input),
		};
	}
	return {
		kind: 'send',
		canCancel: false,
		enabled: !knoxToolbarEnterDisabled(input),
	};
}

/** GUI `insertCharacterWithWhitespace('@')`. */
export function knoxMentionTriggerInsert(textBeforeCursor: string): string {
	if (textBeforeCursor.endsWith('@')) {
		return '';
	}
	if (!textBeforeCursor.length || /\s$/.test(textBeforeCursor)) {
		return '@';
	}
	return ' @';
}
