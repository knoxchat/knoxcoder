/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiContextProvider, IKnoxGuiSlashCommand, IKnoxGuiSuggestItem, IKnoxGuiToolCall, KnoxChatMode } from './knoxGuiState.js';

export { isSingleRangeEdit, isSingleRangeEditOrInsertion, shouldSendEditPrompt } from './knoxGuiEdit.js';

const ASK_USER_TOOL_NAMES = new Set(['builtin_ask_user', 'ask_user', 'AskUser']);

export type KnoxGuiInlineNode =
	| { type: 'text'; text: string }
	| { type: 'mention'; id: string; label: string; itemType?: string; query?: string; renderInlineAs?: string; description?: string }
	| { type: 'slash'; id: string; label: string };

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
}

export type IKnoxGuiInputBlock = IKnoxGuiInputParagraph | IKnoxGuiInputCodeBlock;

export type KnoxGuiComposerTrigger =
	| { kind: 'mention'; query: string }
	| { kind: 'slash'; query: string };

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
			return { ...block };
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

export function detectComposerTrigger(doc: IKnoxGuiInputBlock[]): KnoxGuiComposerTrigger | undefined {
	const last = [...doc].reverse().find((block): block is IKnoxGuiInputParagraph => block.type === 'paragraph');
	if (!last) {
		return undefined;
	}
	let trailing = '';
	for (const node of last.content) {
		if (node.type === 'text') {
			trailing += node.text;
		} else {
			trailing = '';
		}
	}
	const mention = trailing.match(/(?:^|\s)@([^\s]*)$/);
	if (mention) {
		return { kind: 'mention', query: mention[1] };
	}
	const firstParagraph = doc.find(block => block.type === 'paragraph') === last;
	const slash = trailing.match(/^\/([^\s]*)$/);
	if (slash && firstParagraph) {
		return { kind: 'slash', query: slash[1] };
	}
	return undefined;
}

function replaceTrailingText(paragraph: IKnoxGuiInputParagraph, pattern: RegExp, nodes: KnoxGuiInlineNode[]): IKnoxGuiInputParagraph {
	const content = paragraph.content.slice();
	for (let i = content.length - 1; i >= 0; i--) {
		const node = content[i];
		if (node.type !== 'text') {
			break;
		}
		const next = node.text.replace(pattern, '');
		if (next === node.text) {
			continue;
		}
		const prefix: KnoxGuiInlineNode[] = [];
		if (next) {
			prefix.push({ type: 'text', text: next });
		}
		return { type: 'paragraph', content: [...content.slice(0, i), ...prefix, ...nodes] };
	}
	return { type: 'paragraph', content: [...content, ...nodes] };
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

export function applySuggestToDoc(doc: IKnoxGuiInputBlock[], item: IKnoxGuiSuggestItem, kind: 'mention' | 'slash'): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc);
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	if (kind === 'slash') {
		const id = slashCommandTitle(item.id || item.label);
		next[index] = replaceTrailingText(paragraph, /(^|\s)\/\S*$/, [
			{ type: 'slash', id, label: id },
			{ type: 'text', text: ' ' },
		]);
		return next;
	}
	const chip: KnoxGuiInlineNode = {
		type: 'mention',
		id: item.id,
		label: item.label,
		itemType: item.itemType,
		query: item.query,
		renderInlineAs: item.renderInlineAs,
		description: item.description,
	};
	next[index] = replaceTrailingText(paragraph, /(^|\s)@[^\s]*$/, [
		chip,
		{ type: 'text', text: ' ' },
	]);
	return next;
}

export function appendTriggerToDoc(doc: IKnoxGuiInputBlock[], trigger: '@' | '/'): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc.length ? doc : emptyInputDoc());
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	const last = paragraph.content[paragraph.content.length - 1];
	const prefix = last?.type === 'text' && last.text && !/\s$/.test(last.text) ? ' ' : '';
	if (last?.type === 'text') {
		last.text += `${prefix}${trigger}`;
	} else {
		paragraph.content.push({ type: 'text', text: `${prefix}${trigger}` });
	}
	return next;
}

export function clearMentionQuery(doc: IKnoxGuiInputBlock[]): IKnoxGuiInputBlock[] {
	const next = cloneInputDoc(doc);
	const index = lastParagraphIndex(next);
	const paragraph = next[index] as IKnoxGuiInputParagraph;
	next[index] = replaceTrailingText(paragraph, /@[^\s]*$/, [{ type: 'text', text: '@' }]);
	return next;
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
	for (let i = state.history.length - 1; i >= 0; i--) {
		const pending = state.history[i].toolCalls?.find(call => call.status === 'generated');
		if (pending) {
			return !ASK_USER_TOOL_NAMES.has(pending.name);
		}
	}
	return false;
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
	};
}

export function fileHitToSuggestItem(hit: { id?: string; title?: string; path?: string; description?: string; icon?: string }): IKnoxGuiSuggestItem {
	const id = String(hit.id ?? hit.path ?? hit.title ?? 'file');
	const folder = hit.icon === 'folder';
	return {
		id,
		label: String(hit.title ?? hit.path ?? id),
		description: hit.description,
		itemType: folder ? 'folder' : 'file',
		query: id,
		icon: folder ? 'folder' : 'file',
	};
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
			return 0;
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

export function mentionItemMatchesQuery(item: { label: string; description?: string }, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) {
		return true;
	}
	const title = item.label.toLowerCase();
	if (title === q || title.startsWith(q) || title.includes(q)) {
		return true;
	}
	return (item.description ?? '').toLowerCase().includes(q);
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

export const MAX_COMPOSER_INPUT_HISTORY = 100;

export interface IKnoxGuiComposerInputHistory {
	entries: IKnoxGuiInputBlock[][];
	index: number;
	pending: IKnoxGuiInputBlock[];
}

export function createComposerInputHistory(): IKnoxGuiComposerInputHistory {
	return { entries: [], index: 0, pending: emptyInputDoc() };
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
	| { type: 'ignore' };

export function knoxGuiIsMetaEquivalent(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
	return event.metaKey || event.ctrlKey;
}

export function knoxGuiComposerKeyAction(
	event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean },
	ctx: { suggestOpen: boolean; inSubmenu: boolean; isStreaming: boolean; caretAtStart: boolean; caretAtEnd: boolean; suggestSelected: number; suggestCount: number },
): KnoxGuiComposerKeyAction {
	const meta = knoxGuiIsMetaEquivalent(event);
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
