/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxHasNlsKey,
	knoxInterpolate,
	knoxNls,
	knoxParseUiLanguage,
	knoxSetUiLanguage,
	knoxT,
} from '../../common/knoxI18n.js';

suite('knox i18n (T11.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => knoxSetUiLanguage('en'));

	test('loads GUI locale JSON keys for en and zh', () => {
		assert.ok(knoxHasNlsKey('mentionEmpty'));
		assert.ok(knoxHasNlsKey('interfaceSettings'));
		assert.ok(knoxHasNlsKey('configErrors'));
		assert.ok(knoxHasNlsKey('addNewModel'));
		assert.strictEqual(knoxNls('mentionEmpty', undefined, undefined, 'en'), 'No files match');
		assert.strictEqual(knoxNls('mentionEmpty', undefined, undefined, 'zh'), '没有匹配的文件');
		assert.strictEqual(knoxNls('mentionSectionOpen', undefined, undefined, 'zh'), '打开');
		assert.strictEqual(knoxNls('settings', undefined, undefined, 'zh'), '设置');
	});

	test('interpolates {{count}} the same way i18next did', () => {
		assert.strictEqual(knoxInterpolate('Restore selected ({{count}})', { count: 3 }), 'Restore selected (3)');
		assert.ok(knoxNls('restoreSelectedCount', { count: 2 }, undefined, 'en').includes('2'));
		knoxSetUiLanguage('zh');
		assert.strictEqual(knoxNls('backToChat'), '返回对话');
	});

	test('parses the Knox language toggle and keeps knoxT fallbacks', () => {
		assert.strictEqual(knoxParseUiLanguage('zh'), 'zh');
		assert.strictEqual(knoxParseUiLanguage('nope'), 'en');
		assert.strictEqual(knoxT('zh', 'History', '历史'), '历史');
		assert.strictEqual(knoxNls('batchDiff', undefined, undefined, 'zh'), '批量差异');
	});

	test('T14.4 en and zh smoke for send, approve, history, memory, config', () => {
		const expected: Array<[string, string, string]> = [
			['sendMessage', 'Send message (⏎)', '发送消息 (⏎)'],
			['approveOnce', 'Approve', '批准'],
			['alwaysThisSession', 'Always', '始终'],
			['deny', 'Deny', '拒绝'],
			['history', 'History', '对话记录'],
			['settings', 'Settings', '设置'],
			['memoryOverview', 'Overview', '总览'],
			['memoryBrowser', 'Memories', '记忆库'],
			['configError', 'Config Error', '配置错误'],
			['backToChat', 'Back to Chat', '返回对话'],
			['newChat', 'New Chat', '新建对话'],
		];
		for (const [key, en, zh] of expected) {
			assert.ok(knoxHasNlsKey(key), key);
			assert.strictEqual(knoxNls(key, undefined, undefined, 'en'), en, key);
			assert.strictEqual(knoxNls(key, undefined, undefined, 'zh'), zh, key);
		}
	});
});
