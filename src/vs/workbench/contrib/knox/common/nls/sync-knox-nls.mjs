#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flatten knox/gui locale JSON into knox.contribution.nls.ts (T11.1).
 * Merge order matches knox/gui/src/i18n.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const guiLocales = path.join(repoRoot, 'knox/gui/src/locales');
const outFile = path.resolve(here, '../knox.contribution.nls.ts');
const namespaces = ['common', 'settings', 'chat', 'history', 'errors', 'models', 'stats', 'tools'];

function flatten(value, prefix = '', out = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return out;
	}
	for (const [key, child] of Object.entries(value)) {
		const next = prefix ? `${prefix}.${key}` : key;
		if (child && typeof child === 'object' && !Array.isArray(child)) {
			flatten(child, next, out);
		} else if (typeof child === 'string') {
			out[next] = child;
		}
	}
	return out;
}

function loadLanguage(lang) {
	const merged = {};
	for (const ns of namespaces) {
		const file = path.join(guiLocales, lang, `${ns}.json`);
		Object.assign(merged, flatten(JSON.parse(fs.readFileSync(file, 'utf8'))));
	}
	return merged;
}

const en = loadLanguage('en');
const zh = loadLanguage('zh');
const banner = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generated from knox/gui/src/locales/{en,zh}/*.json (T11.1).
 * Re-run: node src/vs/workbench/contrib/knox/common/nls/sync-knox-nls.mjs
 * Do not edit by hand.
 */

export const KNOX_NLS_EN: Record<string, string> = ${JSON.stringify(en, null, '\t')};

export const KNOX_NLS_ZH: Record<string, string> = ${JSON.stringify(zh, null, '\t')};
`;

fs.writeFileSync(outFile, banner);
console.log(`Wrote ${Object.keys(en).length} en keys / ${Object.keys(zh).length} zh keys to ${path.relative(repoRoot, outFile)}`);
