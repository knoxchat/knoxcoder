/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxLumpSection } from './knoxChat.js';
import { findCurrentToolCall } from './knoxChatHistory.js';
import { IKnoxChatHistoryItem } from './knoxChatTypes.js';

export const KNOX_LUMP_SECTIONS: readonly KnoxLumpSection[] = [
	'models',
	'rules',
	'prompts',
	'tools',
	'history',
	'checkpoints',
];

export function isKnoxLumpSection(value: unknown): value is KnoxLumpSection {
	return typeof value === 'string' && (KNOX_LUMP_SECTIONS as readonly string[]).includes(value);
}

/** GUI LumpToolbar: clicking the open section collapses it. */
export function knoxToggleLumpSection(
	current: KnoxLumpSection | undefined,
	next: KnoxLumpSection,
): KnoxLumpSection | undefined {
	return current === next ? undefined : next;
}

/**
 * GUI Lump hides section content while streaming, except Tools when a
 * generated tool is waiting for Deny / Always / Approve.
 */
export function knoxLumpSectionContentVisible(input: {
	section: KnoxLumpSection | undefined;
	isStreaming: boolean;
	history: readonly IKnoxChatHistoryItem[];
}): boolean {
	if (!input.section) {
		return false;
	}
	if (!input.isStreaming) {
		return true;
	}
	return input.section === 'tools' && findCurrentToolCall(input.history)?.status === 'generated';
}

/** GUI `handleNewChat` saves the thread first when history is non-empty. */
export function knoxLumpShouldSaveBeforeNewChat(historyLength: number): boolean {
	return historyLength > 0;
}
