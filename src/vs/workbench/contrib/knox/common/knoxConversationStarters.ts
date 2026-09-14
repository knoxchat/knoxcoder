/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxSlashCommand } from './knoxChatTypes.js';

export const KNOX_STARTER_CARD_LIMIT = 5;
export const KNOX_DEFAULT_BOOKMARK_COUNT = 5;
export const KNOX_BOOKMARKED_SLASH_STORAGE_KEY = 'knox.bookmarkedSlashCommands';

export function knoxBookmarkStorageKey(profileId: string | undefined): string {
	return profileId ? `${KNOX_BOOKMARKED_SLASH_STORAGE_KEY}.${profileId}` : KNOX_BOOKMARKED_SLASH_STORAGE_KEY;
}

export function knoxDefaultBookmarks(commands: readonly IKnoxSlashCommand[]): string[] {
	return commands.slice(0, KNOX_DEFAULT_BOOKMARK_COUNT).map(command => command.name);
}

export function knoxParseBookmarks(raw: string | undefined, fallback: readonly string[]): string[] {
	if (raw === undefined) {
		return fallback.slice();
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return fallback.slice();
		}
		return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
	} catch {
		return fallback.slice();
	}
}

export function knoxBookmarkedCommands(
	commands: readonly IKnoxSlashCommand[],
	bookmarks: readonly string[],
): IKnoxSlashCommand[] {
	const order = new Map(bookmarks.map((name, index) => [name, index] as const));
	return commands
		.filter(command => order.has(command.name))
		.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}

export function knoxVisibleStarters(
	commands: readonly IKnoxSlashCommand[],
	showAll: boolean,
	limit: number = KNOX_STARTER_CARD_LIMIT,
): { visible: IKnoxSlashCommand[]; remaining: number } {
	if (showAll || commands.length <= limit) {
		return { visible: commands.slice(), remaining: 0 };
	}
	return {
		visible: commands.slice(0, limit),
		remaining: commands.length - limit,
	};
}

export function knoxStarterInsertText(command: IKnoxSlashCommand): string {
	if (command.prompt?.trim()) {
		return command.prompt.trim();
	}
	return `/${command.name}`;
}
