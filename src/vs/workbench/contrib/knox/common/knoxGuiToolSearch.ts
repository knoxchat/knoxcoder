/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-021: `builtin_tool_search` loads deferred tools into the live tool list.
 * The result text (core `runToolSearch`) is "Loaded: a, b. Call them...",
 * "Already available: c." or "No tool matched. Available to load: ...".
 * This turns it into chips for the tool card.
 */

export interface IKnoxGuiToolSearchResult {
	/** What the model asked for: exact names, else the keyword query. */
	readonly requested: string;
	readonly loaded: readonly string[];
	readonly already: readonly string[];
	readonly noMatch: boolean;
}

function splitNames(list: string): string[] {
	return list.split(',').map(n => n.trim().replace(/\.$/, '')).filter(Boolean);
}

export function knoxGuiParseToolSearch(args: Record<string, unknown> | undefined, output: string | undefined): IKnoxGuiToolSearchResult {
	const names = Array.isArray(args?.names) ? (args.names as unknown[]).filter((n): n is string => typeof n === 'string') : [];
	const query = typeof args?.query === 'string' ? args.query.trim() : '';
	const text = output ?? '';
	const loaded = /^Loaded: ([^\n]*?)\. Call them/m.exec(text)?.[1];
	const already = /^Already available: ([^\n]*?)\.$/m.exec(text)?.[1];
	return {
		requested: names.length ? names.join(', ') : query,
		loaded: loaded ? splitNames(loaded) : [],
		already: already ? splitNames(already) : [],
		noMatch: /^No tool matched\./m.test(text),
	};
}
