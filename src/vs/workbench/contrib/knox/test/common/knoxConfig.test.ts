/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { knoxApplySharedConfig, knoxClampFontSize, knoxReadUiBoolean, knoxSharedConfigForAgentProfile } from '../../common/knoxSharedConfig.js';
import { knoxConfigErrorsFromProfileInfo, knoxHasFatalConfigError, knoxSortConfigErrors } from '../../common/knoxConfigUi.js';
import { knoxNavigateTarget, knoxToggleNativeOverlay } from '../../common/knoxNavigate.js';
import { knoxCycleProfileId, knoxSelectProfileId } from '../../common/knoxProfiles.js';
import { knoxParseUiLanguage } from '../../common/knoxI18n.js';

suite('knox config (T9.1–T9.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('applies shared UI toggles and agent profile defaults', () => {
		const next = knoxApplySharedConfig(undefined, {
			showSessionTabs: true,
			codeWrap: true,
			disableSessionTitles: true,
			fontSize: 18,
			...knoxSharedConfigForAgentProfile('rust'),
		});
		assert.strictEqual(knoxReadUiBoolean(next, 'showSessionTabs'), true);
		assert.strictEqual(knoxReadUiBoolean(next, 'codeWrap'), true);
		assert.strictEqual(knoxReadUiBoolean(next, 'disableSessionTitles'), true);
		assert.strictEqual(next.ui?.fontSize, 18);
		assert.strictEqual(next.experimental?.agentProfile, 'rust');
		assert.strictEqual(next.experimental?.agentDoomLoopThreshold, 4);
		assert.strictEqual(next.experimental?.agentVerifyCommand, 'cargo check --workspace --all-targets');
		assert.deepStrictEqual(knoxSharedConfigForAgentProfile('auto'), { agentProfile: 'auto' });
		assert.strictEqual(knoxClampFontSize(99), 50);
		assert.strictEqual(knoxClampFontSize(3), 7);
	});

	test('sorts fatal config errors first', () => {
		const sorted = knoxSortConfigErrors([
			{ message: 'warn' },
			{ message: 'boom', fatal: true },
		]);
		assert.strictEqual(sorted[0].fatal, true);
		assert.strictEqual(knoxHasFatalConfigError(sorted), true);
		assert.deepStrictEqual(
			knoxConfigErrorsFromProfileInfo({ result: { errors: [{ message: 'bad', fatal: true }] } }).map(e => e.message),
			['bad'],
		);
	});
});

suite('knox navigate / profiles (T9.3 T9.7)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps GUI routes onto native overlays, including the /models bugfix', () => {
		assert.deepStrictEqual(knoxNavigateTarget('/models'), { overlay: 'addModel' });
		assert.deepStrictEqual(knoxNavigateTarget('/addModel'), { overlay: 'addModel' });
		assert.deepStrictEqual(knoxNavigateTarget('/addModel/provider/openai'), { overlay: 'configureProvider', provider: 'openai' });
		assert.deepStrictEqual(knoxNavigateTarget('/config-error'), { overlay: 'configError' });
		assert.deepStrictEqual(knoxNavigateTarget('/batch-diff'), { overlay: 'batchDiff' });
		assert.deepStrictEqual(knoxNavigateTarget('/stats'), { overlay: 'stats' });
		assert.strictEqual(knoxToggleNativeOverlay('config', 'config', true), 'chat');
		assert.strictEqual(knoxToggleNativeOverlay('chat', 'config', true), 'config');
	});

	test('selects and cycles assistant profiles', () => {
		const profiles = [{ id: 'local' }, { id: 'hub' }];
		assert.strictEqual(knoxSelectProfileId(profiles, 'missing'), 'local');
		assert.strictEqual(knoxSelectProfileId(profiles, 'hub'), 'hub');
		assert.strictEqual(knoxSelectProfileId([], 'local'), 'local');
		assert.strictEqual(knoxCycleProfileId(profiles, 'local'), 'hub');
		assert.strictEqual(knoxCycleProfileId(profiles, 'hub'), 'local');
		assert.strictEqual(knoxParseUiLanguage('zh'), 'zh');
		assert.strictEqual(knoxParseUiLanguage('nope'), 'en');
	});
});
