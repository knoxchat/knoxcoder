/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** GUI `XTermTerminal` treats this many pixels as “still at the bottom”. */
export const KNOX_TERMINAL_FOLLOW_THRESHOLD = 30;

export function knoxTerminalIsAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
	return Math.abs(scrollHeight - scrollTop - clientHeight) < KNOX_TERMINAL_FOLLOW_THRESHOLD;
}

export function knoxTerminalShouldFollow(unstuck: boolean, streaming: boolean): boolean {
	return streaming && !unstuck;
}

export function knoxExtractTerminalOutput(
	items:
		| readonly { name?: string; description?: string; content?: string }[]
		| undefined,
): string {
	if (!items?.length) {
		return '';
	}
	const match = items.find(
		item =>
			item.name === 'Terminal' ||
			item.name === 'Build' ||
			item.name === 'Terminal command output' ||
			item.description === 'Terminal command output' ||
			item.description?.startsWith('Terminal command') ||
			item.description?.startsWith('Background shell') ||
			item.description?.startsWith('Shell job') ||
			item.description === 'Unknown shell job' ||
			item.description?.includes('shell job'),
	);
	return match?.content || items[0]?.content || '';
}

export const TERMINAL_TAIL_LINES = 400;
export const TERMINAL_TAIL_CHARS = 32_000;

export function extractLogPathFromTerminalOutput(text: string): string | undefined {
	const match = text.match(/^Full log:\s*(.+)$/m);
	const path = match?.[1]?.trim();
	return path || undefined;
}

export function takeTerminalTail(
	content: string,
	maxLines = TERMINAL_TAIL_LINES,
	maxChars = TERMINAL_TAIL_CHARS,
): { tail: string; truncated: boolean; hiddenLines: number } {
	if (!content) {
		return { tail: '', truncated: false, hiddenLines: 0 };
	}

	const lines = content.split('\n');
	const start = Math.max(0, lines.length - maxLines);
	let tail = lines.slice(start).join('\n');

	if (tail.length > maxChars) {
		tail = tail.slice(-maxChars);
		const nl = tail.indexOf('\n');
		if (nl !== -1 && nl < tail.length - 1) {
			tail = tail.slice(nl + 1);
		}
		const tailLineCount = tail ? tail.split('\n').length : 0;
		return {
			tail,
			truncated: true,
			hiddenLines: Math.max(0, lines.length - tailLineCount),
		};
	}

	return {
		tail,
		truncated: start > 0,
		hiddenLines: start,
	};
}
