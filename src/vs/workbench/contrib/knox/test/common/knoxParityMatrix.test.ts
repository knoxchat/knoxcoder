/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_NATIVE_ADD_MODEL_COMMAND_ID,
	KNOX_NATIVE_APPLY_CODE_COMMAND_ID,
	KNOX_NATIVE_BATCH_DIFF_COMMAND_ID,
	KNOX_NATIVE_FIND_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID,
	KNOX_NATIVE_NEW_SESSION_COMMAND_ID,
	KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID,
	KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID,
	KNOX_NATIVE_STICK_TO_BOTTOM_COMMAND_ID,
	KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID,
	KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID,
	KNOX_NATIVE_VIEW_STATS_COMMAND_ID,
	KNOX_PERMISSION_MODES,
	overlayFromNativeCommand,
} from '../../common/knoxChat.js';
import { KNOX_CHECKPOINT_TABS } from '../../common/knoxCheckpoints.js';
import { KNOX_UI_LANGUAGES } from '../../common/knoxI18n.js';
import { KNOX_LUMP_SECTIONS } from '../../common/knoxLump.js';
import { KNOX_MEMORY_TABS } from '../../common/knoxMemory.js';
import { knoxNavigateTarget } from '../../common/knoxNavigate.js';
import { knoxToolCardKind } from '../../common/knoxToolCard.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';

/**
 * Wiring inventory only (T12.3) — **not** a parity tick. These assertions
 * check that command/overlay/tab ids are spelled as registered; they say
 * nothing about live behavior. Per `knox-native-impl.md` T0.3, behavior
 * parity lives in `knoxProtocolPayloads.test.ts`, `knoxChatThunks.test.ts`,
 * `knoxGuiBridge.test.ts`, and the running-window Appendix B pass (T6.3).
 * Untick [Appendix B](../knox-native-impl.md#appendix-b--parity-matrix) from
 * string equality here.
 */
suite('knox native id wiring inventory (not a parity tick)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('chat chrome commands exist', () => {
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_NEW_SESSION_COMMAND_ID), 'chat');
		assert.strictEqual(KNOX_NATIVE_FIND_COMMAND_ID, 'knox.native.findInThread');
		assert.strictEqual(KNOX_NATIVE_STICK_TO_BOTTOM_COMMAND_ID, 'knox.native.stickToBottom');
		assert.strictEqual(KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID, 'knox.native.focusInput');
		assert.strictEqual(KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID, 'knox.native.sendUserInput');
	});

	test('other-view overlays map from GUI routes', () => {
		assert.strictEqual(knoxNavigateTarget('/history')?.overlay, 'history');
		assert.strictEqual(knoxNavigateTarget('/restore')?.overlay, 'restore');
		assert.strictEqual(knoxNavigateTarget('/memory')?.overlay, 'memory');
		assert.strictEqual(knoxNavigateTarget('/config')?.overlay, 'config');
		assert.strictEqual(knoxNavigateTarget('/config-error')?.overlay, 'configError');
		assert.strictEqual(knoxNavigateTarget('/addModel')?.overlay, 'addModel');
		assert.strictEqual(knoxNavigateTarget('/models')?.overlay, 'addModel');
		assert.strictEqual(knoxNavigateTarget('/addModel/provider/openai')?.overlay, 'configureProvider');
		assert.strictEqual(knoxNavigateTarget('/batch-diff')?.overlay, 'batchDiff');
		assert.strictEqual(knoxNavigateTarget('/stats')?.overlay, 'stats');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID), 'history');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID), 'memory');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID), 'config');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID), 'configError');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_ADD_MODEL_COMMAND_ID), 'addModel');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_BATCH_DIFF_COMMAND_ID), 'batchDiff');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_STATS_COMMAND_ID), 'stats');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID), 'restore');
	});

	test('lump, memory, checkpoint, and permission surfaces are complete', () => {
		assert.deepStrictEqual([...KNOX_LUMP_SECTIONS], ['models', 'rules', 'prompts', 'tools', 'history', 'checkpoints']);
		assert.deepStrictEqual([...KNOX_MEMORY_TABS], ['overview', 'browser', 'sessions', 'graph', 'settings']);
		assert.deepStrictEqual([...KNOX_CHECKPOINT_TABS], ['checkpoints', 'timeline', 'analysis', 'dashboard', 'share', 'configuration']);
		assert.deepStrictEqual([...KNOX_PERMISSION_MODES], ['default', 'acceptEdits', 'fullAuto']);
		assert.deepStrictEqual([...KNOX_UI_LANGUAGES], ['en', 'zh']);
	});

	test('tool-card kinds cover Appendix B variants', () => {
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.CreateNewFile), 'createFile');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.RunTerminalCommand), 'terminal');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.Build), 'terminal');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ViewSubdirectory), 'viewSubdirectory');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ViewRepoMap), 'viewRepoMap');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.AskUser), 'askUser');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.Task), 'task');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ExactSearch), 'exactSearch');
		assert.strictEqual(knoxToolCardKind(KnoxBuiltInToolName.ReadFile), 'generic');
		assert.strictEqual(KNOX_NATIVE_APPLY_CODE_COMMAND_ID, 'knox.native.applyCodeFromChat');
		assert.strictEqual(KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID, 'knox.native.focusSession');
	});

	test('T14.4 native commands cover chat send, tool approve, history, memory, config', () => {
		assert.strictEqual(KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID, 'knox.native.sendUserInput');
		assert.strictEqual(KNOX_NATIVE_NEW_SESSION_COMMAND_ID, 'knox.native.newSession');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID), 'history');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID), 'memory');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID), 'config');
		assert.deepStrictEqual([...KNOX_UI_LANGUAGES], ['en', 'zh']);
	});
});
