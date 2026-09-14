/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem } from './knoxChatTypes.js';
import { knoxAsArgsRecord } from './knoxStreamingToolCode.js';

const LANGUAGE_BY_EXT: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	go: 'go',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	hpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	html: 'html',
	css: 'css',
	scss: 'scss',
	less: 'less',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	xml: 'xml',
	md: 'markdown',
	sql: 'sql',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	dockerfile: 'dockerfile',
	vue: 'vue',
	svelte: 'svelte',
};

export interface IKnoxSearchLine {
	lineNum: number;
	content: string;
	isMatch: boolean;
}

export interface IKnoxSearchMatch {
	filePath: string;
	language: string;
	lines: IKnoxSearchLine[];
}

export interface IKnoxExactSearchStats {
	files: number;
	matches: number;
}

export function knoxExactSearchQuery(parsedArgs: unknown): string {
	const args = knoxAsArgsRecord(parsedArgs);
	return typeof args?.query === 'string' ? args.query : '';
}

export function knoxExtractExactSearchContent(items: readonly IKnoxContextItem[] | undefined): string {
	if (!items?.length) {
		return '';
	}
	const named = items.find(item =>
		item.description?.toLowerCase().includes('search')
		|| item.name.toLowerCase().includes('search'),
	);
	return named?.content || items[0]?.content || '';
}

export function knoxDetectSearchLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return LANGUAGE_BY_EXT[ext] || 'plaintext';
}

export function knoxParseExactSearchResults(content: string): IKnoxSearchMatch[] {
	if (!content || content === 'No matches found' || content.startsWith('Error:')) {
		return [];
	}

	const results: IKnoxSearchMatch[] = [];
	let currentFile: IKnoxSearchMatch | null = null;

	for (const line of content.split('\n')) {
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
			const filePath = countMatch[1] ?? line;
			currentFile = {
				filePath,
				language: knoxDetectSearchLanguage(filePath),
				lines: [],
			};
			continue;
		}

		if (currentFile) {
			results.push(currentFile);
		}
		currentFile = {
			filePath: line,
			language: knoxDetectSearchLanguage(line),
			lines: [],
		};
	}

	if (currentFile) {
		results.push(currentFile);
	}
	return results;
}

export function knoxExactSearchStats(results: readonly IKnoxSearchMatch[]): IKnoxExactSearchStats {
	return {
		files: results.length,
		matches: results.reduce((acc, file) => acc + file.lines.filter(line => line.isMatch).length, 0),
	};
}

export function knoxEscapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, ch => {
		switch (ch) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
}

/** Wrap query matches in already-escaped or tokenized HTML without touching tags. */
export function knoxHighlightSearchQuery(html: string, query: string): string {
	if (!query) {
		return html;
	}
	try {
		const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escapedQuery})`, 'gi');
		return html.split(/(<[^>]+>)/).map(part => {
			if (part.startsWith('<')) {
				return part;
			}
			return part.replace(regex, '<mark class="knox-search-match">$1</mark>');
		}).join('');
	} catch {
		return html;
	}
}
