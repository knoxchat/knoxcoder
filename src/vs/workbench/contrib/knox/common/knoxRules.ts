/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** YAML `rules:` entry: a string, a `uses:` block, or an unsupported object. */
export type KnoxYamlRule = string | { uses?: string };

export type KnoxRuleKind = 'local' | 'inline' | 'uses';

export interface IKnoxRuleCard {
	index: number;
	titleKind: KnoxRuleKind;
	/** Block slug when `titleKind` is `uses`. */
	uses?: string;
	text: string;
	/** GUI: only locally defined rules open the profile editor. */
	editable: boolean;
}

/**
 * Pull the `rules:` list from assistant YAML without depending on
 * knoxdev-package. Enough for Lump titles (inline vs `uses:` vs local).
 */
export function knoxParseYamlRules(rawYaml: string | undefined): KnoxYamlRule[] {
	if (!rawYaml) {
		return [];
	}
	const lines = rawYaml.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^rules:\s*(?:#.*)?$/.test(lines[i])) {
			start = i + 1;
			break;
		}
	}
	if (start < 0) {
		return [];
	}

	const rules: KnoxYamlRule[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || /^\s*#/.test(line)) {
			i++;
			continue;
		}
		if (/^[^\s#-]/.test(line)) {
			break;
		}
		const item = line.match(/^\s*-\s*(.*)$/);
		if (!item) {
			i++;
			continue;
		}
		const rest = item[1].trim();
		const usesInline = rest.match(/^uses:\s*(.+)$/);
		if (usesInline) {
			rules.push({ uses: unquote(usesInline[1]) });
			i++;
			continue;
		}
		if (rest === '' || rest === '|' || rest === '>') {
			const nested = knoxParseNestedYamlRule(lines, i + 1);
			rules.push(nested.rule);
			i = nested.nextIndex;
			continue;
		}
		if (/^[A-Za-z][\w-]*:/.test(rest) && !/^uses:/.test(rest)) {
			const nested = knoxParseNestedYamlRule(lines, i + 1, rest);
			rules.push(nested.rule);
			i = nested.nextIndex;
			continue;
		}
		rules.push(unquote(rest));
		i++;
	}
	return rules;
}

function knoxParseNestedYamlRule(
	lines: readonly string[],
	from: number,
	firstField?: string,
): { rule: KnoxYamlRule; nextIndex: number } {
	let uses: string | undefined;
	if (firstField) {
		const match = firstField.match(/^uses:\s*(.+)$/);
		if (match) {
			uses = unquote(match[1]);
		}
	}
	let i = from;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || /^\s*#/.test(line)) {
			i++;
			continue;
		}
		if (/^\s*-\s/.test(line) || /^[^\s#-]/.test(line)) {
			break;
		}
		const field = line.match(/^\s+uses:\s*(.+)$/);
		if (field) {
			uses = unquote(field[1]);
		}
		i++;
	}
	return { rule: uses ? { uses } : {}, nextIndex: i };
}

function unquote(value: string): string {
	const trimmed = value.trim().replace(/\s+#.*$/, '');
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function knoxMergeRuleCards(
	unrolled: readonly string[] | undefined,
	yamlRules: readonly (KnoxYamlRule | undefined)[] | undefined,
): IKnoxRuleCard[] {
	const rules = unrolled ?? [];
	const yaml = yamlRules ?? [];
	const cards: IKnoxRuleCard[] = [];
	for (let index = 0; index < rules.length; index++) {
		const text = rules[index] ?? '';
		const fromYaml = yaml[index];
		if (fromYaml === undefined) {
			cards.push({ index, titleKind: 'local', text, editable: true });
			continue;
		}
		if (typeof fromYaml === 'string') {
			cards.push({ index, titleKind: 'inline', text, editable: false });
			continue;
		}
		if (!fromYaml.uses) {
			continue;
		}
		cards.push({ index, titleKind: 'uses', uses: fromYaml.uses, text, editable: false });
	}
	return cards;
}

export function knoxProfileIsLocal(profileType: string | undefined): boolean {
	return profileType === undefined || profileType === 'local';
}
