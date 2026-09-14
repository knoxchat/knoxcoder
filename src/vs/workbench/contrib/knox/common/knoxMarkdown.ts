/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lexer } from '../../../../base/common/marked/marked.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IKnoxChatHistoryItem, IKnoxContextItem } from './knoxChatTypes.js';
import { IKnoxRangeInFile } from './knoxResolveInput.js';

const TERMINAL_LANGUAGES = new Set(['bash', 'sh']);
const COMMON_TERMINAL_COMMANDS = [
	'npm', 'pnpm', 'yarn', 'bun', 'deno', 'npx', 'cd', 'ls', 'pwd',
	'pip', 'python', 'node', 'git', 'curl', 'wget', 'rbenv', 'gem', 'ruby', 'bundle',
];

const FENCE_START_REGEX = /^(`{3,})(\w*)?(.*)$/;
const FENCE_CLOSE_REGEX = /^(`{3,})\s*$/;
const HAS_FILE_EXTENSION = /\.[0-9a-z]+$/i;

export interface IKnoxFenceInfo {
	language: string;
	relativeFilePath: string;
	range: string;
}

export interface IKnoxMarkdownCodeBlock {
	readonly kind: 'code';
	readonly language: string;
	readonly relativeFilePath: string;
	readonly range: string;
	readonly code: string;
	readonly raw: string;
	readonly index: number;
	readonly isLast: boolean;
}

export interface IKnoxMarkdownTextBlock {
	readonly kind: 'markdown';
	readonly source: string;
}

export type IKnoxMarkdownBlock = IKnoxMarkdownTextBlock | IKnoxMarkdownCodeBlock;

export interface IKnoxSymbolWithRange {
	name: string;
	type: string;
	content: string;
	filepath: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

export interface IKnoxDisplayPath {
	dir: string;
	name: string;
}

export interface IKnoxOpenFileLines {
	startLine?: number;
	endLine?: number;
}

/**
 * Streamdown-style stable blocks: each marked token stays its own raw chunk so
 * a completed fence/heading is not re-parsed when later tokens arrive.
 */
export function parseMarkdownIntoBlocks(markdown: string): string[] {
	return lexer(markdown, { gfm: true }).map(token => token.raw);
}

export function knoxAutoCloseIncompleteFences(source: string): string {
	const fenceRegex = /^(`{3,})/gm;
	let fenceCount = 0;
	let lastFence: string | undefined;
	let match: RegExpExecArray | null;
	while ((match = fenceRegex.exec(source)) !== null) {
		fenceCount++;
		lastFence = match[1];
	}
	if (fenceCount > 0 && fenceCount % 2 === 1 && lastFence) {
		return `${source}\n${lastFence}`;
	}
	return source;
}

/**
 * Raise the outer fence length when a markdown/code fence contains nested
 * fences (LLM SETUP.md-in-a-fence case).
 */
export function patchNestedMarkdown(source: string): string {
	const backtickMatches = source.match(/`{3,}/g);
	if (!backtickMatches || backtickMatches.length < 4) {
		return source;
	}

	const lines = source.split('\n');
	const trimmedLines = lines.map(line => line.trim());
	const blockStack: Array<{ startLine: number; fenceLength: number; hasNestedFences: boolean }> = [];
	const blocksToPatch: Array<{ startLine: number; endLine: number }> = [];

	for (let i = 0; i < trimmedLines.length; i++) {
		const line = trimmedLines[i];
		const startMatch = line.match(FENCE_START_REGEX);
		const closeMatch = line.match(FENCE_CLOSE_REGEX);
		if (!startMatch && !closeMatch) {
			continue;
		}
		const backticks = (startMatch || closeMatch)![1];
		const fenceLength = backticks.length;
		const hasLanguage = !!(startMatch && startMatch[2] && startMatch[2].length > 0);

		if (blockStack.length === 0) {
			blockStack.push({ startLine: i, fenceLength, hasNestedFences: false });
			continue;
		}

		const currentBlock = blockStack[blockStack.length - 1];
		if (closeMatch && fenceLength === currentBlock.fenceLength) {
			if (blockStack.length === 1 && currentBlock.hasNestedFences) {
				blocksToPatch.push({ startLine: currentBlock.startLine, endLine: i });
			}
			blockStack.pop();
		} else if (startMatch && hasLanguage) {
			if (blockStack.length > 0) {
				blockStack[0].hasNestedFences = true;
			}
			blockStack.push({ startLine: i, fenceLength, hasNestedFences: false });
		} else if (closeMatch && fenceLength !== currentBlock.fenceLength) {
			for (let j = blockStack.length - 1; j >= 0; j--) {
				if (blockStack[j].fenceLength === fenceLength) {
					const closedBlocks = blockStack.splice(j);
					if (j === 0 && closedBlocks[0].hasNestedFences) {
						blocksToPatch.push({ startLine: closedBlocks[0].startLine, endLine: i });
					}
					break;
				}
			}
		} else if (startMatch && !hasLanguage && fenceLength > currentBlock.fenceLength) {
			blockStack[0].hasNestedFences = true;
			blockStack.push({ startLine: i, fenceLength, hasNestedFences: false });
		}
	}

	for (const block of blocksToPatch) {
		let maxInnerFenceLength = 3;
		for (let i = block.startLine + 1; i < block.endLine; i++) {
			const innerMatch = trimmedLines[i].match(/^(`{3,})/);
			if (innerMatch) {
				maxInnerFenceLength = Math.max(maxInnerFenceLength, innerMatch[1].length);
			}
		}
		const outerFence = '`'.repeat(maxInnerFenceLength + 1);
		lines[block.startLine] = lines[block.startLine].replace(/^(\s*)(`{3,})/, `$1${outerFence}`);
		lines[block.endLine] = lines[block.endLine].replace(/^(\s*)(`{3,})/, `$1${outerFence}`);
	}

	return lines.join('\n');
}

export function knoxPrepareMarkdownSource(source: string, streaming: boolean): string {
	const closed = streaming ? knoxAutoCloseIncompleteFences(source) : source;
	return patchNestedMarkdown(closed);
}

export function knoxParseFenceInfo(info: string | undefined): IKnoxFenceInfo {
	const trimmed = (info ?? '').trim();
	const language = trimmed.match(/^\S*/)?.[0] ?? '';
	const meta = trimmed.slice(language.length).trim();
	if (!meta) {
		return { language, relativeFilePath: '', range: '' };
	}
	const parts = meta.split(/\s+/);
	return {
		language,
		relativeFilePath: parts[0] ?? '',
		range: parts[1] ?? '',
	};
}

export function knoxParseMarkdownBlocks(source: string, streaming = false): IKnoxMarkdownBlock[] {
	const prepared = knoxPrepareMarkdownSource(source, streaming);
	const tokens = lexer(prepared, { gfm: true });
	const blocks: IKnoxMarkdownBlock[] = [];
	let codeIndex = 0;
	for (const token of tokens) {
		if (token.type === 'code') {
			const info = knoxParseFenceInfo(token.lang);
			blocks.push({
				kind: 'code',
				language: info.language,
				relativeFilePath: info.relativeFilePath,
				range: info.range,
				code: token.text,
				raw: token.raw,
				index: codeIndex++,
				isLast: false,
			});
			continue;
		}
		if (token.type === 'space') {
			continue;
		}
		blocks.push({ kind: 'markdown', source: token.raw });
	}
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (block.kind === 'code') {
			(block as { isLast: boolean }).isLast = true;
			break;
		}
	}
	return blocks;
}

export function knoxHasFileExtension(filepath: string): boolean {
	return HAS_FILE_EXTENSION.test(filepath);
}

export function getTerminalCommand(text: string): string {
	return text.startsWith('$ ') ? text.slice(2) : text;
}

export function isTerminalCodeBlock(language: string | undefined | null, text: string): boolean {
	if (language && TERMINAL_LANGUAGES.has(language)) {
		return true;
	}
	if (language && language.length > 0) {
		return false;
	}
	const trimmed = text.trim();
	return trimmed.split('\n').length === 1 || COMMON_TERMINAL_COMMANDS.some(command => trimmed.startsWith(command));
}

export function hasVisibleCodeContent(content: string): boolean {
	return content.trim().length > 0;
}

export function initialCodeBlockExpanded(codeBlockContent: string, expanded?: boolean): boolean {
	if (typeof expanded === 'boolean') {
		return expanded;
	}
	return hasVisibleCodeContent(codeBlockContent);
}

export function shouldAutoExpandGeneratingCodeBlock(
	isGenerating: boolean,
	codeBlockContent: string,
	expanded?: boolean,
): boolean {
	if (expanded === false) {
		return false;
	}
	return isGenerating && hasVisibleCodeContent(codeBlockContent);
}

export function knoxMarkdownCodeWrap(ui: Record<string, unknown> | undefined): boolean {
	return ui?.codeWrap === true;
}

export function splitDisplayPath(filepath: string): IKnoxDisplayPath {
	const clean = filepath.replace(/\\/g, '/').replace(/^\.\//, '');
	const lastSlash = clean.lastIndexOf('/');
	if (lastSlash === -1) {
		return { dir: '', name: clean };
	}
	return {
		dir: clean.slice(0, lastSlash + 1),
		name: clean.slice(lastSlash + 1),
	};
}

export function knoxParseDisplayRange(range: string | undefined): IKnoxOpenFileLines {
	if (!range) {
		return {};
	}
	const match = range.match(/^(\d+)(?:-(\d+))?$/);
	if (!match) {
		return {};
	}
	const startLine = Number(match[1]);
	const endLine = match[2] ? Number(match[2]) : startLine;
	if (!Number.isFinite(startLine) || startLine <= 0) {
		return {};
	}
	return {
		startLine,
		endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : startLine,
	};
}

export function knoxIsUriString(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

export function knoxResolveWorkspaceUri(filepath: string, folders: readonly URI[]): string {
	const trimmed = filepath.trim();
	if (!trimmed) {
		return '';
	}
	if (knoxIsUriString(trimmed)) {
		return trimmed;
	}
	if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
		return URI.file(trimmed).toString();
	}
	const folder = folders[0];
	if (!folder) {
		return URI.file(trimmed).toString();
	}
	return joinPath(folder, trimmed).toString();
}

export function knoxContextItemToRif(item: IKnoxContextItem): IKnoxRangeInFile | undefined {
	if (item.uri?.type !== 'file' || !item.uri.value) {
		return undefined;
	}
	return {
		filepath: item.uri.value,
		contents: item.content,
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
		},
	};
}

export function getContextItemsFromHistory(
	historyItems: readonly IKnoxChatHistoryItem[],
	priorToIndex?: number,
): IKnoxContextItem[] {
	const past = historyItems.filter((_, i) => i <= (priorToIndex ?? historyItems.length - 1));
	const fromContext = past.flatMap(item =>
		(item.contextItems ?? []).filter(ctx => ctx.uri?.type === 'file' && ctx.uri.value),
	);
	const fromEditor: IKnoxContextItem[] = [];
	for (const item of past) {
		const editorState = item.editorState;
		if (!editorState || typeof editorState !== 'object' || !('content' in editorState)) {
			continue;
		}
		const content = (editorState as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const part of content) {
			if (!part || typeof part !== 'object') {
				continue;
			}
			const row = part as { type?: unknown; attrs?: { item?: IKnoxContextItem } };
			if (row.type === 'codeBlock' && row.attrs?.item?.uri?.type === 'file' && row.attrs.item.uri.value) {
				fromEditor.push(row.attrs.item);
			}
		}
	}
	return [...fromContext, ...fromEditor];
}

export function knoxRifsFromHistory(
	historyItems: readonly IKnoxChatHistoryItem[],
	priorToIndex?: number,
): IKnoxRangeInFile[] {
	const rifs: IKnoxRangeInFile[] = [];
	for (const item of getContextItemsFromHistory(historyItems, priorToIndex)) {
		const rif = knoxContextItemToRif(item);
		if (rif) {
			rifs.push(rif);
		}
	}
	return rifs;
}

export function knoxParseSymbolMap(map: Readonly<Record<string, unknown>>): IKnoxSymbolWithRange[] {
	const symbols: IKnoxSymbolWithRange[] = [];
	for (const [uri, value] of Object.entries(map)) {
		if (!Array.isArray(value)) {
			continue;
		}
		for (const row of value) {
			const parsed = knoxParseSymbol(row, uri);
			if (parsed) {
				symbols.push(parsed);
			}
		}
	}
	return symbols;
}

function knoxParseSymbol(value: unknown, fallbackUri: string): IKnoxSymbolWithRange | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const row = value as {
		name?: unknown;
		type?: unknown;
		content?: unknown;
		filepath?: unknown;
		range?: {
			start?: { line?: unknown; character?: unknown };
			end?: { line?: unknown; character?: unknown };
		};
	};
	if (typeof row.name !== 'string' || !row.name) {
		return undefined;
	}
	const startLine = typeof row.range?.start?.line === 'number' ? row.range.start.line : 0;
	const endLine = typeof row.range?.end?.line === 'number' ? row.range.end.line : startLine;
	return {
		name: row.name,
		type: typeof row.type === 'string' ? row.type : 'unknown',
		content: typeof row.content === 'string' ? row.content : '',
		filepath: typeof row.filepath === 'string' && row.filepath ? row.filepath : fallbackUri,
		range: {
			start: {
				line: startLine,
				character: typeof row.range?.start?.character === 'number' ? row.range.start.character : 0,
			},
			end: {
				line: endLine,
				character: typeof row.range?.end?.character === 'number' ? row.range.end.character : 0,
			},
		},
	};
}

export function knoxSymbolsForContext(
	map: Readonly<Record<string, unknown>>,
	rifs: readonly IKnoxRangeInFile[],
): IKnoxSymbolWithRange[] {
	const uris = new Set(rifs.map(rif => rif.filepath));
	const symbols: IKnoxSymbolWithRange[] = [];
	for (const [uri, value] of Object.entries(map)) {
		if (!uris.has(uri) || !Array.isArray(value)) {
			continue;
		}
		for (const row of value) {
			const parsed = knoxParseSymbol(row, uri);
			if (parsed) {
				symbols.push(parsed);
			}
		}
	}
	return symbols;
}

export function matchCodeToSymbolOrFile(
	content: string,
	symbols: readonly IKnoxSymbolWithRange[],
	rifs: readonly IKnoxRangeInFile[],
): IKnoxSymbolWithRange | IKnoxRangeInFile | undefined {
	if (rifs.length && content.includes('.') && content.length > 2) {
		const match = rifs.find(rif => rif.filepath.split(/[/\\]/).pop() === content);
		if (match) {
			return match;
		}
	}
	const exact = symbols.find(symbol => symbol.name === content);
	if (exact) {
		return exact;
	}
	return symbols.find(symbol => content.startsWith(symbol.name));
}

export function isSymbolNotRif(
	item: IKnoxSymbolWithRange | IKnoxRangeInFile,
): item is IKnoxSymbolWithRange {
	return 'type' in item && typeof (item as IKnoxSymbolWithRange).type === 'string' && 'name' in item;
}

export function knoxTruncateSymbolPreview(content: string, max = 200): string {
	return content.length > max ? `${content.slice(0, max - 4)}\n...` : content;
}

export function knoxFileUrisNeedingSymbols(
	historyItems: readonly IKnoxChatHistoryItem[],
	symbols: Readonly<Record<string, unknown>>,
	priorToIndex?: number,
): string[] {
	const uris = new Set<string>();
	for (const item of getContextItemsFromHistory(historyItems, priorToIndex)) {
		const value = item.uri?.value;
		if (item.uri?.type === 'file' && value && !(value in symbols)) {
			uris.add(value);
		}
	}
	return [...uris];
}
