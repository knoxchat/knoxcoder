/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiNextLanguage } from './gui/widget/languageToggle.js';
import { knoxGuiResolveLanguage } from '../common/knoxGuiPersist.js';
import { ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';

suite('Knox titlebar chrome', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('chat language toggle cycles English and Chinese', () => {
		assert.strictEqual(knoxGuiNextLanguage('en'), 'zh');
		assert.strictEqual(knoxGuiNextLanguage('zh'), 'en');
		assert.strictEqual(knoxGuiResolveLanguage('zh', 'en'), 'zh');
		assert.strictEqual(knoxGuiResolveLanguage(undefined, 'zh-CN'), 'zh');
		assert.strictEqual(knoxGuiResolveLanguage(undefined, 'en-US'), 'en');
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
