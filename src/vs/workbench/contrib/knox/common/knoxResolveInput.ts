/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IKnoxContextItem,
	IKnoxMessageContent,
	IKnoxMessagePart,
	IKnoxTextPart,
	renderKnoxMessageContent,
} from './knoxChatTypes.js';
import { IKnoxMentionChip } from './knoxMentions.js';
import { IKnoxSlashChip, slashCommandTitle } from './knoxSlash.js';

export interface IKnoxRangeInFile {
	filepath: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	contents?: string;
}

export interface IKnoxDefaultContextProvider {
	name: string;
	query?: string;
}

export interface IKnoxNativeEditorState {
	mentions?: readonly IKnoxMentionChip[];
	slashCommands?: readonly IKnoxSlashChip[];
	/**
	 * Code-block context items inserted into the native input (highlighted code
	 * from IDE quick actions). Mirrors GUI codeBlock nodes: each item carries
	 * `filepath` + `contents` + range, and its contents are inlined into the
	 * prompt exactly like `resolveInput.ts` does for codeBlocks.
	 */
	codeBlocks?: readonly IKnoxCodeBlockContextItem[];
}

/** A highlighted-code code block attached to the input (GUI `contextItem`). */
export interface IKnoxCodeBlockContextItem {
	id?: string;
	name?: string;
	description?: string;
	content: string;
	filepath: string;
	range?: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

export interface IKnoxGetContextItemsRequest {
	name: string;
	query: string;
	fullInput: string;
	selectedCode: readonly IKnoxRangeInFile[];
	selectedModelTitle: string;
}

export type KnoxRequestContextItems = (data: IKnoxGetContextItemsRequest) => Promise<readonly IKnoxContextItem[]>;

export interface IKnoxResolveInput {
	content: IKnoxMessageContent;
	editorState?: unknown;
	defaultContextProviders?: readonly IKnoxDefaultContextProvider[];
	selectedModelTitle: string;
	selectedCode?: readonly IKnoxRangeInFile[];
	requestContextItems: KnoxRequestContextItems;
}

export interface IKnoxResolveInputResult {
	contextItems: IKnoxContextItem[];
	selectedCode: IKnoxRangeInFile[];
	content: IKnoxMessageContent;
	slashCommandId?: string;
}

/** File and folder chips both resolve through the `file` context provider. */
export function mentionContextProviderName(item: { id: string; itemType?: string }): string {
	if (item.itemType === 'file' || item.itemType === 'folder') {
		return 'file';
	}
	if (item.itemType === 'contextProvider' || !item.itemType) {
		return item.id;
	}
	return item.itemType;
}

export function knoxParseNativeEditorState(editorState: unknown): IKnoxNativeEditorState {
	if (!editorState || typeof editorState !== 'object') {
		return {};
	}
	const record = editorState as IKnoxNativeEditorState;
	return {
		mentions: Array.isArray(record.mentions) ? record.mentions : undefined,
		slashCommands: Array.isArray(record.slashCommands) ? record.slashCommands : undefined,
		codeBlocks: Array.isArray(record.codeBlocks) ? record.codeBlocks : undefined,
	};
}

/** File extension for the fenced code-block header, matching GUI `getUriFileExtension`. */
export function knoxFileExtension(filepath: string): string {
	const withoutQuery = filepath.split(/[?#]/)[0];
	const lastDot = withoutQuery.lastIndexOf('.');
	const lastSlash = withoutQuery.lastIndexOf('/');
	if (lastDot <= lastSlash + 1) {
		return '';
	}
	return withoutQuery.slice(lastDot + 1);
}

/**
 * Inline one highlighted-code block into the prompt, mirroring
 * `resolveInput.ts` codeBlock handling: a fenced block of the snippet with the
 * range description as the fence title.
 */
export function knoxCodeBlockInPrompt(block: IKnoxCodeBlockContextItem): string {
	const extension = knoxFileExtension(block.filepath);
	const description = block.description ?? block.name ?? block.filepath;
	return '\n\n' + '```' + extension + ' ' + description + '\n' + block.content + '\n```';
}

export function knoxParseDefaultContextProviders(raw: unknown): IKnoxDefaultContextProvider[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const providers: IKnoxDefaultContextProvider[] = [];
	for (const entry of raw) {
		if (typeof entry === 'string') {
			if (entry && entry !== 'activeFile') {
				providers.push({ name: entry });
			}
			continue;
		}
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const record = entry as { name?: unknown; provider?: unknown; query?: unknown };
		const name = typeof record.name === 'string'
			? record.name
			: typeof record.provider === 'string'
				? record.provider
				: '';
		if (!name || name === 'activeFile') {
			continue;
		}
		providers.push({
			name,
			query: typeof record.query === 'string' ? record.query : '',
		});
	}
	return providers;
}

export function knoxSlashIdFromEditorState(editorState: unknown): string | undefined {
	const slash = knoxParseNativeEditorState(editorState).slashCommands?.[0]?.id;
	if (typeof slash !== 'string' || !slash.trim()) {
		return undefined;
	}
	return slashCommandTitle(slash);
}

export function knoxHasSlashCommandOrContextProvider(editorState: unknown): boolean {
	const parsed = knoxParseNativeEditorState(editorState);
	if (parsed.slashCommands?.length) {
		return true;
	}
	return (parsed.mentions ?? []).some(item => item.itemType === 'contextProvider');
}

export function knoxFullInputForContext(content: IKnoxMessageContent, slashId?: string): string {
	const text = renderKnoxMessageContent(content);
	if (!slashId) {
		return text;
	}
	const slash = slashCommandTitle(slashId);
	if (text === slash || text === `${slash} `) {
		return '';
	}
	if (text.startsWith(`${slash} `) || text.startsWith(`${slash}\n`)) {
		return text.slice(slash.length + 1);
	}
	return text;
}

export function knoxPrefixSlashCommand(
	content: IKnoxMessageContent,
	slashId: string | undefined,
): IKnoxMessageContent {
	if (!slashId) {
		return content;
	}
	const slash = slashCommandTitle(slashId);
	const text = renderKnoxMessageContent(content);
	if (text === slash || text.startsWith(`${slash} `) || text.startsWith(`${slash}\n`)) {
		return content;
	}
	if (typeof content === 'string') {
		return content.length ? `${slash} ${content}` : `${slash} `;
	}
	const lastText = findLastIndex(content, part => part.type === 'text');
	if (lastText < 0) {
		return [...content, { type: 'text', text: `${slash} ` }];
	}
	const parts = content.slice();
	const previous = (parts[lastText] as IKnoxTextPart).text;
	parts[lastText] = { type: 'text', text: previous.length ? `${slash} ${previous}` : `${slash} ` };
	return parts;
}

export function knoxUserMessageWithContext(
	content: IKnoxMessageContent | undefined,
	contextItems: readonly IKnoxContextItem[],
): IKnoxMessageContent {
	const body: IKnoxMessagePart[] = Array.isArray(content)
		? [...content]
		: [{ type: 'text', text: content ?? '' }];
	if (!contextItems.length) {
		return content ?? '';
	}
	const ctxParts: IKnoxMessagePart[] = contextItems.map(item => ({
		type: 'text',
		text: `${item.content}\n`,
	}));
	return [...ctxParts, ...body];
}

/**
 * Convert native input chips to context items, matching GUI `resolveEditorContent`.
 * Mention / default-provider fetches run before slash is prefixed onto the message.
 */
export async function knoxResolveInput(options: IKnoxResolveInput): Promise<IKnoxResolveInputResult> {
	const selectedCode = [...(options.selectedCode ?? [])];
	const parsed = knoxParseNativeEditorState(options.editorState);
	const mentions = parsed.mentions ?? [];
	const codeBlocks = parsed.codeBlocks ?? [];
	const slashCommandId = knoxSlashIdFromEditorState(options.editorState);
	const fullInput = knoxFullInputForContext(options.content, slashCommandId);
	const contextItems: IKnoxContextItem[] = [];

	// Highlighted code: inline the snippet into the prompt and register the
	// range as selectedCode, matching GUI `resolveInput.ts` codeBlock handling.
	// GUI codeBlocks are inserted at the top of the editor, so their text
	// precedes the paragraph text.
	let content = options.content;
	for (const block of codeBlocks) {
		content = knoxPrependTextToContent(content, knoxCodeBlockInPrompt(block));
		selectedCode.push({
			filepath: block.filepath,
			range: block.range ?? knoxDefaultRangeForContents(block.content),
			contents: block.content,
		});
	}

	for (const mention of mentions) {
		const resolved = await options.requestContextItems({
			name: mentionContextProviderName(mention),
			query: mention.query ?? '',
			fullInput,
			selectedCode,
			selectedModelTitle: options.selectedModelTitle,
		});
		contextItems.push(...resolved);
	}

	const defaultProviders = options.defaultContextProviders ?? [];
	const defaultItems = await Promise.all(defaultProviders.map(provider => options.requestContextItems({
		name: provider.name,
		query: provider.query ?? '',
		fullInput,
		selectedCode,
		selectedModelTitle: options.selectedModelTitle,
	})));
	for (const items of defaultItems) {
		contextItems.push(...items);
	}

	return {
		contextItems,
		selectedCode,
		content: knoxPrefixSlashCommand(content, slashCommandId),
		slashCommandId,
	};
}

/** Prepend a code-block fragment so it precedes the paragraph text (GUI order). */
export function knoxPrependTextToContent(
	content: IKnoxMessageContent,
	text: string,
): IKnoxMessageContent {
	if (!text) {
		return content;
	}
	// `knoxCodeBlockInPrompt` starts with `\n\n`; trim it when the block is the
	// first thing in the message so the prompt does not begin with blank lines.
	const block = text.replace(/^\n+/, '');
	if (typeof content === 'string') {
		return content ? `${block}\n${content}` : block;
	}
	const parts = [...content];
	const first = parts[0];
	if (first?.type === 'text') {
		parts[0] = { type: 'text', text: `${block}\n${(first as IKnoxTextPart).text}` };
		return parts;
	}
	return [{ type: 'text', text: block }, ...parts];
}

/** Fallback range when a highlighted-code payload omits one. */
export function knoxDefaultRangeForContents(contents: string): IKnoxRangeInFile['range'] {
	const lines = contents.length ? contents.split('\n').length : 1;
	return {
		start: { line: 0, character: 0 },
		end: { line: Math.max(0, lines - 1), character: 0 },
	};
}

function findLastIndex<T>(array: readonly T[], predicate: (value: T) => boolean): number {
	for (let i = array.length - 1; i >= 0; i--) {
		if (predicate(array[i])) {
			return i;
		}
	}
	return -1;
}
