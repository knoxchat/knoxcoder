/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clamp } from '../../../../base/common/numbers.js';
import { localize } from '../../../../nls.js';
import { KnoxChatMode } from './knoxChat.js';

/** In-memory scheme for the native Knox input model. `@` mentions and `/` slash register on this scheme. */
export const KNOX_INPUT_SCHEME = 'knox-input';

/** T0.2 A: markdown input, matching apply/code preview later. */
export const KNOX_INPUT_LANGUAGE_ID = 'markdown';

/** T0.2 A: always wrap; the input is a chat box, not a code file. */
export const KNOX_INPUT_WORD_WRAP = 'on' as const;

export const KNOX_DEFAULT_INPUT_FONT_SIZE = 14;
export const KNOX_MIN_INPUT_FONT_SIZE = 7;
export const KNOX_MAX_INPUT_FONT_SIZE = 50;
export const KNOX_INPUT_MIN_LINES = 2;
export const KNOX_INPUT_MAX_LINES = 8;
export const KNOX_INPUT_VERTICAL_PADDING = 6;

export function knoxInputFontSize(ui: Record<string, unknown> | undefined): number {
	const raw = ui?.fontSize;
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return KNOX_DEFAULT_INPUT_FONT_SIZE;
	}
	return clamp(Math.round(raw), KNOX_MIN_INPUT_FONT_SIZE, KNOX_MAX_INPUT_FONT_SIZE);
}

export function knoxInputLineHeight(fontSize: number): number {
	return Math.round(fontSize * 1.5);
}

export function knoxInputPlaceholder(historyLength: number, mode?: KnoxChatMode): string {
	if (mode === 'edit') {
		return localize('knox.describeHowToModifyCode', "Describe how to modify the code - use '#' to add files");
	}
	return historyLength === 0
		? localize('knox.askAnything', "Ask anything! Type @ for more features...")
		: localize('knox.followUpQuestion', "Follow-up question...");
}

export function knoxInputEditorFontOptions(ui: Record<string, unknown> | undefined): {
	fontSize: number;
	lineHeight: number;
	wordWrap: typeof KNOX_INPUT_WORD_WRAP;
} {
	const fontSize = knoxInputFontSize(ui);
	return {
		fontSize,
		lineHeight: knoxInputLineHeight(fontSize),
		wordWrap: KNOX_INPUT_WORD_WRAP,
	};
}

export function knoxInputContentHeight(
	contentHeight: number,
	fontSize: number,
	minLines: number = KNOX_INPUT_MIN_LINES,
	maxLines: number = KNOX_INPUT_MAX_LINES,
	padding: number = KNOX_INPUT_VERTICAL_PADDING,
): number {
	const lineHeight = knoxInputLineHeight(fontSize);
	const minHeight = minLines * lineHeight + padding * 2;
	const maxHeight = maxLines * lineHeight + padding * 2;
	return clamp(contentHeight, minHeight, maxHeight);
}
