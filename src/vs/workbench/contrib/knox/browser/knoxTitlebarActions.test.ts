/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiNextLanguage, knoxGuiResolveLanguage } from '../common/knoxGuiPersist.js';
import { ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';
import { OPEN_KNOX_CHECKPOINT_GRAPH_TITLEBAR_ID, OPEN_KNOX_HISTORY_TITLEBAR_ID, OPEN_KNOX_MEMORY_TITLEBAR_ID, OPEN_KNOX_SETTINGS_TITLEBAR_ID } from './knoxTitlebarActions.js';

suite('Knox titlebar chrome', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('chat language toggle cycles English and Chinese', () => {
		assert.strictEqual(knoxGuiNextLanguage('en'), 'zh');
		assert.strictEqual(knoxGuiNextLanguage('zh'), 'en');
		assert.strictEqual(knoxGuiResolveLanguage('zh', 'en'), 'zh');
		assert.strictEqual(knoxGuiResolveLanguage(undefined, 'zh-CN'), 'zh');
		assert.strictEqual(knoxGuiResolveLanguage(undefined, 'en-US'), 'en');
	});

	test('History, Memory, Checkpoint Graph, and Settings share the title-bar leading group', () => {
		assert.strictEqual(OPEN_KNOX_HISTORY_TITLEBAR_ID, 'workbench.action.knox.titlebar.openHistory');
		assert.strictEqual(OPEN_KNOX_MEMORY_TITLEBAR_ID, 'workbench.action.knox.titlebar.openMemory');
		assert.strictEqual(OPEN_KNOX_CHECKPOINT_GRAPH_TITLEBAR_ID, 'workbench.action.knox.titlebar.openCheckpointGraph');
		assert.strictEqual(OPEN_KNOX_SETTINGS_TITLEBAR_ID, 'workbench.action.knox.titlebar.openSettings');
		const titlebar = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/knoxTitlebarActions.ts'), 'utf8');
		const memoryOrder = titlebar.indexOf("id: OPEN_KNOX_MEMORY_TITLEBAR_ID");
		const checkpointOrder = titlebar.indexOf("id: OPEN_KNOX_CHECKPOINT_GRAPH_TITLEBAR_ID");
		const historyOrder = titlebar.indexOf("id: OPEN_KNOX_HISTORY_TITLEBAR_ID");
		const settingsOrder = titlebar.indexOf("id: OPEN_KNOX_SETTINGS_TITLEBAR_ID");
		const orderAfter = (from: number) => {
			const slice = titlebar.slice(from, from + 800);
			const match = /group: TitleBarLeadingActionsGroup,\s*order: (\d+)/.exec(slice);
			assert.ok(match, `expected title-bar order near offset ${from}`);
			return Number(match[1]);
		};
		assert.strictEqual(orderAfter(memoryOrder), 0);
		assert.strictEqual(orderAfter(checkpointOrder), 1);
		assert.strictEqual(orderAfter(historyOrder), 2);
		assert.strictEqual(orderAfter(settingsOrder), 3);
	});

	test('History uses the same contributed icon font as Memory, Checkpoint, and Settings', () => {
		const titlebar = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/knoxTitlebarActions.ts'), 'utf8');
		const editors = readFileSync(join(process.cwd(), 'src/vs/workbench/contrib/knox/browser/knoxGuiEditors.ts'), 'utf8');
		const manifest = JSON.parse(readFileSync(join(process.cwd(), 'extensions/knox/package.json'), 'utf8')) as {
			contributes?: { icons?: Record<string, { default?: { fontPath?: string; fontCharacter?: string } }> };
		};
		const icons = manifest.contributes?.icons ?? {};
		assert.strictEqual(icons['knox-history']?.default?.fontPath, './media/history.woff');
		assert.strictEqual(icons['knox-memory']?.default?.fontPath, './media/memory.woff');
		assert.strictEqual(icons['knox-checkpoint-graph']?.default?.fontPath, './media/checkpoint-graph.woff');
		assert.strictEqual(icons['knox-settings']?.default?.fontPath, './media/settings.woff');
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/media/history.woff')));
		assert.ok(existsSync(join(process.cwd(), 'extensions/knox/media/settings.woff')));
		assert.ok(readFileSync(join(process.cwd(), 'extensions/knox/media/history.svg'), 'utf8').includes('scale(1.05)'));
		assert.ok(readFileSync(join(process.cwd(), 'extensions/knox/media/settings.svg'), 'utf8').includes('scale(1.05)'));
		assert.ok(titlebar.includes("ThemeIcon.fromId('knox-history')"));
		assert.ok(titlebar.includes("ThemeIcon.fromId('knox-memory')"));
		assert.ok(titlebar.includes("ThemeIcon.fromId('knox-checkpoint-graph')"));
		assert.ok(titlebar.includes("ThemeIcon.fromId('knox-settings')"));
		assert.ok(editors.includes("ThemeIcon.fromId('knox-history')"));
		assert.ok(editors.includes("ThemeIcon.fromId('knox-settings')"));
	});

	test('color theme toggle uses the built-in Dark and Light themes only', () => {
		assert.deepStrictEqual({
			dark: ThemeSettingDefaults.COLOR_THEME_DARK,
			light: ThemeSettingDefaults.COLOR_THEME_LIGHT,
		}, {
			dark: 'Dark',
			light: 'Light',
		});
	});
});
