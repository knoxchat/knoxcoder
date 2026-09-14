/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxSplitCamelCaseAndNonAlphaNumeric } from './knoxMentions.js';
import type { IKnoxSlashCommand } from './knoxChatTypes.js';

export const AUTONOMOUS_SLASH_COMMAND = 'autonomous';

export const KNOX_MAX_RECENT_SLASH_COMMANDS = 8;
export const KNOX_RECENT_SLASH_STORAGE_KEY = 'knox.recentSlashCommands';
export const KNOX_SLASH_ACCEPT_CHIP_COMMAND_ID = 'knox.native.slash.acceptChip';

export function knoxRecentSlashStorageKey(profileId: string | undefined): string {
	return profileId ? `${KNOX_RECENT_SLASH_STORAGE_KEY}.${profileId}` : KNOX_RECENT_SLASH_STORAGE_KEY;
}

export type KnoxSlashSource = 'builtin' | 'prompt';
export type KnoxSlashSectionId = 'bookmarked' | 'recent' | 'commands' | 'prompts';

export interface IKnoxSlashItem {
	title: string;
	description: string;
	id: string;
	label: string;
	type: 'slashCommand';
	icon: string;
	metadata: {
		slashSource: KnoxSlashSource;
		bookmarked?: boolean;
		recent?: boolean;
		recentIndex?: number;
	};
}

export interface IKnoxSlashSection {
	id: KnoxSlashSectionId;
	labelKey: string;
	items: IKnoxSlashItem[];
}

export interface IKnoxSlashChip {
	id: string;
	label: string;
	description?: string;
}

export interface IKnoxSlashTrigger {
	/** 0-based offset of the `/`. */
	at: number;
	query: string;
}

export interface IKnoxSlashSuggestResult {
	items: IKnoxSlashItem[];
	sections: IKnoxSlashSection[];
	showHeaders: boolean;
}

const BOOKMARK = 200_000;
const RECENT = 80_000;
const EXACT = 100_000;
const PREFIX = 50_000;
const NAME_SUBSTRING = 25_000;
const CAMEL_TOKEN = 15_000;
const DESC_SUBSTRING = 8_000;
const FUZZY_NAME = 4_000;

const SECTION_LABEL_KEYS: Record<KnoxSlashSectionId, string> = {
	bookmarked: 'slashSectionBookmarked',
	recent: 'slashSectionRecent',
	commands: 'slashSectionCommands',
	prompts: 'slashSectionPrompts',
};

export function isAutonomousCommand(text: string): boolean {
	return new RegExp(`^\\/?${AUTONOMOUS_SLASH_COMMAND}\\b`, 'i').test(text.trim());
}

export function parseAutonomousGoal(text: string): string {
	return text.replace(new RegExp(`^\\/?${AUTONOMOUS_SLASH_COMMAND}\\b\\s*`, 'i'), '').trim();
}

/** Bare command name: `commit` from `commit` or `/commit`. */
export function slashCommandBareName(value: string | undefined | null): string {
	return (value ?? '').trim().replace(/^\//, '').trim();
}

/** Chip / dropdown title: `/commit`. */
export function slashCommandTitle(value: string | undefined | null): string {
	const bare = slashCommandBareName(value);
	return bare ? `/${bare}` : '/';
}

export function slashCommandNameFromItem(item: {
	id?: string;
	title?: string;
	label?: string;
}): string {
	return slashCommandBareName(item.id ?? item.title ?? item.label);
}

export function slashCommandSource(command: { prompt?: string }): KnoxSlashSource {
	return command.prompt?.trim() ? 'prompt' : 'builtin';
}

export function extractSlashUserInput(fullInput: string, commandName: string): string {
	const prefix = `/${slashCommandBareName(commandName)}`;
	if (fullInput.startsWith(prefix)) {
		return fullInput.slice(prefix.length).trimStart();
	}
	return fullInput;
}

export function expandPromptSlashCommand(prompt: string, userInput: string): string {
	if (prompt.includes('{{{ input }}}') || prompt.includes('{{{input}}}')) {
		return prompt.replace(/\{\{\{\s*input\s*\}\}\}/g, userInput).trim();
	}
	if (!userInput.trim()) {
		return prompt.trim();
	}
	return `${prompt.trim()}\n\n${userInput}`;
}

export function isPromptBasedSlashCommand(command: { prompt?: string }): boolean {
	return typeof command.prompt === 'string' && command.prompt.length > 0;
}

export function formatAskUserAnswers(answers: Record<string, string | string[]>): string {
	return Object.entries(answers)
		.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
		.join('\n');
}

export function slashCommandForInput(
	input: string,
	slashCommands: readonly IKnoxSlashCommand[],
): [IKnoxSlashCommand, string] | undefined {
	if (!input.startsWith('/')) {
		return undefined;
	}
	const slashCommand = slashCommands.find(command => {
		const name = slashCommandBareName(command.name);
		return input === `/${name}` || input.startsWith(`/${name} `);
	});
	if (!slashCommand) {
		return undefined;
	}
	return [slashCommand, input];
}

export function toKnoxSlashItem(
	command: IKnoxSlashCommand,
	extras?: {
		bookmarked?: boolean;
		recent?: boolean;
		recentIndex?: number;
	},
): IKnoxSlashItem {
	const name = slashCommandBareName(command.name);
	const title = slashCommandTitle(name);
	return {
		title,
		description: command.description ?? '',
		id: title,
		label: title,
		type: 'slashCommand',
		icon: name,
		metadata: {
			slashSource: slashCommandSource(command),
			bookmarked: extras?.bookmarked === true,
			recent: extras?.recent === true,
			recentIndex: extras?.recentIndex,
		},
	};
}

export function knoxSlashCatalog(
	commands: readonly IKnoxSlashCommand[],
	bookmarks: readonly string[] = [],
	recents: readonly string[] = [],
): IKnoxSlashItem[] {
	const bookmarkedSet = new Set(bookmarks.map(name => slashCommandBareName(name)));
	const recentIndex = new Map(recents.map((name, index) => [slashCommandBareName(name), index] as const));
	return commands.map(command => {
		const name = slashCommandBareName(command.name);
		const recency = recentIndex.get(name);
		return toKnoxSlashItem(command, {
			bookmarked: bookmarkedSet.has(name),
			recent: recency != null,
			recentIndex: recency,
		});
	});
}

function normalize(value: string): string {
	return value.toLowerCase();
}

function camelTokenMatches(name: string, query: string): boolean {
	const q = normalize(query);
	return knoxSplitCamelCaseAndNonAlphaNumeric(name).some(token => token === q || token.startsWith(q));
}

/**
 * Sequential character match (file-picker style). Higher when the query
 * characters sit closer together in the name.
 */
export function slashFuzzyNameScore(name: string, query: string): number | null {
	const text = normalize(name);
	const needle = normalize(query);
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
	return FUZZY_NAME - Math.min(gaps, FUZZY_NAME - 1);
}

function preferenceBoost(item: IKnoxSlashItem): number {
	let score = 0;
	if (item.metadata.bookmarked) {
		score += BOOKMARK;
	}
	if (item.metadata.recent) {
		const recency = item.metadata.recentIndex ?? 0;
		score += Math.max(RECENT - recency * 1_000, 1_000);
	}
	return score;
}

function queryMatchScore(item: IKnoxSlashItem, query: string): number {
	const name = slashCommandNameFromItem(item);
	const title = normalize(name);
	const needle = normalize(query);
	const description = normalize(item.description);

	let score = 0;
	if (title === needle) {
		score += EXACT;
	} else if (title.startsWith(needle)) {
		score += PREFIX;
	} else if (title.includes(needle)) {
		score += NAME_SUBSTRING;
	} else if (camelTokenMatches(name, query)) {
		score += CAMEL_TOKEN;
	}

	if (description.includes(needle)) {
		score += DESC_SUBSTRING;
	}

	if (score === 0 || (score === DESC_SUBSTRING && !title.includes(needle))) {
		const fuzzy = slashFuzzyNameScore(name, query);
		if (fuzzy != null) {
			score += fuzzy;
		}
	}

	if (score === 0) {
		return 0;
	}
	return score - Math.min(name.length, 50);
}

export function slashItemMatchesQuery(item: IKnoxSlashItem, query: string): boolean {
	const q = slashCommandBareName(query);
	if (!q) {
		return true;
	}
	return queryMatchScore(item, q) > 0;
}

export function scoreSlashCommand(item: IKnoxSlashItem, query: string): number {
	const q = slashCommandBareName(query);
	const boost = preferenceBoost(item);
	if (!q) {
		return boost;
	}
	const match = queryMatchScore(item, q);
	if (match <= 0) {
		return 0;
	}
	return boost + match;
}

/**
 * Rank slash commands: bookmarks, recents, exact / prefix / substring /
 * description / fuzzy. Empty query keeps every command.
 */
export function rankSlashCommands(items: readonly IKnoxSlashItem[], query: string): IKnoxSlashItem[] {
	const q = query.trim();
	const scored = items.map((item, index) => ({
		item,
		index,
		score: scoreSlashCommand(item, q),
	}));
	const visible = q ? scored.filter(row => row.score > 0) : scored;
	visible.sort((a, b) => {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return a.index - b.index;
	});
	return visible.map(row => row.item);
}

function section(id: KnoxSlashSectionId, items: IKnoxSlashItem[]): IKnoxSlashSection | undefined {
	if (items.length === 0) {
		return undefined;
	}
	return { id, labelKey: SECTION_LABEL_KEYS[id], items };
}

/**
 * Empty `/` groups Bookmarked, Recent, Commands, Prompts.
 * A query is a single ranked list (no headers) so prefix hits stay together.
 */
export function groupSlashItems(
	items: readonly IKnoxSlashItem[],
	options: { query?: string } = {},
): IKnoxSlashSection[] {
	const query = (options.query ?? '').trim();

	if (query) {
		return [section('commands', items.slice())].filter((row): row is IKnoxSlashSection => row != null);
	}

	const bookmarked: IKnoxSlashItem[] = [];
	const recent: IKnoxSlashItem[] = [];
	const commands: IKnoxSlashItem[] = [];
	const prompts: IKnoxSlashItem[] = [];

	for (const item of items) {
		if (item.metadata.bookmarked) {
			bookmarked.push(item);
			continue;
		}
		if (item.metadata.recent) {
			recent.push(item);
			continue;
		}
		if (item.metadata.slashSource === 'prompt') {
			prompts.push(item);
			continue;
		}
		commands.push(item);
	}

	return [
		section('bookmarked', bookmarked),
		section('recent', recent),
		section('commands', commands),
		section('prompts', prompts),
	].filter((row): row is IKnoxSlashSection => row != null);
}

export function shouldShowSlashSectionHeaders(sections: Array<{ items: unknown[] }>): boolean {
	return sections.filter(row => row.items.length > 0).length > 1;
}

export function knoxFlattenSlashSections(sections: readonly IKnoxSlashSection[]): IKnoxSlashItem[] {
	return sections.flatMap(row => row.items);
}

export function knoxSuggestSlashItems(args: {
	commands: readonly IKnoxSlashCommand[];
	bookmarks?: readonly string[];
	recents?: readonly string[];
	query: string;
}): IKnoxSlashSuggestResult {
	const ranked = rankSlashCommands(
		knoxSlashCatalog(args.commands, args.bookmarks ?? [], args.recents ?? []),
		args.query,
	);
	const sections = groupSlashItems(ranked, { query: args.query });
	return {
		items: knoxFlattenSlashSections(sections),
		sections,
		showHeaders: shouldShowSlashSectionHeaders(sections),
	};
}

/**
 * Slash trigger at `offset` (0-based, exclusive end). `/` only at start of
 * line (optional leading whitespace), matching TipTap `startOfLine` + `allow()`.
 */
export function knoxSlashTriggerAt(text: string, offset: number): IKnoxSlashTrigger | undefined {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let slash = -1;
	for (let i = clamped - 1; i >= 0; i--) {
		const ch = text.charAt(i);
		if (ch === '/') {
			slash = i;
			break;
		}
		if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
			return undefined;
		}
	}
	if (slash < 0) {
		return undefined;
	}
	const lineStart = slash === 0 ? 0 : text.lastIndexOf('\n', slash - 1) + 1;
	if (text.slice(lineStart, slash).trim().length > 0) {
		return undefined;
	}
	return { at: slash, query: text.slice(slash + 1, clamped) };
}

export function knoxSlashChipLabel(attrs: { id?: string | null; label?: string | null }): string {
	return slashCommandTitle(attrs.label ?? attrs.id);
}

export function knoxSlashInsertText(item: { id?: string; title?: string; label?: string }): string {
	return `${slashCommandTitle(item.id ?? item.label ?? item.title)} `;
}

export function knoxSlashChipFromItem(item: IKnoxSlashItem): IKnoxSlashChip {
	return {
		id: item.id,
		label: knoxSlashChipLabel(item),
		description: item.description || undefined,
	};
}

export function knoxParseRecentSlashCommands(raw: string | undefined): string[] {
	if (raw === undefined) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.filter((item): item is string => typeof item === 'string')
			.map(name => slashCommandBareName(name))
			.filter(name => name.length > 0);
	} catch {
		return [];
	}
}

export function knoxRecordRecentSlash(previous: readonly string[], commandName: string): string[] {
	const name = slashCommandBareName(commandName);
	if (!name) {
		return previous.slice();
	}
	return [name, ...previous.filter(item => slashCommandBareName(item) !== name)].slice(0, KNOX_MAX_RECENT_SLASH_COMMANDS);
}
