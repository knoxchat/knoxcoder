/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiSuggestItem, KnoxChatMode } from '../knoxGuiState.js';
import { cloneInputDoc, docEndCaret, emptyInputDoc, inlineLength, paragraphLength, paragraphTextBefore, slashCommandTitle, type IKnoxGuiDocCaret, type IKnoxGuiInputBlock, type IKnoxGuiInputCodeBlock, type IKnoxGuiInputParagraph, type KnoxGuiInlineNode } from './doc.js';

/** Detect `@` `/` `#` triggers and apply inserts, chips, and code blocks. */

export type KnoxGuiComposerTrigger =
	| { kind: 'mention'; query: string }
	| { kind: 'slash'; query: string }
	| { kind: 'codeToEdit'; query: string };

function resolveCaret(doc: IKnoxGuiInputBlock[], caret: IKnoxGuiDocCaret | undefined): IKnoxGuiDocCaret | undefined {
	if (caret) {
		const block = doc[caret.block];
		if (block?.type === 'paragraph') {
			return { block: caret.block, offset: Math.max(0, Math.min(caret.offset, paragraphLength(block))) };
		}
	}
	const end = docEndCaret(doc);
	return doc[end.block]?.type === 'paragraph' ? end : undefined;
}

function splitInlinesAt(content: KnoxGuiInlineNode[], offset: number): [KnoxGuiInlineNode[], KnoxGuiInlineNode[]] {
	const before: KnoxGuiInlineNode[] = [];
	const after: KnoxGuiInlineNode[] = [];
	let remaining = offset;
	for (const node of content) {
		if (remaining <= 0) {
			after.push({ ...node });
			continue;
		}
		const length = inlineLength(node);
		if (node.type === 'text' && remaining < length) {
			before.push({ type: 'text', text: node.text.slice(0, remaining) });
			after.push({ type: 'text', text: node.text.slice(remaining) });
		} else {
			before.push({ ...node });
		}
		remaining -= length;
	}
	return [before, after];
}

const MENTION_TRIGGER = /(?:^|\s)@([^\s\uFFFC]*)$/;
const CODE_TO_EDIT_TRIGGER = /(?:^|\s)#([^\s\uFFFC]*)$/;
const SLASH_TRIGGER = /^\/([^\s\uFFFC]*)$/;

/**
 * `@` fires after whitespace anywhere in the doc, `/` at the start of any line,
 * and `#` (edit mode only) adds files to code-to-edit.
 */
export function detectComposerTrigger(doc: IKnoxGuiInputBlock[], caret?: IKnoxGuiDocCaret, options?: { mode?: KnoxChatMode }): KnoxGuiComposerTrigger | undefined {
	const at = resolveCaret(doc, caret);
	if (!at) {
		return undefined;
	}
	const before = paragraphTextBefore(doc[at.block] as IKnoxGuiInputParagraph, at.offset);
	const mention = before.match(MENTION_TRIGGER);
	if (mention) {
		return { kind: 'mention', query: mention[1] };
	}
	if (options?.mode === 'edit') {
		const hash = before.match(CODE_TO_EDIT_TRIGGER);
		if (hash) {
			return { kind: 'codeToEdit', query: hash[1] };
		}
		return undefined;
	}
	const line = before.slice(before.lastIndexOf('\n') + 1);
	const slash = line.match(SLASH_TRIGGER);
	if (slash) {
		return { kind: 'slash', query: slash[1] };
	}
	return undefined;
}

/** Offset in `text` where a trailing trigger token (`@q`, `#q`, `/q`) starts. */
function triggerStart(text: string, char: '@' | '#' | '/'): number {
	const index = text.lastIndexOf(char);
	if (index < 0 || /[\s\uFFFC]/.test(text.slice(index + 1))) {
		return -1;
	}
	return index;
}

/**
 * Replace the trigger token that ends at `caret` with `nodes`; returns the new
 * doc and the caret just after the inserted nodes.
 */
export function replaceTriggerAt(doc: IKnoxGuiInputBlock[], caret: IKnoxGuiDocCaret | undefined, char: '@' | '#' | '/', nodes: KnoxGuiInlineNode[]): { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret } {
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const at = resolveCaret(next, caret) ?? { block: lastParagraphIndex(next), offset: 0 };
	const paragraph = next[at.block] as IKnoxGuiInputParagraph;
	const text = paragraphTextBefore(paragraph, at.offset);
	const start = triggerStart(text, char);
	const [head] = splitInlinesAt(paragraph.content, start < 0 ? at.offset : start);
	const [, tail] = splitInlinesAt(paragraph.content, at.offset);
	const inserted = nodes.map(node => ({ ...node }));
	const lastInserted = inserted[inserted.length - 1];
	const firstTail = tail[0];
	if (lastInserted?.type === 'text' && lastInserted.text.endsWith(' ') && firstTail?.type === 'text' && firstTail.text.startsWith(' ')) {
		firstTail.text = firstTail.text.slice(1);
	}
	const content = [...head, ...inserted, ...tail].filter(node => node.type !== 'text' || node.text.length > 0);
	next[at.block] = { type: 'paragraph', content: mergeTextNodes(content) };
	const offset = head.reduce((sum, node) => sum + inlineLength(node), 0) + inserted.reduce((sum, node) => sum + inlineLength(node), 0);
	return { doc: next, caret: { block: at.block, offset } };
}

function mergeTextNodes(content: KnoxGuiInlineNode[]): KnoxGuiInlineNode[] {
	const out: KnoxGuiInlineNode[] = [];
	for (const node of content) {
		const last = out[out.length - 1];
		if (node.type === 'text' && last?.type === 'text') {
			out[out.length - 1] = { type: 'text', text: last.text + node.text };
		} else {
			out.push(node);
		}
	}
	return out;
}

export function appendTextToDoc(doc: IKnoxGuiInputBlock[], text: string): IKnoxGuiInputBlock[] {
	if (!text) {
		return doc;
	}
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	const last = paragraph.content[paragraph.content.length - 1];
	if (last?.type === 'text') {
		last.text += text;
	} else {
		paragraph.content.push({ type: 'text', text });
	}
	return next;
}

/** TipTap `insertContent` at the selection: text lands at the caret (end of doc when the caret is unknown). */
export function insertTextAtCaret(doc: IKnoxGuiInputBlock[], caret: IKnoxGuiDocCaret | undefined, text: string): { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret } {
	if (!text) {
		return { doc, caret: resolveCaret(doc, caret) ?? docEndCaret(doc) };
	}
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const at = resolveCaret(next, caret) ?? { block: lastParagraphIndex(next), offset: 0 };
	const paragraph = next[at.block] as IKnoxGuiInputParagraph;
	const [head, tail] = splitInlinesAt(paragraph.content, at.offset);
	next[at.block] = { type: 'paragraph', content: mergeTextNodes([...head, { type: 'text', text }, ...tail]) };
	return { doc: next, caret: { block: at.block, offset: at.offset + text.length } };
}

export function applySuggestAt(doc: IKnoxGuiInputBlock[], item: IKnoxGuiSuggestItem, kind: 'mention' | 'slash', caret?: IKnoxGuiDocCaret): { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret } {
	if (kind === 'slash') {
		const id = slashCommandTitle(item.id || item.label);
		return replaceTriggerAt(doc, caret, '/', [
			{ type: 'slash', id, label: id, description: item.description },
			{ type: 'text', text: ' ' },
		]);
	}
	const chip: KnoxGuiInlineNode = {
		type: 'mention',
		id: item.id,
		label: item.label,
		itemType: item.itemType,
		query: item.query,
		renderInlineAs: item.renderInlineAs,
		description: item.description,
		icon: item.icon,
	};
	return replaceTriggerAt(doc, caret, '@', [chip, { type: 'text', text: ' ' }]);
}

export function applySuggestToDoc(doc: IKnoxGuiInputBlock[], item: IKnoxGuiSuggestItem, kind: 'mention' | 'slash', caret?: IKnoxGuiDocCaret): IKnoxGuiInputBlock[] {
	return applySuggestAt(doc, item, kind, caret).doc;
}

export function appendTriggerToDoc(doc: IKnoxGuiInputBlock[], trigger: '@' | '/'): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	const last = paragraph.content[paragraph.content.length - 1];
	if (last?.type === 'text' && last.text.endsWith(trigger)) {
		return next;
	}
	const prefix = last?.type === 'text' && last.text && !/\s$/.test(last.text) ? ' ' : '';
	if (last?.type === 'text') {
		last.text += `${prefix}${trigger}`;
	} else {
		paragraph.content.push({ type: 'text', text: `${prefix}${trigger}` });
	}
	return next;
}

export function clearMentionQuery(doc: IKnoxGuiInputBlock[], caret?: IKnoxGuiDocCaret): IKnoxGuiInputBlock[] {
	return clearMentionQueryAt(doc, caret).doc;
}

export function clearMentionQueryAt(doc: IKnoxGuiInputBlock[], caret?: IKnoxGuiDocCaret): { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret } {
	return replaceTriggerAt(doc, caret, '@', [{ type: 'text', text: '@' }]);
}

/** Drop the `#query` token when a file is picked for code-to-edit. */
export function removeCodeToEditTrigger(doc: IKnoxGuiInputBlock[], caret?: IKnoxGuiDocCaret): { doc: IKnoxGuiInputBlock[]; caret: IKnoxGuiDocCaret } {
	return replaceTriggerAt(doc, caret, '#', []);
}

export function insertCodeBlock(doc: IKnoxGuiInputBlock[], block: IKnoxGuiInputCodeBlock): IKnoxGuiInputBlock[] {
	if (block.itemName && doc.some(item => item.type === 'codeBlock' && item.itemName === block.itemName)) {
		return doc;
	}
	let insertAt = 0;
	for (const item of doc) {
		if (item.type === 'codeBlock') {
			insertAt++;
			continue;
		}
		break;
	}
	const next = cloneInputDoc(doc);
	next.splice(insertAt, 0, { ...block });
	return next;
}

function lastParagraphIndex(doc: IKnoxGuiInputBlock[]): number {
	for (let i = doc.length - 1; i >= 0; i--) {
		if (doc[i].type === 'paragraph') {
			return i;
		}
	}
	doc.push({ type: 'paragraph', content: [] });
	return doc.length - 1;
}

export function appendMentionChip(doc: IKnoxGuiInputBlock[], item: IKnoxGuiSuggestItem): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	paragraph.content.push({
		type: 'mention',
		id: item.id,
		label: item.label,
		itemType: item.itemType,
		query: item.query ?? item.id,
		description: item.description,
	});
	return next;
}

export function removeCodeBlockAt(doc: IKnoxGuiInputBlock[], index: number): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc);
	let seen = 0;
	for (let i = 0; i < next.length; i++) {
		if (next[i].type !== 'codeBlock') {
			continue;
		}
		if (seen === index) {
			next.splice(i, 1);
			break;
		}
		seen++;
	}
	return next.length ? next : emptyInputDoc();
}
