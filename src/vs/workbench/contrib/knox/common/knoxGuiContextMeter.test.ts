/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiContextLevel, knoxGuiContextRatio, knoxGuiContextUsageFromLog, knoxGuiFormatTokens, knoxGuiResolveContextLimit } from './knoxGuiContextMeter.js';
import { knoxGuiParsePersistedUi, knoxGuiSerializePersistedUi } from './knoxGuiPersist.js';
import { createInitialKnoxGuiState } from './knoxGuiState.js';

suite('Knox GUI context meter and permission notice', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reported usage wins over the estimate', () => {
		const reported = knoxGuiContextUsageFromLog({ prompt: 'x'.repeat(400), usage: { promptTokens: 500 } }, 1000, 's');
		assert.deepStrictEqual(reported, { sessionId: 's', used: 500, limit: 1000, source: 'reported' });
		const estimated = knoxGuiContextUsageFromLog({ prompt: 'x'.repeat(400) }, 1000, 's');
		assert.strictEqual(estimated?.used, 100);
		assert.strictEqual(estimated?.source, 'estimated');
		assert.strictEqual(knoxGuiContextUsageFromLog({}, 1000, 's'), undefined);
	});

	test('limit resolves from the catalog, else 128k', () => {
		assert.strictEqual(knoxGuiResolveContextLimit('a/b', [[{ model: 'a/b', contextLength: 200000 }]]), 200000);
		assert.strictEqual(knoxGuiResolveContextLimit('missing', [[]]), 128000);
		assert.strictEqual(knoxGuiResolveContextLimit(undefined, []), 128000);
	});

	test('levels and formatting', () => {
		assert.strictEqual(knoxGuiContextLevel(0.5), 'ok');
		assert.strictEqual(knoxGuiContextLevel(0.75), 'warn');
		assert.strictEqual(knoxGuiContextLevel(0.95), 'high');
		assert.strictEqual(knoxGuiContextRatio({ used: 2000, limit: 1000 }), 1);
		assert.strictEqual(knoxGuiFormatTokens(12300), '12.3k');
		assert.strictEqual(knoxGuiFormatTokens(1000000), '1M');
		assert.strictEqual(knoxGuiFormatTokens(42), '42');
	});

	test('permission notice dismissal persists; saved mode is untouched', () => {
		const state = { ...createInitialKnoxGuiState(), permissionNoticeDismissed: true, permissionMode: 'fullAuto' as const };
		const parsed = knoxGuiParsePersistedUi(knoxGuiSerializePersistedUi(state));
		assert.strictEqual(parsed.permissionNoticeDismissed, true);
		assert.strictEqual(parsed.permissionMode, 'fullAuto');
		assert.strictEqual(knoxGuiParsePersistedUi('{"permissionMode":"default"}').permissionNoticeDismissed, undefined);
		assert.strictEqual(createInitialKnoxGuiState().permissionNoticeDismissed, false);
	});
});
