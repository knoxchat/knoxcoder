/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KNOX_NLS_EN, KNOX_NLS_ZH } from './knox.contribution.nls.js';

export type KnoxUiLanguage = 'en' | 'zh';
export type KnoxNlsVars = Record<string, string | number>;

export const KNOX_UI_LANGUAGES: readonly KnoxUiLanguage[] = ['en', 'zh'];
export const KNOX_DEFAULT_UI_LANGUAGE: KnoxUiLanguage = 'en';
export const KNOX_LANGUAGE_STORAGE_KEY = 'knox.language';

export const KNOX_LANGUAGE_NAMES: Record<KnoxUiLanguage, string> = {
	en: 'English',
	zh: '中文',
};

/**
 * Native-only copy that never lived in knox/gui locale JSON (batch-diff overlay).
 */
const KNOX_NLS_NATIVE: Record<KnoxUiLanguage, Record<string, string>> = {
	en: {
		batchDiff: 'Batch Diff',
		noPendingDiffs: 'No pending diffs',
		deselectAll: 'Deselect All',
		acceptSelected: 'Accept selected',
		rejectSelected: 'Reject selected',
		selectedCountOf: 'selected',
		assistantProfile: 'Assistant profile',
		profile: 'Profile',
		selectProviderToConfigure: 'Select a provider to configure.',
		clickHereToCreateApiKey: 'Click here to create an API key',
	},
	zh: {
		batchDiff: '批量差异',
		noPendingDiffs: '没有待处理的差异',
		deselectAll: '取消全选',
		acceptSelected: '接受所选',
		rejectSelected: '拒绝所选',
		selectedCountOf: '已选',
		assistantProfile: '助理配置文件',
		profile: '配置文件',
		selectProviderToConfigure: '请选择要配置的提供商。',
		clickHereToCreateApiKey: '点击此处创建 API 密钥',
	},
};

let currentLanguage: KnoxUiLanguage = KNOX_DEFAULT_UI_LANGUAGE;

export function knoxParseUiLanguage(value: unknown): KnoxUiLanguage {
	return value === 'zh' ? 'zh' : 'en';
}

export function knoxSetUiLanguage(language: KnoxUiLanguage): void {
	currentLanguage = language;
}

export function knoxUiLanguage(): KnoxUiLanguage {
	return currentLanguage;
}

export function knoxInterpolate(template: string, vars?: KnoxNlsVars): string {
	if (!vars) {
		return template;
	}
	return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
		const value = vars[name];
		return value === undefined ? match : String(value);
	});
}

export function knoxHasNlsKey(key: string): boolean {
	return Object.prototype.hasOwnProperty.call(KNOX_NLS_EN, key)
		|| Object.prototype.hasOwnProperty.call(KNOX_NLS_NATIVE.en, key);
}

function lookupRaw(language: KnoxUiLanguage, key: string): string | undefined {
	if (language === 'zh') {
		return KNOX_NLS_NATIVE.zh[key] ?? KNOX_NLS_ZH[key] ?? KNOX_NLS_NATIVE.en[key] ?? KNOX_NLS_EN[key];
	}
	return KNOX_NLS_NATIVE.en[key] ?? KNOX_NLS_EN[key];
}

/**
 * Knox in-pane copy. Follows the Knox language toggle, not the workbench locale.
 */
export function knoxNls(key: string, vars?: KnoxNlsVars, fallback?: string, language = currentLanguage): string {
	const raw = lookupRaw(language, key) ?? fallback ?? key;
	return knoxInterpolate(raw, vars);
}

/** Ad-hoc pair for strings that are not (yet) in the GUI locale JSON. */
export function knoxT(language: KnoxUiLanguage, en: string, zh: string): string {
	return language === 'zh' ? zh : en;
}
