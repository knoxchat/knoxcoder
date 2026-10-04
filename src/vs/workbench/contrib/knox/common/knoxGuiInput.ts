/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiContextProvider, IKnoxGuiSlashCommand, IKnoxGuiSuggestItem, IKnoxGuiToolCall, KnoxChatMode } from './knoxGuiState.js';
import { isAskUserToolName } from './knoxGuiChat.js';

export { isSingleRangeEdit, isSingleRangeEditOrInsertion, shouldSendEditPrompt } from './knoxGuiEdit.js';

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

export type KnoxGuiComposerTrigger =
	| { kind: 'mention'; query: string }
	| { kind: 'slash'; query: string }
	| { kind: 'codeToEdit'; query: string };

export type KnoxGuiMentionSectionId = 'open' | 'files' | 'folders' | 'providers' | 'other';
export type KnoxGuiSlashSectionId = 'bookmarked' | 'recent' | 'commands' | 'prompts';

export interface IKnoxGuiSuggestSection {
	id: string;
	labelKey: string;
	items: IKnoxGuiSuggestItem[];
}

export const EDIT_DISALLOWED_CONTEXT_PROVIDERS = ['tree', 'open', 'web', 'diff', 'folder', 'search', 'debugger', 'repo-map'];
export const TOP_LEVEL_MENTION_LIMIT = 40;
export const EMPTY_QUERY_FILE_LIMIT = 8;
export const LIVE_MENTION_MIN_QUERY = 2;
export const LIVE_MENTION_HIT_THRESHOLD = 8;
export const LIVE_MENTION_DEBOUNCE_MS = 150;
export const LIVE_MENTION_SEARCH_CAP = 200;
export const MENTION_LOADING_ID = 'loading';
export const MENTION_TRUNCATED_ID = 'mention-truncated';
/** KN-304: same ten builtins as `extensions/knox/src/core/commands/slash`. */
export const SLASH_BUILTINS: IKnoxGuiSlashCommand[] = [
	{ name: 'autonomous', description: 'Run a multi-step autonomous agent loop with memory integration' },
	{ name: 'issue', description: 'Draft a GitHub issue from the current request' },
	{ name: 'share', description: 'Export the current conversation' },
	{ name: 'cmd', description: 'Generate a shell command' },
	{ name: 'http', description: 'Call a configured HTTP endpoint' },
	{ name: 'commit', description: 'Generate a commit message from the current diff' },
	{ name: 'review', description: 'Review the current file or git diff' },
	{ name: 'pr', description: 'Generate a PR description from current branch changes' },
	{ name: 'changelog', description: 'Generate a changelog from recent git history' },
	{ name: 'skills', description: 'List all loaded skills and their sources' },
	{ name: 'init', description: 'Create AGENTS.md from this repository (use --force to overwrite)' },
	{ name: 'instructions', description: 'Show loaded rules, AGENTS.md files and skills with their token cost' },
	{ name: 'hooks', description: 'Show configured lifecycle hooks and the recent hook audit log' },
];

/** KN-300: same six default `@` providers as Core `DEFAULT_CONTEXT_PROVIDER_TITLES`. */
export const DEFAULT_MENTION_PROVIDER_TITLES = ['file', 'diff', 'problems', 'repo-map', 'terminal', 'memory'] as const;

export const DEFAULT_MENTION_PROVIDERS: IKnoxGuiContextProvider[] = [
	{ title: 'file', displayTitle: 'File | Folder', description: 'Files', type: 'submenu' },
	{ title: 'diff', displayTitle: 'Git Diff', description: 'Git diff', type: 'normal' },
	{ title: 'problems', displayTitle: 'Problems', description: 'Problems', type: 'normal' },
	{ title: 'repo-map', displayTitle: 'Repository Structure Map', description: 'Repo map', type: 'submenu' },
	{ title: 'terminal', displayTitle: 'Terminal', description: 'Terminal', type: 'normal' },
	{ title: 'memory', displayTitle: 'Project Memory', description: 'Project memories', type: 'query' },
];

export function mergeContextProvidersWithDefaults(providers: IKnoxGuiContextProvider[]): IKnoxGuiContextProvider[] {
	const byTitle = new Map<string, IKnoxGuiContextProvider>();
	for (const provider of providers) {
		if (provider.title) {
			byTitle.set(provider.title, provider);
		}
	}
	for (const provider of DEFAULT_MENTION_PROVIDERS) {
		if (!byTitle.has(provider.title)) {
			byTitle.set(provider.title, provider);
		}
	}
	const ordered: IKnoxGuiContextProvider[] = [];
	const seen = new Set<string>();
	for (const title of DEFAULT_MENTION_PROVIDER_TITLES) {
		const provider = byTitle.get(title);
		if (provider) {
			ordered.push(provider);
			seen.add(title);
		}
	}
	for (const [title, provider] of byTitle) {
		if (!seen.has(title)) {
			ordered.push(provider);
		}
	}
	return ordered;
}

export function mergeSlashCommandsWithBuiltins(commands: IKnoxGuiSlashCommand[]): IKnoxGuiSlashCommand[] {
	const existing = new Set(commands.map(cmd => slashCommandBareName(cmd.name)));
	return [...commands, ...SLASH_BUILTINS.filter(cmd => !existing.has(slashCommandBareName(cmd.name)))];
}

export function resolveComposerSlashCommand(name: string | undefined, configured: IKnoxGuiSlashCommand[]): IKnoxGuiSlashCommand | undefined {
	const bare = slashCommandBareName(name);
	if (!bare) {
		return undefined;
	}
	return configured.find(cmd => slashCommandBareName(cmd.name) === bare)
		?? SLASH_BUILTINS.find(cmd => slashCommandBareName(cmd.name) === bare);
}

const MENTION_SECTION_KEYS: Record<KnoxGuiMentionSectionId, string> = {
	open: 'mentionSectionOpen',
	files: 'mentionSectionFiles',
	folders: 'mentionSectionFolders',
	providers: 'mentionSectionProviders',
	other: 'mentionSectionOther',
};

const SLASH_SECTION_KEYS: Record<KnoxGuiSlashSectionId, string> = {
	bookmarked: 'slashSectionBookmarked',
	recent: 'slashSectionRecent',
	commands: 'slashSectionCommands',
	prompts: 'slashSectionPrompts',
};

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

export function composerPlaceholderKey(mode: KnoxChatMode, historyLength: number): string {
	if (mode === 'edit') {
		return 'describeHowToModifyCode';
	}
	return historyLength === 0 ? 'askAnything' : 'followUpQuestion';
}

/** Caret inside the composer doc: block index plus offset where each chip counts as one character. */
export interface IKnoxGuiDocCaret {
	block: number;
	offset: number;
}

/** Stand-in for an inline chip when a paragraph is flattened to text. */
export const KNOX_GUI_CHIP_CHAR = '\uFFFC';

function inlineLength(node: KnoxGuiInlineNode): number {
	return node.type === 'text' ? node.text.length : 1;
}

function paragraphLength(paragraph: IKnoxGuiInputParagraph): number {
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

export function useActiveFileFromDefaultContext(defaultContext: string[] | undefined): boolean {
	return (defaultContext ?? []).some(item => item === 'activeFile' || item === 'currentFile');
}

/** Alt/option inverts the configured default, matching InputToolbar + editorConfig. */
export function submitUsesActiveFile(useActiveFile: boolean, altKey: boolean): boolean {
	return useActiveFile !== altKey;
}

export function knoxGuiShouldBlockSubmit(state: {
	isStreaming: boolean;
	input: string;
	images: unknown[];
	mode: KnoxChatMode;
	codeToEdit: unknown[];
	history: Array<{ toolCalls?: IKnoxGuiToolCall[] }>;
	resubmitting?: boolean;
}): boolean {
	if (state.isStreaming && !state.resubmitting) {
		return true;
	}
	if (state.mode === 'edit' && state.codeToEdit.length === 0) {
		return true;
	}
	if (!state.input.trim() && !state.images.length) {
		return true;
	}
	if (state.resubmitting) {
		return false;
	}
	return knoxGuiPendingToolBlocksSubmit(state);
}

/** True when a generated (non-AskUser) tool confirm is waiting — `cannotSubmitWhileAwaitingTool`. */
export function knoxGuiPendingToolBlocksSubmit(state: {
	isStreaming: boolean;
	history: Array<{ toolCalls?: IKnoxGuiToolCall[] }>;
	resubmitting?: boolean;
}): boolean {
	if (state.resubmitting || (state.isStreaming && !state.resubmitting)) {
		return false;
	}
	for (let i = state.history.length - 1; i >= 0; i--) {
		const pending = state.history[i].toolCalls?.find(call => call.status === 'generated');
		if (pending) {
			return !isAskUserToolName(pending.name);
		}
	}
	return false;
}

/** `InputToolbar.tsx` isEnterDisabled: empty input keeps Send enabled (submitting it is a no-op). */
export function knoxGuiSendButtonDisabled(state: Parameters<typeof knoxGuiShouldBlockSubmit>[0]): boolean {
	return knoxGuiShouldBlockSubmit({ ...state, input: state.input.trim() ? state.input : ' x' });
}

export function filterProvidersForMode(providers: IKnoxGuiContextProvider[], mode: KnoxChatMode): IKnoxGuiContextProvider[] {
	if (mode !== 'edit') {
		return providers;
	}
	return providers.filter(provider => !EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes(provider.title));
}

export function providerMatchesQuery(provider: IKnoxGuiContextProvider, query: string): boolean {
	if (!query) {
		return true;
	}
	const q = query.toLowerCase();
	const title = provider.title.toLowerCase();
	const display = (provider.displayTitle ?? provider.title).toLowerCase();
	return title.startsWith(q) || q.startsWith(title) || display.startsWith(q) || q.startsWith(display) || title.includes(q) || display.includes(q);
}

export function contextProviderToSuggestItem(provider: IKnoxGuiContextProvider): IKnoxGuiSuggestItem {
	return {
		id: provider.title,
		label: provider.displayTitle ?? provider.title,
		description: provider.description,
		itemType: 'contextProvider',
		providerType: provider.type,
		renderInlineAs: provider.renderInlineAs,
		icon: provider.title,
		providerCategory: provider.category,
	};
}

export function fileHitToSuggestItem(hit: { id?: string; title?: string; path?: string; description?: string; icon?: string; providerTitle?: string; score?: number; metadata?: unknown }): IKnoxGuiSuggestItem {
	const id = String(hit.id ?? hit.path ?? hit.title ?? 'file');
	const folder = hit.icon === 'folder';
	const item: IKnoxGuiSuggestItem = {
		id,
		label: String(hit.title ?? hit.path ?? id),
		description: hit.description,
		itemType: folder ? 'folder' : 'file',
		query: id,
		icon: folder ? 'folder' : 'file',
	};
	if (hit.providerTitle) {
		item.providerTitle = hit.providerTitle;
	}
	if (typeof hit.score === 'number') {
		item.score = hit.score;
	}
	if (hit.metadata && typeof hit.metadata === 'object' && (hit.metadata as { truncated?: unknown }).truncated === true) {
		item.truncated = true;
	}
	return item;
}

/** Non-file submenu rows (prompt files, repo maps, custom providers) keep their provider chip type. */
export function submenuHitToSuggestItem(hit: Record<string, unknown>, providerTitle: string): IKnoxGuiSuggestItem {
	const item = fileHitToSuggestItem({ ...hit, providerTitle } as Parameters<typeof fileHitToSuggestItem>[0]);
	if (providerTitle !== 'file' && hit.icon !== 'folder') {
		item.itemType = providerTitle;
		item.icon = typeof hit.icon === 'string' ? hit.icon : undefined;
	}
	return item;
}

function dedupeSuggest(items: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestItem[] {
	const seen = new Set<string>();
	const out: IKnoxGuiSuggestItem[] = [];
	for (const item of items) {
		const key = item.id || item.label;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}

export function buildTopLevelMentionItems(args: {
	query: string;
	providers: IKnoxGuiContextProvider[];
	files: IKnoxGuiSuggestItem[];
	limit?: number;
}): IKnoxGuiSuggestItem[] {
	const query = args.query.trim();
	const limit = args.limit ?? TOP_LEVEL_MENTION_LIMIT;
	const providerMatches = args.providers
		.filter(provider => providerMatchesQuery(provider, query))
		.map(contextProviderToSuggestItem)
		.sort((a, b) => {
			if (a.id === 'file') {
				return -1;
			}
			if (b.id === 'file') {
				return 1;
			}
			return Number(a.providerCategory === 'integration') - Number(b.providerCategory === 'integration');
		});
	if (!query) {
		return dedupeSuggest([...args.files.slice(0, EMPTY_QUERY_FILE_LIMIT), ...providerMatches]).slice(0, limit);
	}
	const fileCap = Math.max(0, limit - providerMatches.length);
	return dedupeSuggest([...args.files.slice(0, fileCap), ...providerMatches]).slice(0, limit);
}

export function isFolderMentionItem(item: IKnoxGuiSuggestItem): boolean {
	return item.icon === 'folder' || item.itemType === 'folder';
}

export function isPathMentionItem(item: IKnoxGuiSuggestItem): boolean {
	return item.itemType === 'file' || item.itemType === 'folder' || item.icon === 'file' || item.icon === 'folder';
}

export function isOpenableMentionRow(item: IKnoxGuiSuggestItem): boolean {
	if (item.itemType === 'contextProvider' || item.itemType === 'slashCommand') {
		return false;
	}
	return isPathMentionItem(item);
}

export function isMentionUtilityItem(item: IKnoxGuiSuggestItem): boolean {
	return item.id === MENTION_LOADING_ID || item.id === MENTION_TRUNCATED_ID;
}

function mentionBucket(item: IKnoxGuiSuggestItem): KnoxGuiMentionSectionId {
	if (item.itemType === 'contextProvider') {
		return 'providers';
	}
	if (isFolderMentionItem(item)) {
		return 'folders';
	}
	if (isPathMentionItem(item)) {
		return 'files';
	}
	return 'other';
}

function mentionSection(id: KnoxGuiMentionSectionId, items: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestSection | undefined {
	if (!items.length) {
		return undefined;
	}
	return { id, labelKey: MENTION_SECTION_KEYS[id], items };
}

export function groupMentionItems(items: IKnoxGuiSuggestItem[], options: { query?: string; inSubmenu?: string } = {}): IKnoxGuiSuggestSection[] {
	const query = (options.query ?? '').trim();
	const selectable = items.filter(item => !isMentionUtilityItem(item));
	const files: IKnoxGuiSuggestItem[] = [];
	const folders: IKnoxGuiSuggestItem[] = [];
	const providers: IKnoxGuiSuggestItem[] = [];
	const other: IKnoxGuiSuggestItem[] = [];
	const open: IKnoxGuiSuggestItem[] = [];
	for (const item of selectable) {
		const bucket = mentionBucket(item);
		if (!query && !options.inSubmenu && (bucket === 'files' || bucket === 'folders')) {
			open.push(item);
			continue;
		}
		if (bucket === 'files') {
			files.push(item);
		} else if (bucket === 'folders') {
			folders.push(item);
		} else if (bucket === 'providers') {
			providers.push(item);
		} else {
			other.push(item);
		}
	}
	if (options.inSubmenu) {
		return [mentionSection('files', files), mentionSection('folders', folders), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
	}
	if (!query) {
		return [mentionSection('open', open), mentionSection('providers', providers), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
	}
	return [mentionSection('files', files), mentionSection('folders', folders), mentionSection('providers', providers), mentionSection('other', other)].filter((row): row is IKnoxGuiSuggestSection => !!row);
}

export function shouldShowMentionSectionHeaders(sections: IKnoxGuiSuggestSection[], inSubmenu?: string): boolean {
	const labeled = sections.filter(section => section.id !== 'other');
	return inSubmenu ? labeled.length > 1 : labeled.length >= 1;
}

export function slashCommandToSuggestItem(command: IKnoxGuiSlashCommand, extras?: { bookmarked?: boolean; recent?: boolean; recentIndex?: number }): IKnoxGuiSuggestItem {
	const name = slashCommandBareName(command.name);
	const title = slashCommandTitle(name);
	return {
		id: title,
		label: title,
		description: command.description,
		itemType: 'slashCommand',
		insertText: title,
		bookmarked: extras?.bookmarked === true,
		recent: extras?.recent === true,
		slashSource: command.prompt?.trim() ? 'prompt' : 'builtin',
	};
}

function slashSection(id: KnoxGuiSlashSectionId, items: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestSection | undefined {
	if (!items.length) {
		return undefined;
	}
	return { id, labelKey: SLASH_SECTION_KEYS[id], items };
}

export function groupSlashItems(items: IKnoxGuiSuggestItem[], options: { query?: string } = {}): IKnoxGuiSuggestSection[] {
	const selectable = items.filter(item => !isMentionUtilityItem(item));
	const query = (options.query ?? '').trim();
	if (query) {
		return [slashSection('commands', selectable)].filter((row): row is IKnoxGuiSuggestSection => !!row);
	}
	const bookmarked: IKnoxGuiSuggestItem[] = [];
	const recent: IKnoxGuiSuggestItem[] = [];
	const commands: IKnoxGuiSuggestItem[] = [];
	const prompts: IKnoxGuiSuggestItem[] = [];
	for (const item of selectable) {
		if (item.bookmarked) {
			bookmarked.push(item);
			continue;
		}
		if (item.recent) {
			recent.push(item);
			continue;
		}
		if (item.slashSource === 'prompt') {
			prompts.push(item);
			continue;
		}
		commands.push(item);
	}
	return [slashSection('bookmarked', bookmarked), slashSection('recent', recent), slashSection('commands', commands), slashSection('prompts', prompts)].filter((row): row is IKnoxGuiSuggestSection => !!row);
}

export function shouldShowSlashSectionHeaders(sections: IKnoxGuiSuggestSection[]): boolean {
	return sections.filter(section => section.items.length > 0).length > 1;
}

function slashFuzzyNameScore(name: string, query: string): number | null {
	const text = name.toLowerCase();
	const needle = query.toLowerCase();
	if (!needle) {
		return null;
	}
	let from = 0;
	let gaps = 0;
	for (const char of needle) {
		const found = text.indexOf(char, from);
		if (found === -1) {
			return null;
		}
		if (found > from) {
			gaps += found - from;
		}
		from = found + 1;
	}
	return 4000 - Math.min(gaps, 3999);
}

export function scoreSlashCommand(item: IKnoxGuiSuggestItem, query: string): number {
	const name = slashCommandBareName(item.id || item.label);
	const q = slashCommandBareName(query);
	let score = 0;
	if (item.bookmarked) {
		score += 200_000;
	}
	if (item.recent) {
		score += Math.max(80_000 - (0) * 1_000, 1_000);
	}
	if (!q) {
		return score;
	}
	const title = name.toLowerCase();
	const needle = q.toLowerCase();
	const description = (item.description ?? '').toLowerCase();
	let match = 0;
	if (title === needle) {
		match += 100_000;
	} else if (title.startsWith(needle)) {
		match += 50_000;
	} else if (title.includes(needle)) {
		match += 25_000;
	}
	if (description.includes(needle)) {
		match += 8_000;
	}
	if (!match) {
		const fuzzy = slashFuzzyNameScore(name, q);
		if (fuzzy != null) {
			match += fuzzy;
		}
	}
	if (!match) {
		return 0;
	}
	return score + match - Math.min(name.length, 50);
}

export function rankSlashCommands(items: IKnoxGuiSuggestItem[], query: string): IKnoxGuiSuggestItem[] {
	const q = query.trim();
	const scored = items.map((item, index) => ({ item, index, score: scoreSlashCommand(item, q) }));
	const visible = q ? scored.filter(row => row.score > 0) : scored;
	visible.sort((a, b) => b.score !== a.score ? b.score - a.score : a.index - b.index);
	return visible.map(row => row.item);
}

export function mentionOptionId(index: number): string {
	return `mention-option-${index}`;
}

export function wrapMentionIndex(current: number, total: number, delta: number): number {
	if (total <= 0) {
		return 0;
	}
	return (current + delta + total) % total;
}

export type MentionListKeyAction =
	| { type: 'move'; index: number }
	| { type: 'select' }
	| { type: 'close' }
	| { type: 'ignore' };

export function mentionListKeyAction(key: string, selectedIndex: number, total: number): MentionListKeyAction {
	switch (key) {
		case 'ArrowUp':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, -1) };
		case 'ArrowDown':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, 1) };
		case 'Home':
			return { type: 'move', index: 0 };
		case 'End':
			return { type: 'move', index: Math.max(0, total - 1) };
		case 'Enter':
		case 'Tab':
			return { type: 'select' };
		case 'Escape':
			return { type: 'close' };
		case ' ':
			return total === 1 ? { type: 'select' } : { type: 'ignore' };
		default:
			return { type: 'ignore' };
	}
}

export function shouldLiveSearchMentions(query: string, existing: IKnoxGuiSuggestItem[]): boolean {
	if (query.trim().length < LIVE_MENTION_MIN_QUERY) {
		return false;
	}
	const selectable = existing.filter(item => item.itemType !== 'action');
	if (selectable.length > 0 && selectable.every(item => item.itemType === 'slashCommand')) {
		return false;
	}
	return existing.filter(item => isPathMentionItem(item)).length < LIVE_MENTION_HIT_THRESHOLD;
}

export function mergeLiveMentionItems(existing: IKnoxGuiSuggestItem[], live: IKnoxGuiSuggestItem[]): IKnoxGuiSuggestItem[] {
	const seen = new Set(existing.map(item => item.id || item.label).filter(Boolean));
	const extras = live.filter(item => {
		const key = item.id || item.label;
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return extras.length ? [...existing, ...extras] : existing;
}

export function splitCamelCaseAndNonAlphaNumeric(value: string): string[] {
	return value
		.split(/(?<=[a-z0-9])(?=[A-Z])|[^a-zA-Z0-9]/)
		.filter(token => token.length > 0)
		.map(token => token.toLowerCase());
}

function normalizeMentionText(value: string): string {
	return value.toLowerCase().replace(/\\/g, '/');
}

function pathMatchesQuery(path: string, query: string): 'substring' | 'segments' | false {
	const p = normalizeMentionText(path);
	const q = normalizeMentionText(query);
	if (!q) {
		return false;
	}
	if (p.includes(q)) {
		return 'substring';
	}
	if (!q.includes('/')) {
		return false;
	}
	let from = 0;
	for (const part of q.split('/').filter(Boolean)) {
		const found = p.indexOf(part, from);
		if (found === -1) {
			return false;
		}
		from = found + part.length;
	}
	return 'segments';
}

function camelTokenMatches(title: string, query: string): boolean {
	const q = normalizeMentionText(query);
	return splitCamelCaseAndNonAlphaNumeric(title).some(token => token === q || token.startsWith(q));
}

export function mentionItemMatchesQuery(item: { label: string; description?: string }, query: string): boolean {
	const q = query.trim();
	if (!q) {
		return true;
	}
	const title = normalizeMentionText(item.label);
	const needle = normalizeMentionText(q);
	if (title.includes(needle) || camelTokenMatches(item.label, q)) {
		return true;
	}
	return pathMatchesQuery(item.description ?? '', q) !== false;
}

const MENTION_SCORE_OPEN_FILE = 1_000_000;
const MENTION_SCORE_EXACT = 100_000;
const MENTION_SCORE_PREFIX = 50_000;
const MENTION_SCORE_CAMEL = 25_000;
const MENTION_SCORE_PATH_SUBSTRING = 10_000;
const MENTION_SCORE_PATH_SEGMENTS = 5_000;

export function scoreMentionItem(item: IKnoxGuiSuggestItem & { score?: number }, query: string, openFileIds: Set<string>): number {
	let score = openFileIds.has(item.id) ? MENTION_SCORE_OPEN_FILE : 0;
	const q = query.trim();
	const path = item.description ?? '';
	if (!q) {
		return score - Math.min(path.length, 200);
	}
	const title = normalizeMentionText(item.label);
	const needle = normalizeMentionText(q);
	if (title === needle) {
		score += MENTION_SCORE_EXACT;
	} else if (title.startsWith(needle)) {
		score += MENTION_SCORE_PREFIX;
	} else if (camelTokenMatches(item.label, q)) {
		score += MENTION_SCORE_CAMEL;
	}
	const pathHit = pathMatchesQuery(path, q);
	if (pathHit === 'substring') {
		score += MENTION_SCORE_PATH_SUBSTRING;
	} else if (pathHit === 'segments') {
		score += MENTION_SCORE_PATH_SEGMENTS;
	}
	score += Math.min(item.score ?? 0, 999);
	return score - Math.min(path.length, 200);
}

/**
 * File-picker order: open files, exact basename, prefix / camelCase token,
 * path match; files beat folders on a tie, then shorter paths.
 */
export function rankMentionItems<T extends IKnoxGuiSuggestItem & { score?: number }>(items: T[], query: string, openFileIds: Iterable<string> = []): T[] {
	const open = openFileIds instanceof Set ? openFileIds : new Set(openFileIds);
	return [...items].sort((a, b) => {
		const delta = scoreMentionItem(b, query, open) - scoreMentionItem(a, query, open);
		if (delta !== 0) {
			return delta;
		}
		const folderDelta = Number(isFolderMentionItem(a)) - Number(isFolderMentionItem(b));
		if (folderDelta !== 0) {
			return folderDelta;
		}
		const pathDelta = (a.description ?? '').length - (b.description ?? '').length;
		if (pathDelta !== 0) {
			return pathDelta;
		}
		return a.label.localeCompare(b.label);
	});
}

function uriPath(uri: string): string {
	return uri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/\\/g, '/');
}

function relativePathOrBasename(uri: string, dirs: string[]): string {
	const path = uriPath(uri);
	for (const dir of dirs) {
		const base = uriPath(dir).replace(/\/+$/, '');
		if (base && path.startsWith(`${base}/`)) {
			return path.slice(base.length + 1);
		}
	}
	return path.split('/').pop() ?? path;
}

/** Last `n` segments of the workspace-relative path (`getLastNUriRelativePathParts`). */
export function lastRelativePathParts(uri: string, dirs: string[], n: number): string {
	return relativePathOrBasename(uri, dirs).split('/').slice(-n).join('/');
}

/** Shortest path suffix that is unique among `uris`, relative to the workspace. */
export function shortestUniqueRelativePaths(uris: string[], dirs: string[]): Array<{ uri: string; uniquePath: string }> {
	const counts = new Map<string, number>();
	const info = uris.map(uri => {
		const relative = relativePathOrBasename(uri, dirs);
		const segments = relative.split('/');
		const suffixes: string[] = [];
		for (let i = segments.length - 1; i >= 0; i--) {
			const suffix = segments.slice(i).join('/');
			suffixes.push(suffix);
			counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
		}
		return { uri, relative, suffixes };
	});
	return info.map(({ uri, relative, suffixes }) => ({
		uri,
		uniquePath: suffixes.find(suffix => counts.get(suffix) === 1) ?? relative,
	}));
}

export function openFileSuggestItems(uris: string[], dirs: string[]): IKnoxGuiSuggestItem[] {
	return shortestUniqueRelativePaths(uris, dirs).map(({ uri, uniquePath }) => ({
		id: uri,
		label: uriPath(uri).split('/').pop() || uri,
		description: uniquePath,
		itemType: 'file',
		query: uri,
		icon: 'file',
	}));
}

export function openFilesChanged(next: string[], previous: string[]): boolean {
	if (next.length !== previous.length) {
		return true;
	}
	const old = new Set(previous);
	return next.some(uri => !old.has(uri));
}

/** Open files that match `query` and are not already in `rows`, appended for ranking. */
export function mergeOpenFileMentions(rows: IKnoxGuiSuggestItem[], openFiles: IKnoxGuiSuggestItem[], query: string): IKnoxGuiSuggestItem[] {
	const seen = new Set(rows.map(row => row.id));
	const extras = openFiles.filter(open => !seen.has(open.id) && mentionItemMatchesQuery(open, query));
	return extras.length ? [...rows, ...extras] : rows;
}

export const MENTION_FLOATING_OFFSET = 6;
export const MENTION_FLOATING_PADDING = 8;
export const MENTION_PANEL_MAX_WIDTH = 420;
export const MENTION_PANEL_MAX_HEIGHT_RATIO = 0.4;

export function preferredMentionPlacement(anchorBottom: number, viewportHeight: number): 'top' | 'bottom' {
	if (viewportHeight <= 0) {
		return 'bottom';
	}
	return viewportHeight - anchorBottom < viewportHeight / 3 ? 'top' : 'bottom';
}

/**
 * `getSuggestion.ts` floating-ui setup without the library: prefer the roomier
 * side, flip when the panel does not fit, shift inside the viewport, cap at
 * 420px wide and 40% of the viewport tall.
 */
export function mentionFloatingPosition(args: {
	anchor: { left: number; top: number; bottom: number };
	viewport: { width: number; height: number };
	contentHeight: number;
}): { left: number; top: number; width: number; maxHeight: number; placement: 'top' | 'bottom' } {
	const { anchor, viewport } = args;
	const pad = MENTION_FLOATING_PADDING;
	const width = Math.max(0, Math.min(viewport.width - pad * 2, MENTION_PANEL_MAX_WIDTH));
	const above = Math.max(0, anchor.top - MENTION_FLOATING_OFFSET - pad);
	const below = Math.max(0, viewport.height - anchor.bottom - MENTION_FLOATING_OFFSET - pad);
	const cap = Math.max(0, viewport.height * MENTION_PANEL_MAX_HEIGHT_RATIO);
	let placement = preferredMentionPlacement(anchor.bottom, viewport.height);
	const wanted = Math.min(args.contentHeight, cap);
	const room = placement === 'top' ? above : below;
	const other = placement === 'top' ? below : above;
	if (wanted > room && other > room) {
		placement = placement === 'top' ? 'bottom' : 'top';
	}
	const maxHeight = Math.min(placement === 'top' ? above : below, cap);
	const height = Math.min(args.contentHeight, maxHeight);
	const left = Math.max(pad, Math.min(anchor.left, viewport.width - pad - width));
	const top = placement === 'top' ? anchor.top - MENTION_FLOATING_OFFSET - height : anchor.bottom + MENTION_FLOATING_OFFSET;
	return { left, top, width, maxHeight, placement };
}

export function mentionItemKey(item: IKnoxGuiSuggestItem): string {
	return item.id || item.query || item.label;
}

/** Keep the same row selected when the list refreshes underneath it. */
export function nextMentionSelectedIndex(items: IKnoxGuiSuggestItem[], previousItems: IKnoxGuiSuggestItem[], previousIndex: number): number {
	if (!items.length) {
		return 0;
	}
	const prev = previousItems[previousIndex];
	if (!prev) {
		return 0;
	}
	const key = mentionItemKey(prev);
	const next = items.findIndex(item => mentionItemKey(item) === key);
	return next >= 0 ? next : 0;
}

/** Keep the last rows while a refetch is in flight so the panel does not blink. */
export function retainMentionItemsWhileLoading(incoming: IKnoxGuiSuggestItem[], previous: IKnoxGuiSuggestItem[], loading: boolean): IKnoxGuiSuggestItem[] {
	const selectable = incoming.filter(item => !isMentionUtilityItem(item));
	if (!selectable.length && previous.length && (loading || incoming.some(item => item.id === MENTION_LOADING_ID))) {
		return previous;
	}
	return incoming;
}

export function isPathMentionNode(node: { itemType?: string; icon?: string }): boolean {
	return node.itemType === 'file' || node.itemType === 'folder' || node.icon === 'file' || node.icon === 'folder';
}

export function isFolderMentionNode(node: { itemType?: string; icon?: string }): boolean {
	return node.itemType === 'folder' || node.icon === 'folder';
}

/** File and folder chips open in the editor; provider chips (diff, problems) do not. */
export function mentionChipOpenUri(node: { itemType?: string; icon?: string; query?: string; id?: string }): string | undefined {
	if (!isPathMentionNode(node)) {
		return undefined;
	}
	const uri = (node.query || node.id || '').trim();
	return uri || undefined;
}

/** Chip hover text: description, else the clean path of the file URI. */
export function mentionChipTooltip(node: { itemType?: string; icon?: string; query?: string; id?: string; description?: string }): string | undefined {
	const description = node.description?.trim();
	if (description) {
		return description;
	}
	const uri = mentionChipOpenUri(node);
	if (!uri) {
		return undefined;
	}
	const path = uriPath(uri);
	return path || uri;
}

export function mentionChipFilename(node: { label?: string; description?: string; id?: string }): string {
	return node.label || node.description || node.id || '';
}

export function isSlashBookmarked(bookmarked: readonly string[], name: string): boolean {
	const bare = slashCommandBareName(name);
	return bookmarked.some(entry => slashCommandBareName(entry) === bare);
}

/** Bookmarks are stored by bare name so the prompts list and `/` dropdown agree. */
export function toggleSlashBookmark(bookmarked: readonly string[], name: string): string[] {
	const bare = slashCommandBareName(name);
	if (isSlashBookmarked(bookmarked, bare)) {
		return bookmarked.filter(entry => slashCommandBareName(entry) !== bare);
	}
	return [...bookmarked.map(entry => slashCommandBareName(entry)), bare];
}

export type MentionHighlightSegment = { text: string; matched: boolean };

export function highlightMentionMatch(text: string, query: string): MentionHighlightSegment[] {
	if (!text) {
		return [{ text: '', matched: false }];
	}
	const needle = query.trim();
	if (!needle) {
		return [{ text, matched: false }];
	}
	const idx = text.toLowerCase().indexOf(needle.toLowerCase());
	if (idx !== -1) {
		return [
			...(idx > 0 ? [{ text: text.slice(0, idx), matched: false }] : []),
			{ text: text.slice(idx, idx + needle.length), matched: true },
			...(idx + needle.length < text.length ? [{ text: text.slice(idx + needle.length), matched: false }] : []),
		];
	}
	return [{ text, matched: false }];
}

export function extractImageUrls(content: unknown): string[] {
	if (typeof content === 'string') {
		return [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const urls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}
		const rec = part as Record<string, unknown>;
		if (rec.type === 'imageUrl') {
			const imageUrl = rec.imageUrl && typeof rec.imageUrl === 'object' ? (rec.imageUrl as Record<string, unknown>).url : rec.url;
			if (typeof imageUrl === 'string') {
				urls.push(imageUrl);
			}
		}
	}
	return urls;
}

export function imagePreviewPosition(rect: DOMRect, viewportWidth: number, viewportHeight: number): { x: number; y: number; below: boolean } {
	const previewWidth = 324;
	const previewHeight = 224;
	let x = rect.left + rect.width / 2;
	let y = rect.top - 10;
	if (x - previewWidth / 2 < 10) {
		x = previewWidth / 2 + 10;
	} else if (x + previewWidth / 2 > viewportWidth - 10) {
		x = viewportWidth - previewWidth / 2 - 10;
	}
	let below = false;
	if (y - previewHeight < 10) {
		y = rect.bottom + 10;
		below = true;
	}
	void viewportHeight;
	return { x, y, below };
}

export function mentionIndexIsTruncated(items: Array<{ id?: string; truncated?: boolean; truncatedCount?: number }>): { truncated: boolean; count: number } {
	const marker = items.find(item => item.id === MENTION_TRUNCATED_ID || item.truncated);
	return { truncated: marker != null, count: marker?.truncatedCount ?? 10_000 };
}

export function truncatedMentionMarker(count: number): IKnoxGuiSuggestItem {
	return { id: MENTION_TRUNCATED_ID, label: '', itemType: 'action', truncated: true, truncatedCount: count };
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

export function parseUriList(raw: string): string[] {
	return raw.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#') && (line.startsWith('file:') || line.startsWith('/')));
}

export function isDroppedImageFile(file: { type: string; name: string }): boolean {
	return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

/** `tiptap/imageUtils.ts`: accepted MIME types (SVG is listed as `image/svg`, so real `image/svg+xml` files are refused). */
export const KNOX_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg', 'image/webp'];
export const KNOX_IMAGE_MAX_MB = 10;
export const KNOX_IMAGE_RESOLUTION = 1024;
export const KNOX_IMAGE_JPEG_QUALITY = 0.7;

export function knoxGuiImageFileAccepted(file: { type: string; size: number; name?: string }): boolean {
	if (file.size / 1024 / 1024 >= KNOX_IMAGE_MAX_MB) {
		return false;
	}
	if (KNOX_IMAGE_TYPES.includes(file.type) || file.type === 'image/svg+xml') {
		return true;
	}
	// OS pickers often leave `type` empty; match the drop-path extension check.
	return !file.type && isDroppedImageFile({ type: file.type, name: file.name ?? '' });
}

/** `getDataUrlForFile`: scales to fit 1024×1024, up or down. */
export function knoxGuiImageTargetSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(KNOX_IMAGE_RESOLUTION / width, KNOX_IMAGE_RESOLUTION / height);
	return { width: width * scale, height: height * scale };
}

/** `handleMultipleImageFiles` summary toast. */
export function knoxGuiImageUploadToast(success: number, total: number, failed: number): { level: 'warning' | 'info'; key: string; params: Record<string, number> } | undefined {
	if (failed > 0) {
		return success > 0 ? { level: 'warning', key: 'imageUploadPartialSuccess', params: { success, total, failed } } : undefined;
	}
	return success > 1 ? { level: 'info', key: 'imageUploadSuccess', params: { count: success } } : undefined;
}

/** `TipTapEditor.tsx` drag handlers: only image items raise the overlay. */
export function knoxGuiDragHasImages(items: ReadonlyArray<{ type: string }>): boolean {
	return items.some(item => item.type.startsWith('image/'));
}

export const KNOX_DRAG_LEAVE_HIDE_MS = 1000;

export const MAX_COMPOSER_INPUT_HISTORY = 100;

export interface IKnoxGuiComposerInputHistory {
	entries: IKnoxGuiInputBlock[][];
	index: number;
	pending: IKnoxGuiInputBlock[];
}

export function createComposerInputHistory(): IKnoxGuiComposerInputHistory {
	return { entries: [], index: 0, pending: emptyInputDoc() };
}

function isInlineNode(value: unknown): value is KnoxGuiInlineNode {
	const node = value as KnoxGuiInlineNode | undefined;
	if (!node || typeof node !== 'object') {
		return false;
	}
	if (node.type === 'text') {
		return typeof node.text === 'string';
	}
	return (node.type === 'mention' || node.type === 'slash') && typeof node.id === 'string' && typeof node.label === 'string';
}

function isInputBlock(value: unknown): value is IKnoxGuiInputBlock {
	const block = value as IKnoxGuiInputBlock | undefined;
	if (!block || typeof block !== 'object') {
		return false;
	}
	if (block.type === 'paragraph') {
		return Array.isArray(block.content) && block.content.every(isInlineNode);
	}
	return block.type === 'codeBlock' && typeof block.code === 'string';
}

/** `useInputHistory.ts` load: drop malformed entries, keep the last 100, start past the end. */
export function composerInputHistoryFromStorage(raw: string | undefined): IKnoxGuiComposerInputHistory {
	let parsed: unknown;
	try {
		parsed = raw ? JSON.parse(raw) : [];
	} catch {
		parsed = [];
	}
	const entries = (Array.isArray(parsed) ? parsed : [])
		.filter((doc): doc is IKnoxGuiInputBlock[] => Array.isArray(doc) && doc.length > 0 && doc.every(isInputBlock))
		.slice(-MAX_COMPOSER_INPUT_HISTORY);
	return { entries, index: entries.length, pending: emptyInputDoc() };
}

function inputDocsEqual(a: IKnoxGuiInputBlock[], b: IKnoxGuiInputBlock[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function composerInputHistoryPrev(history: IKnoxGuiComposerInputHistory, current: IKnoxGuiInputBlock[]): { history: IKnoxGuiComposerInputHistory; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = history.index;
	const pending = index === history.entries.length ? cloneInputDoc(current) : history.pending;
	if (index > 0 && index <= history.entries.length) {
		return {
			history: { entries: history.entries, index: index - 1, pending },
			doc: cloneInputDoc(history.entries[index - 1]),
		};
	}
	return undefined;
}

export function composerInputHistoryNext(history: IKnoxGuiComposerInputHistory): { history: IKnoxGuiComposerInputHistory; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = history.index;
	if (index >= 0 && index < history.entries.length) {
		const nextIndex = index + 1;
		const doc = index === history.entries.length - 1 ? cloneInputDoc(history.pending) : cloneInputDoc(history.entries[nextIndex]);
		return { history: { ...history, index: nextIndex }, doc };
	}
	return undefined;
}

export function composerInputHistoryAdd(history: IKnoxGuiComposerInputHistory, doc: IKnoxGuiInputBlock[]): IKnoxGuiComposerInputHistory {
	if (history.entries.length && inputDocsEqual(history.entries[history.entries.length - 1], doc)) {
		return { entries: history.entries, index: history.entries.length, pending: emptyInputDoc() };
	}
	const entries = [...history.entries, cloneInputDoc(doc)].slice(-MAX_COMPOSER_INPUT_HISTORY);
	return { entries, index: entries.length, pending: emptyInputDoc() };
}

/** tiptap `UndoRedo` defaults: 100 steps, edits within 500 ms form one step. */
export const KNOX_COMPOSER_UNDO_DEPTH = 100;
export const KNOX_COMPOSER_UNDO_GROUP_MS = 500;

export interface IKnoxGuiComposerUndo {
	/** Doc states, oldest first; `index` points at the current one. */
	stack: IKnoxGuiInputBlock[][];
	index: number;
	lastAt: number;
}

export function createComposerUndo(doc: IKnoxGuiInputBlock[] = emptyInputDoc()): IKnoxGuiComposerUndo {
	return { stack: [cloneInputDoc(doc)], index: 0, lastAt: 0 };
}

export function composerUndoRecord(undo: IKnoxGuiComposerUndo, doc: IKnoxGuiInputBlock[], now: number): IKnoxGuiComposerUndo {
	const current = undo.stack[undo.index];
	if (current && JSON.stringify(current) === JSON.stringify(doc)) {
		return undo;
	}
	const kept = undo.stack.slice(0, undo.index + 1);
	const grouped = undo.index > 0 && now - undo.lastAt < KNOX_COMPOSER_UNDO_GROUP_MS;
	if (grouped) {
		kept[kept.length - 1] = cloneInputDoc(doc);
	} else {
		kept.push(cloneInputDoc(doc));
	}
	const stack = kept.slice(-(KNOX_COMPOSER_UNDO_DEPTH + 1));
	return { stack, index: stack.length - 1, lastAt: now };
}

export function composerUndoStep(undo: IKnoxGuiComposerUndo, delta: -1 | 1): { undo: IKnoxGuiComposerUndo; doc: IKnoxGuiInputBlock[] } | undefined {
	const index = undo.index + delta;
	if (index < 0 || index >= undo.stack.length) {
		return undefined;
	}
	return { undo: { ...undo, index, lastAt: 0 }, doc: cloneInputDoc(undo.stack[index]) };
}

export type KnoxGuiComposerKeyAction =
	| { type: 'submit'; altKey: boolean }
	| { type: 'newline' }
	| { type: 'block-backspace' }
	| { type: 'accept-diffs' }
	| { type: 'reject-diffs' }
	| { type: 'history-prev' }
	| { type: 'history-next' }
	| { type: 'suggest'; action: MentionListKeyAction }
	| { type: 'exit-submenu' }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'ignore' };

export function knoxGuiIsMetaEquivalent(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
	return event.metaKey || event.ctrlKey;
}

/** CJK IME: `isComposing`, or `keyCode` 229 on the first keydown before composition has started. */
export function knoxGuiIsImeComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
	return Boolean(event.isComposing) || event.keyCode === 229;
}

export function knoxGuiComposerKeyAction(
	event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean; keyCode?: number },
	ctx: { suggestOpen: boolean; inSubmenu: boolean; isStreaming: boolean; caretAtStart: boolean; caretAtEnd: boolean; suggestSelected: number; suggestCount: number },
): KnoxGuiComposerKeyAction {
	// IME composition (CJK candidate confirm etc.) must never submit, navigate or close pickers (ProseMirror ignores keys while composing).
	if (knoxGuiIsImeComposing(event)) {
		return { type: 'ignore' };
	}
	const meta = knoxGuiIsMetaEquivalent(event);
	const key = event.key.toLowerCase();
	if (meta && !event.altKey && ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey))) {
		return { type: 'redo' };
	}
	if (meta && !event.altKey && key === 'z') {
		return { type: 'undo' };
	}
	if (event.key === 'Enter' && meta && event.shiftKey) {
		return { type: 'accept-diffs' };
	}
	if (event.key === 'Backspace' && meta && event.shiftKey) {
		return { type: 'reject-diffs' };
	}
	if (event.key === 'Backspace' && meta && !event.shiftKey) {
		return ctx.isStreaming ? { type: 'block-backspace' } : { type: 'ignore' };
	}
	if (event.key === 'Enter' && meta) {
		return { type: 'submit', altKey: event.altKey };
	}
	if (event.key === 'Enter' && event.altKey && !event.shiftKey) {
		return { type: 'submit', altKey: true };
	}
	if (ctx.suggestOpen) {
		if (event.key === 'ArrowLeft' && ctx.inSubmenu) {
			return { type: 'exit-submenu' };
		}
		const action = mentionListKeyAction(event.key, ctx.suggestSelected, ctx.suggestCount);
		if (action.type !== 'ignore') {
			return { type: 'suggest', action };
		}
		return { type: 'ignore' };
	}
	if (event.key === 'Enter') {
		return event.shiftKey ? { type: 'newline' } : { type: 'submit', altKey: event.altKey };
	}
	if (event.key === 'ArrowUp' && ctx.caretAtStart) {
		return { type: 'history-prev' };
	}
	if (event.key === 'ArrowDown' && ctx.caretAtEnd) {
		return { type: 'history-next' };
	}
	return { type: 'ignore' };
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
