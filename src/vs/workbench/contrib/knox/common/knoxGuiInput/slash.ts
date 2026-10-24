/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiSlashCommand, IKnoxGuiSuggestItem } from '../knoxGuiState.js';
import { slashCommandBareName, slashCommandTitle } from './doc.js';
import { isMentionUtilityItem, type IKnoxGuiSuggestSection } from './mentions.js';

/** Slash-command suggest items, grouping, ranking, and bookmarks. */

export type KnoxGuiSlashSectionId = 'bookmarked' | 'recent' | 'commands' | 'prompts';

const SLASH_SECTION_KEYS: Record<KnoxGuiSlashSectionId, string> = {
	bookmarked: 'slashSectionBookmarked',
	recent: 'slashSectionRecent',
	commands: 'slashSectionCommands',
	prompts: 'slashSectionPrompts',
};

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
		if (fuzzy !== null) {
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
