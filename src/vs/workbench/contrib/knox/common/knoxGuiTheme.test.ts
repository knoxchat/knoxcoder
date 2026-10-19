/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { contrastRatio } from './knoxGuiTools.js';
import { applyKnoxGuiSetTheme, applyKnoxGuiThemeToElement, knoxGuiThemeContrast, knoxGuiThemeIsLight } from './knoxGuiTheme.js';
import { createInitialKnoxGuiState } from './knoxGuiState.js';

function loadThemeColors(rel: string): Record<string, string> {
	const raw = JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as { colors?: Record<string, string> };
	assert.ok(raw.colors, rel);
	return raw.colors!;
}

function assertAaText(name: string, fg: string, bg: string): void {
	const ratio = contrastRatio(fg, bg);
	assert.ok(ratio >= 4.5, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, need 4.5:1`);
}

const HC_DARK = {
	base: 'hc-black',
	colors: {
		foreground: '#ffffff',
		'editor.foreground': '#ffffff',
		'editor.background': '#000000',
		'sideBar.background': '#000000',
		'sideBar.foreground': '#ffffff',
		'button.background': '#000000',
		'button.foreground': '#ffffff',
		contrastBorder: '#6fc3df',
	},
};

const HC_LIGHT = {
	base: 'hc-light',
	colors: {
		foreground: '#000000',
		'editor.foreground': '#000000',
		'editor.background': '#ffffff',
		'sideBar.background': '#ffffff',
		'sideBar.foreground': '#000000',
		'button.background': '#ffffff',
		'button.foreground': '#000000',
		contrastBorder: '#0f4a85',
	},
};

suite('K-102 Knox GUI built-in theme contrast', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('One Dark, Light+, and both high-contrast palettes keep AA text contrast', () => {
		const oneDark = loadThemeColors('extensions/theme-onedark-pro/themes/dark.json');
		const light = loadThemeColors('extensions/theme-defaults/themes/light.json');
		const themes = [
			{ name: 'One Dark Pro', colors: oneDark, base: 'vs-dark' },
			{ name: 'Light+', colors: light, base: 'vs' },
			{ name: 'High Contrast', colors: HC_DARK.colors, base: HC_DARK.base },
			{ name: 'High Contrast Light', colors: HC_LIGHT.colors, base: HC_LIGHT.base },
		];
		for (const theme of themes) {
			assert.strictEqual(knoxGuiThemeIsLight({ base: theme.base, colors: theme.colors }), theme.base === 'vs' || theme.base === 'hc-light');
			assert.strictEqual(knoxGuiThemeContrast({ base: theme.base }), theme.base.startsWith('hc') ? 'high' : undefined);
			assertAaText(`${theme.name} editor`, theme.colors['editor.foreground'], theme.colors['editor.background']);
			assertAaText(`${theme.name} sidebar`, theme.colors['sideBar.foreground'] ?? theme.colors.foreground, theme.colors['sideBar.background']);
			assertAaText(`${theme.name} button`, theme.colors['button.foreground'], theme.colors['button.background']);
		}
		// Brand teal `#159994` is 3.5:1 on white (P1-9). Light themes remap fill/accent to `#0f7a76`.
		assertAaText('Knox fill on light', '#ffffff', '#0f7a76');
		assertAaText('Knox accent on light', '#0f7a76', '#ffffff');
	});

	test('setTheme stamps theme-kind and high-contrast on the root', () => {
		const root = document.createElement('div');
		const style = document.createElement('style');
		const dark = applyKnoxGuiSetTheme(createInitialKnoxGuiState(), { theme: { base: 'vs-dark', colors: HC_DARK.colors } });
		assert.ok(dark);
		applyKnoxGuiThemeToElement(root, style, { vscTheme: dark.vscTheme, vscColors: dark.vscColors ?? {}, vscTokenColors: dark.vscTokenColors ?? {} });
		assert.strictEqual(root.getAttribute('data-knox-theme-kind'), 'dark');
		assert.strictEqual(root.getAttribute('data-knox-theme-contrast'), null);

		const hc = applyKnoxGuiSetTheme(createInitialKnoxGuiState(), { theme: HC_DARK });
		assert.ok(hc);
		applyKnoxGuiThemeToElement(root, style, { vscTheme: hc.vscTheme, vscColors: hc.vscColors ?? {}, vscTokenColors: hc.vscTokenColors ?? {} });
		assert.strictEqual(root.getAttribute('data-knox-theme-kind'), 'dark');
		assert.strictEqual(root.getAttribute('data-knox-theme-contrast'), 'high');

		const light = applyKnoxGuiSetTheme(createInitialKnoxGuiState(), { theme: HC_LIGHT });
		assert.ok(light);
		applyKnoxGuiThemeToElement(root, style, { vscTheme: light.vscTheme, vscColors: light.vscColors ?? {}, vscTokenColors: light.vscTokenColors ?? {} });
		assert.strictEqual(root.getAttribute('data-knox-theme-kind'), 'light');
		assert.strictEqual(root.getAttribute('data-knox-theme-contrast'), 'high');
	});
});
