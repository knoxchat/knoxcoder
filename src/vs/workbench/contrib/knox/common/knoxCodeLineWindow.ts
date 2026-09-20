/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Visible lines when a code block is collapsed. Port of GUI `codeLineWindow.ts`. */
export const DEFAULT_COLLAPSED_LINES = 12;
/** Hard cap once the user expands; remainder stays out of the DOM. */
export const MAX_EXPANDED_CODE_LINES = 400;

export function visibleCodeLineRange(
	lineCount: number,
	options: { isGenerating: boolean; isExpanded: boolean },
): { start: number; end: number } {
	if (lineCount <= 0) {
		return { start: 0, end: 0 };
	}
	if (options.isExpanded) {
		return { start: 0, end: Math.min(lineCount, MAX_EXPANDED_CODE_LINES) };
	}
	if (lineCount <= DEFAULT_COLLAPSED_LINES) {
		return { start: 0, end: lineCount };
	}
	if (options.isGenerating) {
		return {
			start: lineCount - DEFAULT_COLLAPSED_LINES,
			end: lineCount,
		};
	}
	return { start: 0, end: DEFAULT_COLLAPSED_LINES };
}

export function knoxVisibleCodeText(
	code: string,
	options: { isGenerating: boolean; isExpanded: boolean },
): { text: string; start: number; end: number; lineCount: number } {
	const lines = code.split('\n');
	const lineCount = lines.length;
	const range = visibleCodeLineRange(lineCount, options);
	return {
		text: lines.slice(range.start, range.end).join('\n'),
		start: range.start,
		end: range.end,
		lineCount,
	};
}
