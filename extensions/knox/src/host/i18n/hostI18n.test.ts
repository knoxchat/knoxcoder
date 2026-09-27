import * as assert from 'node:assert';

import { getCurrentLanguage, switchLanguage, t } from './index';
import enExtension from './locales/en/extension.json';
import zhExtension from './locales/zh/extension.json';
import enUi from './locales/en/ui.json';
import zhUi from './locales/zh/ui.json';

suite('Host i18n (KN-381)', () => {
	test('en and zh host catalogs include activation and screenshot keys', () => {
		const required = [
			'ext.desktopOnly',
			'ext.remoteNativeMissing',
			'ext.activationError',
		];
		for (const key of required) {
			assert.strictEqual(typeof (enExtension as Record<string, string>)[key], 'string', `en missing ${key}`);
			assert.strictEqual(typeof (zhExtension as Record<string, string>)[key], 'string', `zh missing ${key}`);
			assert.notStrictEqual(
				(enExtension as Record<string, string>)[key],
				(zhExtension as Record<string, string>)[key],
				`${key} should differ between en and zh`,
			);
		}
		assert.strictEqual(typeof (enUi as Record<string, string>)['screenshot.captured'], 'string');
		assert.strictEqual(typeof (zhUi as Record<string, string>)['screenshot.captured'], 'string');
	});

	test('switchLanguage changes host t() between en and zh', () => {
		const previous = getCurrentLanguage();
		switchLanguage('en');
		const en = t('ext.desktopOnly');
		switchLanguage('zh');
		const zh = t('ext.desktopOnly');
		switchLanguage(previous);
		assert.ok(en.includes('desktop'));
		assert.ok(zh.length > 0);
		assert.notStrictEqual(en, zh);
	});
});
