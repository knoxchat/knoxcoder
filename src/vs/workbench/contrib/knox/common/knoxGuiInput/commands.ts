/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiContextProvider, IKnoxGuiSlashCommand, KnoxChatMode } from '../knoxGuiState.js';
import { slashCommandBareName } from './doc.js';

/** Slash builtins, default `@` providers, and mode filters. */

export const EDIT_DISALLOWED_CONTEXT_PROVIDERS = ['tree', 'open', 'web', 'diff', 'folder', 'search', 'debugger', 'repo-map'];
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

/** KN-300: same default `@` providers as Core `DEFAULT_CONTEXT_PROVIDER_TITLES`. */
export const DEFAULT_MENTION_PROVIDER_TITLES = ['file', 'diff', 'problems', 'repo-map', 'terminal', 'memory', 'recipe'] as const;

export const DEFAULT_MENTION_PROVIDERS: IKnoxGuiContextProvider[] = [
	{ title: 'file', displayTitle: 'File | Folder', description: 'Files', type: 'submenu' },
	{ title: 'diff', displayTitle: 'Git Diff', description: 'Git diff', type: 'normal' },
	{ title: 'problems', displayTitle: 'Problems', description: 'Problems', type: 'normal' },
	{ title: 'repo-map', displayTitle: 'Repository Structure Map', description: 'Repo map', type: 'submenu' },
	{ title: 'terminal', displayTitle: 'Terminal', description: 'Terminal', type: 'normal' },
	{ title: 'memory', displayTitle: 'Project Memory', description: 'Project memories', type: 'query' },
	{ title: 'recipe', displayTitle: 'Recipe', description: 'Verified recipes', type: 'submenu' },
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

export function composerPlaceholderKey(mode: KnoxChatMode, historyLength: number): string {
	if (mode === 'edit') {
		return 'describeHowToModifyCode';
	}
	return historyLength === 0 ? 'askAnything' : 'followUpQuestion';
}

export function filterProvidersForMode(providers: IKnoxGuiContextProvider[], mode: KnoxChatMode): IKnoxGuiContextProvider[] {
	if (mode !== 'edit') {
		return providers;
	}
	return providers.filter(provider => !EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes(provider.title));
}
