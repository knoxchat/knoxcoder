/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { knoxGuiStringsEn } from './en.js';
import { knoxGuiStringsZh } from './zh.js';

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
	if (typeof value === 'string') {
		out.set(prefix, value);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			flatten(v, prefix ? `${prefix}.${k}` : k, out);
		}
	}
}

function placeholders(s: string): string[] {
	return [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort();
}

suite('Knox GUI i18n parity (K-045)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const en = new Map<string, string>();
	const zh = new Map<string, string>();
	flatten(knoxGuiStringsEn, '', en);
	flatten(knoxGuiStringsZh, '', zh);

	test('every English key exists in Chinese and vice versa', () => {
		const missingZh = [...en.keys()].filter(k => !zh.has(k));
		const missingEn = [...zh.keys()].filter(k => !en.has(k));
		assert.deepStrictEqual({ missingZh, missingEn }, { missingZh: [], missingEn: [] });
	});

	test('translations keep the same {{placeholders}}', () => {
		const mismatched: string[] = [];
		for (const [key, enValue] of en) {
			const zhValue = zh.get(key);
			if (zhValue !== undefined && placeholders(enValue).join(',') !== placeholders(zhValue).join(',')) {
				mismatched.push(key);
			}
		}
		assert.deepStrictEqual(mismatched, []);
	});

	test('no empty translations', () => {
		const empty = [...zh].filter(([, v]) => v.trim() === '').map(([k]) => k);
		assert.deepStrictEqual(empty, []);
	});
});
