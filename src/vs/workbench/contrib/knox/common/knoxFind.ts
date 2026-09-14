/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeRegExpCharacters } from '../../../../base/common/strings.js';
import { renderKnoxChatMessage } from './knoxChatTypes.js';
import { IKnoxThreadRow } from './knoxThreadModel.js';

export type KnoxSearchPattern =
	| { kind: 'literal'; value: string; caseSensitive: boolean }
	| { kind: 'regex'; regex: RegExp }
	| { kind: 'invalid'; error: string };

export interface IKnoxFindRange {
	start: number;
	end: number;
}

export interface IKnoxFindHit {
	rowId: string;
	rowIndex: number;
	start: number;
	end: number;
}

export interface IKnoxFindOptions {
	caseSensitive: boolean;
	useRegex: boolean;
	wholeWord?: boolean;
}

export function compileKnoxSearchPattern(
	query: string,
	options: IKnoxFindOptions,
): KnoxSearchPattern {
	if (!query) {
		return { kind: 'literal', value: '', caseSensitive: options.caseSensitive };
	}

	if (options.useRegex || options.wholeWord) {
		try {
			const source = options.useRegex ? query : escapeRegExpCharacters(query);
			const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
			const flags = `${options.caseSensitive ? '' : 'i'}g`;
			return { kind: 'regex', regex: new RegExp(wrapped, flags) };
		} catch (e) {
			return {
				kind: 'invalid',
				error: e instanceof Error ? e.message : 'Invalid regular expression',
			};
		}
	}

	return {
		kind: 'literal',
		value: options.caseSensitive ? query : query.toLowerCase(),
		caseSensitive: options.caseSensitive,
	};
}

export function knoxTextMatchesPattern(text: string, pattern: KnoxSearchPattern): boolean {
	if (pattern.kind === 'invalid') {
		return false;
	}
	if (pattern.kind === 'literal') {
		if (!pattern.value) {
			return false;
		}
		const haystack = pattern.caseSensitive ? text : text.toLowerCase();
		return haystack.includes(pattern.value);
	}
	pattern.regex.lastIndex = 0;
	return pattern.regex.test(text);
}

export function knoxFindMatchRanges(
	text: string,
	pattern: KnoxSearchPattern,
): IKnoxFindRange[] {
	if (pattern.kind === 'invalid' || !text) {
		return [];
	}

	const ranges: IKnoxFindRange[] = [];
	if (pattern.kind === 'literal') {
		if (!pattern.value) {
			return [];
		}
		const haystack = pattern.caseSensitive ? text : text.toLowerCase();
		const needle = pattern.value;
		let startIndex = 0;
		while ((startIndex = haystack.indexOf(needle, startIndex)) !== -1) {
			const endIndex = startIndex + needle.length;
			ranges.push({ start: startIndex, end: endIndex });
			startIndex = endIndex;
		}
		return ranges;
	}

	pattern.regex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.regex.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (end === start) {
			pattern.regex.lastIndex = start + 1;
			continue;
		}
		ranges.push({ start, end });
		if (!pattern.regex.global) {
			break;
		}
	}
	return ranges;
}

export function knoxThreadRowSearchText(row: IKnoxThreadRow): string {
	if (row.kind === 'loading') {
		return '';
	}
	if (row.kind === 'timeline') {
		return (row.steps ?? [])
			.map(step => [step.toolName, step.detail].filter(Boolean).join(' '))
			.join('\n');
	}
	if (row.kind === 'tool' && row.toolState) {
		const output = row.toolState.output ?? row.item?.contextItems;
		return [
			row.toolState.toolCall.function.name,
			row.toolState.status,
			row.toolState.toolCall.function.arguments,
			...(output ?? []).map(item => item.content),
		].filter(Boolean).join(' ');
	}
	const item = row.item;
	if (!item) {
		return '';
	}
	const parts = [
		renderKnoxChatMessage(item.message),
		item.reasoning?.text,
		item.message.redactedThinking,
	];
	return parts.filter(part => typeof part === 'string' && part.trim()).join('\n');
}

export function findKnoxThreadMatches(
	rows: readonly IKnoxThreadRow[],
	pattern: KnoxSearchPattern,
): IKnoxFindHit[] {
	if (pattern.kind === 'invalid') {
		return [];
	}
	const hits: IKnoxFindHit[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const row = rows[rowIndex];
		const text = knoxThreadRowSearchText(row);
		if (!text || !knoxTextMatchesPattern(text, pattern)) {
			continue;
		}
		for (const range of knoxFindMatchRanges(text, pattern)) {
			hits.push({
				rowId: row.id,
				rowIndex,
				start: range.start,
				end: range.end,
			});
		}
	}
	return hits;
}

export function knoxNextFindIndex(current: number, total: number, delta: number): number {
	if (total <= 0) {
		return -1;
	}
	if (current < 0) {
		return delta >= 0 ? 0 : total - 1;
	}
	return (current + delta + total) % total;
}
