/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { luminanceIsLight } from './knoxGuiTools.js';
import type { IKnoxGuiState, IKnoxGuiThemeRule, IKnoxGuiVscTheme } from './knoxGuiState.js';

export type { IKnoxGuiThemeRule, IKnoxGuiVscTheme };

/** Port of VscTheme hljs class → TextMate scopes. */
export const HLJS_TO_TEXTMATE: Record<string, readonly string[]> = {
	'.hljs-comment': ['comment'],
	'.hljs-tag': ['tag'],
	'.hljs-doctag': ['keyword'],
	'.hljs-keyword': ['keyword'],
	'.hljs-meta .hljs-keyword': ['keyword'],
	'.hljs-template-tag': ['keyword'],
	'.hljs-template-variable': ['keyword'],
	'.hljs-type': ['keyword'],
	'.hljs-variable.language_': ['keyword'],
	'.hljs-title': ['title', 'function', 'class'],
	'.hljs-title.class_': ['title', 'function', 'class', 'variable'],
	'.hljs-title.class_.inherited__': ['title', 'function', 'class', 'variable'],
	'.hljs-title.function_': ['support.function', 'entity.name.function', 'title', 'function', 'class'],
	'.hljs-built_in': ['support.function', 'entity.name.function', 'title', 'function', 'class'],
	'.hljs-name': ['constant'],
	'.hljs-attr': ['variable', 'operator', 'number'],
	'.hljs-attribute': ['attribute', 'variable', 'operator', 'number'],
	'.hljs-literal': ['variable', 'operator', 'number'],
	'.hljs-meta': ['variable', 'operator', 'number'],
	'.hljs-number': ['constant.numeric', 'number', 'variable', 'operator'],
	'.hljs-operator': ['variable', 'operator', 'number'],
	'.hljs-variable': ['variable', 'operator', 'number'],
	'.hljs-selector-attr': ['variable', 'operator', 'number'],
	'.hljs-selector-class': ['variable', 'operator', 'number'],
	'.hljs-selector-id': ['variable', 'operator', 'number'],
	'.hljs-regexp': ['string'],
	'.hljs-string': ['string'],
	'.hljs-meta .hljs-string': ['string'],
	'.hljs-params': ['variable', 'operator', 'number'],
};

const LIGHT_HLJS_FALLBACK: Record<string, string> = {
	'.hljs-comment': '#008000',
	'.hljs-doctag': '#0000ff',
	'.hljs-keyword': '#0000ff',
	'.hljs-meta .hljs-keyword': '#0000ff',
	'.hljs-template-tag': '#0000ff',
	'.hljs-template-variable': '#0000ff',
	'.hljs-type': '#0000ff',
	'.hljs-variable.language_': '#0000ff',
	'.hljs-title.class_': '#001080',
	'.hljs-title.class_.inherited__': '#001080',
	'.hljs-title.function_': '#795E26',
	'.hljs-built_in': '#795E26',
	'.hljs-attr': '#001080',
	'.hljs-attribute': '#001080',
	'.hljs-literal': '#001080',
	'.hljs-meta': '#001080',
	'.hljs-number': '#098658',
	'.hljs-operator': '#001080',
	'.hljs-variable': '#001080',
	'.hljs-selector-attr': '#001080',
	'.hljs-selector-class': '#001080',
	'.hljs-selector-id': '#001080',
	'.hljs-regexp': '#a31515',
	'.hljs-string': '#a31515',
	'.hljs-meta .hljs-string': '#a31515',
	'.hljs-params': '#001080',
};

const DARK_HLJS_FALLBACK: Record<string, string> = {
	'.hljs-comment': '#6A9955',
	'.hljs-doctag': '#569cd6',
	'.hljs-keyword': '#569cd6',
	'.hljs-meta .hljs-keyword': '#569cd6',
	'.hljs-template-tag': '#569cd6',
	'.hljs-template-variable': '#569cd6',
	'.hljs-type': '#569cd6',
	'.hljs-variable.language_': '#569cd6',
	'.hljs-title.class_': '#9CDCFE',
	'.hljs-title.class_.inherited__': '#9CDCFE',
	'.hljs-title.function_': '#DCDCAA',
	'.hljs-built_in': '#DCDCAA',
	'.hljs-attr': '#9CDCFE',
	'.hljs-attribute': '#9CDCFE',
	'.hljs-literal': '#9CDCFE',
	'.hljs-meta': '#9CDCFE',
	'.hljs-number': '#b5cea8',
	'.hljs-operator': '#9CDCFE',
	'.hljs-variable': '#9CDCFE',
	'.hljs-selector-attr': '#9CDCFE',
	'.hljs-selector-class': '#9CDCFE',
	'.hljs-selector-id': '#9CDCFE',
	'.hljs-regexp': '#ce9178',
	'.hljs-string': '#ce9178',
	'.hljs-meta .hljs-string': '#ce9178',
	'.hljs-params': '#9CDCFE',
};

const ENVELOPE_KEYS = new Set(['done', 'status', 'content', 'error', 'messageId', 'messageType']);

export function normalizeCssColor(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return trimmed;
	}
	if (trimmed.startsWith('#') || trimmed.startsWith('rgb') || trimmed.startsWith('hsl') || trimmed.startsWith('var(')) {
		return trimmed;
	}
	if (/^[0-9a-fA-F]{3,8}$/.test(trimmed)) {
		return `#${trimmed}`;
	}
	return trimmed;
}

/** `editor.background` → `--vscode-editor-background`; already-prefixed keys kept. */
export function vscodeCssVarFromColorId(key: string): string | undefined {
	const trimmed = key.trim();
	if (!trimmed || trimmed.startsWith('.')) {
		return undefined;
	}
	if (trimmed.startsWith('--')) {
		return trimmed;
	}
	if (!/^[A-Za-z][\w.-]*$/.test(trimmed)) {
		return undefined;
	}
	return `--vscode-${trimmed.replace(/\./g, '-')}`;
}

export function hljsCssVarName(hljsClass: string): string {
	return `--knox-hljs-${hljsClass.replace(/^\./, '').replace(/[.\s]+/g, '-')}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringColorMap(value: unknown, skipEnvelope = false): Record<string, string> | undefined {
	const rec = asRecord(value);
	if (!rec) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(rec)) {
		if (skipEnvelope && ENVELOPE_KEYS.has(key)) {
			continue;
		}
		if (typeof raw === 'string' && raw.trim()) {
			out[key] = normalizeCssColor(raw);
		}
	}
	return Object.keys(out).length ? out : undefined;
}

function parseThemeObject(value: unknown): IKnoxGuiVscTheme | undefined {
	const rec = asRecord(value);
	if (!rec) {
		return undefined;
	}
	const nested = rec.theme !== undefined ? parseThemeObject(rec.theme) : undefined;
	if (nested) {
		return nested;
	}
	const rulesRaw = rec.rules;
	const colors = stringColorMap(rec.colors);
	const rules: IKnoxGuiThemeRule[] | undefined = Array.isArray(rulesRaw)
		? rulesRaw.map(item => {
			const row = asRecord(item);
			if (!row) {
				return {};
			}
			return {
				token: typeof row.token === 'string' ? row.token : undefined,
				foreground: typeof row.foreground === 'string' ? row.foreground : undefined,
				background: typeof row.background === 'string' ? row.background : undefined,
				fontStyle: typeof row.fontStyle === 'string' ? row.fontStyle : undefined,
			};
		})
		: undefined;
	const base = typeof rec.base === 'string' ? rec.base : undefined;
	if (!base && !colors && !rules?.length) {
		return undefined;
	}
	return {
		base,
		inherit: rec.inherit === true,
		rules,
		colors,
	};
}

/** Host `setTheme` payload: `{ theme }` or a converted theme object. */
export function parseSetThemePayload(data: unknown): IKnoxGuiVscTheme | undefined {
	return parseThemeObject(data);
}

/** Host `setColors` payload: CSS-var map, color-id map, or `{ colors }`. */
export function parseSetColorsPayload(data: unknown): Record<string, string> | undefined {
	const rec = asRecord(data);
	if (!rec) {
		return undefined;
	}
	if (rec.colors && typeof rec.colors === 'object') {
		const nested = stringColorMap(rec.colors);
		if (nested) {
			return nested;
		}
	}
	return stringColorMap(rec, true);
}

export function cssVarsFromColorMap(colors: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(colors)) {
		if (key.startsWith('.')) {
			continue;
		}
		const cssVar = vscodeCssVarFromColorId(key);
		if (cssVar) {
			out[cssVar] = normalizeCssColor(value);
		}
	}
	return out;
}

export function knoxGuiThemeIsLight(theme?: IKnoxGuiVscTheme, colors?: Record<string, string>): boolean | undefined {
	const base = (theme?.base ?? '').toLowerCase();
	if (base === 'vs' || base === 'hc-light') {
		return true;
	}
	if (base === 'vs-dark' || base === 'hc-black') {
		return false;
	}
	const background = theme?.colors?.['editor.background']
		?? colors?.['--vscode-editor-background']
		?? colors?.['editor.background'];
	if (background) {
		return luminanceIsLight(normalizeCssColor(background));
	}
	return undefined;
}

/** Port of `constructTheme` + light/dark hljs fallback. */
export function constructHljsTheme(theme: IKnoxGuiVscTheme | undefined, isLight: boolean): Record<string, string> {
	const tokenToForeground: Record<string, string> = {};
	for (const rule of theme?.rules ?? []) {
		if (!rule.token || !rule.foreground) {
			continue;
		}
		tokenToForeground[rule.token] = normalizeCssColor(rule.foreground);
	}
	const mapped: Record<string, string> = {};
	for (const [className, scopes] of Object.entries(HLJS_TO_TEXTMATE)) {
		for (const scope of scopes) {
			if (tokenToForeground[scope]) {
				mapped[className] = tokenToForeground[scope];
				break;
			}
		}
	}
	if (!Object.keys(mapped).length) {
		return { ...(isLight ? LIGHT_HLJS_FALLBACK : DARK_HLJS_FALLBACK) };
	}
	return mapped;
}

export function knoxGuiHljsTokenColor(tokens: Record<string, string> | undefined, selectors: readonly string[], fallback: string): string {
	for (const selector of selectors) {
		const value = tokens?.[selector];
		if (value) {
			return value;
		}
	}
	return fallback;
}

export function applyKnoxGuiSetTheme(state: IKnoxGuiState, data: unknown): Partial<IKnoxGuiState> | undefined {
	const theme = parseSetThemePayload(data);
	if (!theme) {
		return undefined;
	}
	const isLight = knoxGuiThemeIsLight(theme, state.vscColors) ?? false;
	const fromTheme = theme.colors ? cssVarsFromColorMap(theme.colors) : {};
	return {
		vscTheme: theme,
		vscTokenColors: constructHljsTheme(theme, isLight),
		vscColors: { ...state.vscColors, ...fromTheme },
	};
}

export function applyKnoxGuiSetColors(state: IKnoxGuiState, data: unknown): Partial<IKnoxGuiState> | undefined {
	const colors = parseSetColorsPayload(data);
	if (!colors) {
		return undefined;
	}
	const cssVars = cssVarsFromColorMap(colors);
	if (!Object.keys(cssVars).length) {
		return undefined;
	}
	return {
		vscColors: { ...state.vscColors, ...cssVars },
	};
}

export function knoxGuiStateThemeIsLight(state: IKnoxGuiState): boolean | undefined {
	return knoxGuiThemeIsLight(state.vscTheme, state.vscColors);
}

export function knoxGuiHljsStyleSheet(tokenColors: Record<string, string>): string {
	const rules: string[] = [];
	for (const [className, color] of Object.entries(tokenColors)) {
		const selector = className.split(/\s+/).map(part => part.startsWith('.') ? part : `.${part}`).join(' ');
		rules.push(`.knox-gui ${selector} { color: ${color}; }`);
	}
	return rules.join('\n');
}

export function applyKnoxGuiThemeToElement(
	root: HTMLElement,
	styleEl: HTMLStyleElement | undefined,
	state: Pick<IKnoxGuiState, 'vscTheme' | 'vscColors' | 'vscTokenColors'>,
	previousVars: ReadonlySet<string> = new Set(),
): Set<string> {
	const vars: Record<string, string> = { ...state.vscColors };
	for (const [className, color] of Object.entries(state.vscTokenColors)) {
		vars[hljsCssVarName(className)] = color;
	}
	for (const key of previousVars) {
		if (!(key in vars)) {
			root.style.removeProperty(key);
		}
	}
	for (const [key, value] of Object.entries(vars)) {
		root.style.setProperty(key, value);
	}
	const base = state.vscTheme?.base;
	if (base) {
		root.setAttribute('data-knox-theme-base', base);
	} else {
		root.removeAttribute('data-knox-theme-base');
	}
	const isLight = knoxGuiThemeIsLight(state.vscTheme, state.vscColors);
	if (isLight === undefined) {
		root.removeAttribute('data-knox-theme-kind');
	} else {
		root.setAttribute('data-knox-theme-kind', isLight ? 'light' : 'dark');
	}
	if (styleEl) {
		styleEl.textContent = knoxGuiHljsStyleSheet(state.vscTokenColors);
	}
	return new Set(Object.keys(vars));
}
