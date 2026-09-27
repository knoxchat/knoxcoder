/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxGuiStringsEn } from './i18n/en.js';
import { knoxGuiStringsZh } from './i18n/zh.js';
import type { KnoxGuiLanguage } from '../../common/knoxGuiState.js';

const TABLES: Record<KnoxGuiLanguage, Record<string, unknown>> = {
	en: knoxGuiStringsEn,
	zh: knoxGuiStringsZh,
};

function flattenLocale(obj: Record<string, unknown>, prefix = ''): string[] {
	const keys: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			keys.push(...flattenLocale(v as Record<string, unknown>, key));
		} else {
			keys.push(key);
		}
	}
	return keys;
}

/** Dotted keys in a native GUI table. Used by knoxGuiParity (KN-381). */
export function knoxGuiLocaleKeys(language: KnoxGuiLanguage): string[] {
	return flattenLocale(TABLES[language]).sort();
}

function lookup(table: Record<string, unknown>, key: string): unknown {
	if (Object.prototype.hasOwnProperty.call(table, key)) {
		return table[key];
	}
	const parts = key.split('.');
	let current: unknown = table;
	for (const part of parts) {
		if (!current || typeof current !== 'object') {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function knoxGuiT(language: KnoxGuiLanguage, key: string, vars?: Record<string, string | number>): string {
	const raw = lookup(TABLES[language], key) ?? lookup(TABLES.en, key) ?? key;
	if (typeof raw !== 'string') {
		return key;
	}
	if (!vars) {
		return raw;
	}
	return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
		const value = vars[name];
		return value === undefined ? `{{${name}}}` : String(value);
	});
}
