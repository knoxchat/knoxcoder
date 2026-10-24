/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Composer document model: inline nodes, paragraphs, code blocks, and caret. */

export type KnoxGuiInlineNode =
	| { type: 'text'; text: string }
	| { type: 'mention'; id: string; label: string; itemType?: string; query?: string; renderInlineAs?: string; description?: string; icon?: string }
	| { type: 'slash'; id: string; label: string; description?: string };

export interface IKnoxGuiInputParagraph {
	type: 'paragraph';
	content: KnoxGuiInlineNode[];
}

export interface IKnoxGuiInputCodeBlock {
	type: 'codeBlock';
	language?: string;
	filepath?: string;
	code: string;
	itemName?: string;
	/** 0-based line range of a highlighted selection (`rifWithContentsToContextItem`). */
	range?: { start: number; end: number };
}

/** `rifWithContentsToContextItem` name: `basename (start-end)` with 1-based lines. */
export function knoxGuiCodeBlockTitle(block: IKnoxGuiInputCodeBlock): string {
	const source = block.filepath ?? block.itemName ?? '';
	const basename = source.split(/[/\\]/).pop() || source || 'code';
	return block.range ? `${basename} (${block.range.start + 1}-${block.range.end + 1})` : basename;
}

export type KnoxGuiCodeBlockOpenAction =
	| { type: 'showLines'; filepath: string; startLine: number; endLine: number }
	| { type: 'showFile'; filepath: string }
	| { type: 'showVirtualFile'; name: string; content: string };

/** `CodeSnippetPreview.tsx` title click: code ranges reveal their lines, files open, anything else opens as a virtual file. */
export function knoxGuiCodeBlockOpenAction(block: IKnoxGuiInputCodeBlock): KnoxGuiCodeBlockOpenAction {
	if (block.filepath && block.range) {
		return { type: 'showLines', filepath: block.filepath, startLine: block.range.start, endLine: block.range.end };
	}
	if (block.filepath && /^[a-z][a-z0-9+.-]*:\/\//i.test(block.filepath)) {
		return { type: 'showFile', filepath: block.filepath };
	}
	return { type: 'showVirtualFile', name: knoxGuiCodeBlockTitle(block), content: block.code };
}

/** `newestCodeblockForInput`: only the most recently added code block starts expanded. */
export function knoxGuiNewestCodeBlockIndex(doc: readonly IKnoxGuiInputBlock[]): number {
	for (let i = doc.length - 1; i >= 0; i--) {
		if (doc[i].type === 'codeBlock') {
			return i;
		}
	}
	return -1;
}

export type IKnoxGuiInputBlock = IKnoxGuiInputParagraph | IKnoxGuiInputCodeBlock;

export function emptyInputDoc(): IKnoxGuiInputBlock[] {
	return [{ type: 'paragraph', content: [] }];
}

export function cloneInputDoc(doc: IKnoxGuiInputBlock[]): IKnoxGuiInputBlock[] {
	return doc.map(block => {
		if (block.type === 'codeBlock') {
			return block.range ? { ...block, range: { ...block.range } } : { ...block };
		}
		return { type: 'paragraph', content: block.content.map(node => ({ ...node })) };
	});
}

export function inputDocIsEmpty(doc: IKnoxGuiInputBlock[] | undefined): boolean {
	return !inputDocToPlainText(doc).trim();
}

export function mentionChipLabel(attrs: { label?: string; id?: string; renderInlineAs?: string }, char = '@'): string {
	if (attrs.renderInlineAs) {
		return attrs.renderInlineAs;
	}
	return `${char}${attrs.label ?? attrs.id ?? ''}`;
}

export function slashCommandBareName(value: string | undefined | null): string {
	return (value ?? '').trim().replace(/^\//, '').trim();
}

export function slashCommandTitle(value: string | undefined | null): string {
	const bare = slashCommandBareName(value);
	return bare ? `/${bare}` : '/';
}

export function inputDocToPlainText(doc: IKnoxGuiInputBlock[] | undefined): string {
	if (!doc?.length) {
		return '';
	}
	const parts: string[] = [];
	for (const block of doc) {
		if (block.type === 'codeBlock') {
			const meta = [block.language, block.filepath ?? block.itemName].filter(Boolean).join(' ');
			parts.push(`\`\`\`${meta}\n${block.code}\n\`\`\``);
			continue;
		}
		let text = '';
		for (const node of block.content) {
			if (node.type === 'text') {
				text += node.text;
			} else if (node.type === 'mention') {
				text += mentionChipLabel(node);
			} else {
				text += slashCommandTitle(node.id || node.label);
			}
		}
		parts.push(text);
	}
	return parts.join('\n');
}

export function inputDocFromPlainText(text: string): IKnoxGuiInputBlock[] {
	if (!text) {
		return emptyInputDoc();
	}
	const blocks: IKnoxGuiInputBlock[] = [];
	const fence = /```([^\n]*)\n([\s\S]*?)```/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = fence.exec(text)) !== null) {
		if (match.index > last) {
			pushParagraphs(blocks, text.slice(last, match.index));
		}
		const meta = match[1].trim();
		const [language, ...pathParts] = meta.split(/\s+/);
		blocks.push({
			type: 'codeBlock',
			language: language || undefined,
			filepath: pathParts.length ? pathParts.join(' ') : undefined,
			code: match[2].replace(/\n$/, ''),
		});
		last = match.index + match[0].length;
	}
	if (last < text.length || !blocks.length) {
		pushParagraphs(blocks, text.slice(last));
	}
	return blocks.length ? blocks : emptyInputDoc();
}

function pushParagraphs(blocks: IKnoxGuiInputBlock[], text: string): void {
	const normalized = text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
	if (!normalized && blocks.length) {
		return;
	}
	const lines = (normalized || '').split('\n');
	for (const line of lines) {
		blocks.push({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] });
	}
}

/** Caret inside the composer doc: block index plus offset where each chip counts as one character. */
export interface IKnoxGuiDocCaret {
	block: number;
	offset: number;
}

/** Stand-in for an inline chip when a paragraph is flattened to text. */
export const KNOX_GUI_CHIP_CHAR = '\uFFFC';

export function inlineLength(node: KnoxGuiInlineNode): number {
	return node.type === 'text' ? node.text.length : 1;
}

export function paragraphLength(paragraph: IKnoxGuiInputParagraph): number {
	return paragraph.content.reduce((sum, node) => sum + inlineLength(node), 0);
}

export function paragraphTextBefore(paragraph: IKnoxGuiInputParagraph, offset: number): string {
	let text = '';
	let remaining = offset;
	for (const node of paragraph.content) {
		if (remaining <= 0) {
			break;
		}
		if (node.type === 'text') {
			text += node.text.slice(0, remaining);
			remaining -= node.text.length;
		} else {
			text += KNOX_GUI_CHIP_CHAR;
			remaining -= 1;
		}
	}
	return text;
}

export function docEndCaret(doc: IKnoxGuiInputBlock[]): IKnoxGuiDocCaret {
	for (let i = doc.length - 1; i >= 0; i--) {
		const block = doc[i];
		if (block.type === 'paragraph') {
			return { block: i, offset: paragraphLength(block) };
		}
	}
	return { block: doc.length, offset: 0 };
}

export function extractMentionsFromDoc(doc: IKnoxGuiInputBlock[]): Array<{ id: string; label: string; itemType?: string; query?: string }> {
	const mentions: Array<{ id: string; label: string; itemType?: string; query?: string }> = [];
	for (const block of doc) {
		if (block.type !== 'paragraph') {
			continue;
		}
		for (const node of block.content) {
			if (node.type === 'mention') {
				mentions.push({ id: node.id, label: node.label, itemType: node.itemType, query: node.query });
			}
		}
	}
	return mentions;
}

export function extractSlashFromDoc(doc: IKnoxGuiInputBlock[]): string | undefined {
	for (const block of doc) {
		if (block.type !== 'paragraph') {
			continue;
		}
		for (const node of block.content) {
			if (node.type === 'slash') {
				return slashCommandBareName(node.id || node.label);
			}
		}
	}
	return undefined;
}

export function mentionContextProviderName(item: { id: string; itemType?: string }): string {
	if (item.itemType === 'file' || item.itemType === 'folder') {
		return 'file';
	}
	if (item.itemType === 'contextProvider' || !item.itemType) {
		return item.id;
	}
	return item.itemType;
}

export function knoxGuiCodeToEditTitle(code: { filepath: string; range?: { start: { line: number }; end: { line: number } } }): { name: string; kind: 'file' | 'range' | 'insert'; start: number; end: number } {
	const name = code.filepath.split(/[/\\]/).pop() ?? code.filepath;
	if (!code.range) {
		return { name, kind: 'file', start: 0, end: 0 };
	}
	const start = code.range.start.line + 1;
	const end = code.range.end.line + 1;
	return { name, kind: start === end ? 'insert' : 'range', start, end };
}
