/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxSlashCommand } from './knoxChatTypes.js';

export interface IKnoxPromptDraft {
	name: string;
	description: string;
	prompt: string;
}

/** GUI AddPromptDialog: prefix `/` when the user omitted it. */
export function knoxFormatPromptCommandName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return '';
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function knoxPromptFormIsValid(draft: IKnoxPromptDraft): boolean {
	return Boolean(draft.name.trim() && draft.description.trim() && draft.prompt.trim());
}

export function knoxPromptPayload(draft: IKnoxPromptDraft): IKnoxPromptDraft {
	return {
		name: knoxFormatPromptCommandName(draft.name),
		description: draft.description.trim(),
		prompt: draft.prompt.trim(),
	};
}

export function knoxIsCommandBookmarked(bookmarks: readonly string[], commandName: string): boolean {
	return bookmarks.includes(commandName);
}

/** GUI PromptsSection: bookmarked rows first, otherwise original order. */
export function knoxSortSlashCommandsByBookmark(
	commands: readonly IKnoxSlashCommand[],
	bookmarks: readonly string[],
): IKnoxSlashCommand[] {
	return [...commands].sort((a, b) => {
		const aBookmarked = knoxIsCommandBookmarked(bookmarks, a.name);
		const bBookmarked = knoxIsCommandBookmarked(bookmarks, b.name);
		if (aBookmarked && !bBookmarked) {
			return -1;
		}
		if (!aBookmarked && bBookmarked) {
			return 1;
		}
		return 0;
	});
}

export function knoxToggleBookmark(bookmarks: readonly string[], commandName: string): string[] {
	if (!commandName) {
		return bookmarks.slice();
	}
	if (knoxIsCommandBookmarked(bookmarks, commandName)) {
		return bookmarks.filter(name => name !== commandName);
	}
	return [...bookmarks, commandName];
}
