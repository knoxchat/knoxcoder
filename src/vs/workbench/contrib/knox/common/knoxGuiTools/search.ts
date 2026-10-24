/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiToolOutputItem } from '../knoxGuiState.js';
import { displayArgsForToolCall } from './args.js';
import { stripAnsi } from './theme.js';

/** Exact-search query badges, hit parsing, and output extraction. */

export interface IKnoxGuiSearchLine {
	lineNum: number;
	content: string;
	isMatch: boolean;
}

export interface IKnoxGuiSearchMatch {
	filePath: string;
	language: string;
	lines: IKnoxGuiSearchLine[];
}

export function highlightSearchQueryInHtml(html: string, query: string): string {
	if (!query || !html) {
		return html;
	}
	try {
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escaped})`, 'gi');
		return html.split(/(<[^>]+>)/).map(part => {
			if (part.startsWith('<')) {
				return part;
			}
			return part.replace(regex, '<mark class="knox-gui-search-match">$1</mark>');
		}).join('');
	} catch {
		return html;
	}
}

/**
 * `FindInFile.tsx` query badge: string args only, no control chars, no private-use
 * icon glyphs. Arrays from sloppy tool JSON are joined.
 */
export function sanitizeExactSearchQuery(raw: unknown): string {
	let text = '';
	if (typeof raw === 'string') {
		text = raw;
	} else if (typeof raw === 'number' || typeof raw === 'boolean') {
		text = String(raw);
	} else if (Array.isArray(raw)) {
		text = raw.filter((item): item is string => typeof item === 'string').join(' ');
	}
	return stripAnsi(text)
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
		.replace(/\uFFFD/g, '')
		.replace(/[\uE000-\uF8FF]/g, '')
		.replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
		.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
		// eslint-disable-next-line no-misleading-character-class
		.replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const SEARCH_QUERY_KEYS = ['query', 'pattern', 'search', 'q'] as const;
const SEARCH_DESCRIPTION_QUERY_RE = /Exact search results for "([\s\S]*?)" - /;

/** Query shown in the Exact Search badge (`nXt` `e.query`, plus streaming / description fallbacks). */
export function exactSearchDisplayQuery(tool: { parsedArgs?: unknown; arguments?: unknown; outputItems?: IKnoxGuiToolOutputItem[] }): string {
	const args = displayArgsForToolCall(tool.parsedArgs, tool.arguments);
	for (const key of SEARCH_QUERY_KEYS) {
		const value = sanitizeExactSearchQuery(args[key]);
		if (value) {
			return value;
		}
	}
	const description = tool.outputItems?.find(item =>
		item.description?.includes('search') ||
		item.name?.includes('search') ||
		item.name?.includes('Search'))?.description ?? '';
	const match = SEARCH_DESCRIPTION_QUERY_RE.exec(description);
	return sanitizeExactSearchQuery(match?.[1] ?? '');
}

/** `ExactSearch.tsx` badge text: the raw query, `...` while the query is still streaming. */
export function exactSearchQueryBadge(query: string): string {
	return query || '...';
}

export function detectSearchLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() || '';
	const langMap: Record<string, string> = {
		ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python',
		rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c',
		cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php', html: 'html', css: 'css',
		scss: 'scss', less: 'less', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', md: 'markdown',
		sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', dockerfile: 'dockerfile', vue: 'vue', svelte: 'svelte',
	};
	return langMap[ext] || 'plaintext';
}

export function parseSearchResults(content: string): IKnoxGuiSearchMatch[] {
	const plain = stripAnsi(content ?? '');
	if (!plain || plain === 'No matches found' || plain.startsWith('Error:') || plain.startsWith('Search error:')) {
		return [];
	}
	const results: IKnoxGuiSearchMatch[] = [];
	let currentFile: IKnoxGuiSearchMatch | null = null;
	for (const line of plain.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		if (line === '--' || line.startsWith('…') || line.startsWith('...')) {
			continue;
		}
		const lineNumMatch = line.match(/^(\d+)([:|-])(.*)$/);
		if (lineNumMatch && currentFile) {
			currentFile.lines.push({
				lineNum: parseInt(lineNumMatch[1], 10),
				content: lineNumMatch[3],
				isMatch: lineNumMatch[2] === ':',
			});
			continue;
		}
		const countMatch = line.match(/^(.*):(\d+)\s*$/);
		if (countMatch && !/^\d+[:\-]/.test(line) && /[\\/]/.test(countMatch[1] ?? '')) {
			if (currentFile) {
				results.push(currentFile);
			}
			currentFile = { filePath: countMatch[1] ?? line, language: detectSearchLanguage(countMatch[1] ?? line), lines: [] };
			continue;
		}
		if (currentFile) {
			results.push(currentFile);
		}
		currentFile = { filePath: line, language: detectSearchLanguage(line), lines: [] };
	}
	if (currentFile) {
		results.push(currentFile);
	}
	return results;
}

export function searchOutput(items: IKnoxGuiToolOutputItem[]): string {
	return items.find(item =>
		item.description?.includes('search') ||
		item.name?.includes('search') ||
		item.name?.includes('Search'))?.content || items[0]?.content || '';
}
