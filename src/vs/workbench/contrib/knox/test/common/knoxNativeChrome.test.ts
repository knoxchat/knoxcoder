/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_NATIVE_FIND_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_WITHOUT_CLEAR_COMMAND_ID,
	KNOX_NATIVE_FOCUS_INPUT_WITH_NEW_SESSION_COMMAND_ID,
	KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_EDIT_WITHOUT_CLEAR_COMMAND_ID,
	KNOX_NATIVE_EXIT_EDIT_MODE_COMMAND_ID,
	KNOX_NATIVE_NEW_SESSION_COMMAND_ID,
	KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID,
	KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID,
	KNOX_NATIVE_ADD_MODEL_COMMAND_ID,
	KNOX_NATIVE_BATCH_DIFF_COMMAND_ID,
	KNOX_NATIVE_VIEW_STATS_COMMAND_ID,
	KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID,
	KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID,
	KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID,
	KNOX_NATIVE_CYCLE_MODEL_COMMAND_ID,
	KNOX_NATIVE_CYCLE_MODEL_PREV_COMMAND_ID,
	KNOX_NATIVE_APPLY_CODE_COMMAND_ID,
	KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID,
	KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID,
	nativeCommandForOverlay,
	overlayFromNativeCommand,
} from '../../common/knoxChat.js';
import { knoxHistoryItemPreview } from '../../common/knoxChatTypes.js';
import type { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';

suite('Knox native overlay commands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps title-bar commands onto native overlays', () => {
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_NEW_SESSION_COMMAND_ID), 'chat');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID), 'history');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID), 'memory');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID), 'config');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID), 'configError');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_ADD_MODEL_COMMAND_ID), 'addModel');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_BATCH_DIFF_COMMAND_ID), 'batchDiff');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_STATS_COMMAND_ID), 'stats');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID), 'restore');
		assert.strictEqual(overlayFromNativeCommand('knoxchat.newSession'), undefined);
	});

	test('round-trips overlay ids back to native commands', () => {
		assert.strictEqual(nativeCommandForOverlay('history'), KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID);
		assert.strictEqual(nativeCommandForOverlay('memory'), KNOX_NATIVE_VIEW_MEMORY_COMMAND_ID);
		assert.strictEqual(nativeCommandForOverlay('config'), KNOX_NATIVE_OPEN_CONFIG_COMMAND_ID);
		assert.strictEqual(nativeCommandForOverlay('configError'), KNOX_NATIVE_VIEW_CONFIG_ERROR_COMMAND_ID);
		assert.strictEqual(nativeCommandForOverlay('addModel'), KNOX_NATIVE_ADD_MODEL_COMMAND_ID);
		assert.strictEqual(nativeCommandForOverlay('restore'), KNOX_NATIVE_VIEW_RESTORE_COMMAND_ID);
	});

	test('focus commands stay distinct from overlay commands', () => {
		assert.ok(KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_FOCUS_INPUT_WITHOUT_CLEAR_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_FOCUS_INPUT_WITH_NEW_SESSION_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_FOCUS_EDIT_WITHOUT_CLEAR_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_EXIT_EDIT_MODE_COMMAND_ID.startsWith('knox.native.'));
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID), undefined);
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_FOCUS_EDIT_COMMAND_ID), undefined);
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_FIND_COMMAND_ID), undefined);
		assert.ok(KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_CYCLE_MODEL_COMMAND_ID.startsWith('knox.native.'));
		assert.ok(KNOX_NATIVE_CYCLE_MODEL_PREV_COMMAND_ID.startsWith('knox.native.'));
	});

	test('keyboard-only send, mention, approve, and history load stay command-driven (T12.4)', () => {
		assert.strictEqual(KNOX_NATIVE_FOCUS_INPUT_COMMAND_ID, 'knox.native.focusInput');
		assert.strictEqual(KNOX_NATIVE_FIND_COMMAND_ID, 'knox.native.findInThread');
		assert.strictEqual(KNOX_NATIVE_CYCLE_PERMISSION_COMMAND_ID, 'knox.native.cyclePermissionMode');
		assert.strictEqual(overlayFromNativeCommand(KNOX_NATIVE_VIEW_HISTORY_COMMAND_ID), 'history');
		assert.ok(KNOX_NATIVE_APPLY_CODE_COMMAND_ID.startsWith('knox.native.'));
		assert.strictEqual(KNOX_NATIVE_SEND_USER_INPUT_COMMAND_ID, 'knox.native.sendUserInput');
		assert.strictEqual(KNOX_NATIVE_FOCUS_SESSION_COMMAND_ID, 'knox.native.focusSession');
	});
});

suite('knoxHistoryItemPreview', () => {
	function item(partial: Partial<IKnoxChatHistoryItem> & { message: IKnoxChatHistoryItem['message'] }): IKnoxChatHistoryItem {
		return {
			contextItems: [],
			...partial,
		};
	}

	test('uses message text for user and assistant', () => {
		assert.deepStrictEqual(
			knoxHistoryItemPreview(item({ message: { role: 'user', content: 'Hello' } })),
			{ role: 'user', text: 'Hello' },
		);
		assert.deepStrictEqual(
			knoxHistoryItemPreview(item({ message: { role: 'assistant', content: 'Hi' } })),
			{ role: 'assistant', text: 'Hi' },
		);
	});

	test('prefers tool call status over message body', () => {
		const preview = knoxHistoryItemPreview(item({
			message: { role: 'assistant', content: '' },
			toolCallState: {
				toolCallId: '1',
				status: 'calling',
				parsedArgs: {},
				toolCall: {
					id: '1',
					type: 'function',
					function: { name: 'builtin_read_file', arguments: '{}' },
				},
			},
		}));
		assert.deepStrictEqual(preview, { role: 'tool', text: 'builtin_read_file (calling)' });
	});

	test('falls back to reasoning text', () => {
		const preview = knoxHistoryItemPreview(item({
			message: { role: 'assistant', content: '' },
			reasoning: { active: true, text: 'Considering files', startAt: 0 },
		}));
		assert.deepStrictEqual(preview, { role: 'thinking', text: 'Considering files' });
	});
});
