/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxMentionTriggerInsert,
	knoxToolbarCanCancel,
	knoxToolbarEnterDisabled,
	knoxToolbarPrimaryState,
} from '../../common/knoxToolbar.js';
import type { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';

suite('knox toolbar (T5.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function historyWithTool(status: 'generated' | 'calling' | 'done'): IKnoxChatHistoryItem[] {
		return [{
			message: { role: 'assistant', content: '', id: 'a' },
			contextItems: [],
			toolCallState: {
				toolCallId: 't1',
				status,
				parsedArgs: {},
				toolCall: { id: 't1', type: 'function', function: { name: 'builtin_read_file', arguments: '{}' } },
			},
		}];
	}

	test('inserts @ with a leading space unless the cursor is already at @ or whitespace', () => {
		assert.strictEqual(knoxMentionTriggerInsert(''), '@');
		assert.strictEqual(knoxMentionTriggerInsert('hello '), '@');
		assert.strictEqual(knoxMentionTriggerInsert('hello'), ' @');
		assert.strictEqual(knoxMentionTriggerInsert('hello@'), '');
	});

	test('Stop is available while streaming, calling, unsettled, or jobs are running', () => {
		const base = { mode: 'chat' as const, isStreaming: false, history: [] as IKnoxChatHistoryItem[], codeToEdit: [], runningJobs: 0 };
		assert.strictEqual(knoxToolbarCanCancel({ ...base, isStreaming: true }), true);
		assert.strictEqual(knoxToolbarCanCancel({ ...base, history: historyWithTool('calling') }), true);
		assert.strictEqual(knoxToolbarCanCancel({ ...base, history: historyWithTool('generated') }), true);
		assert.strictEqual(knoxToolbarCanCancel({ ...base, runningJobs: 1 }), true);
		assert.strictEqual(knoxToolbarCanCancel(base), false);
	});

	test('Send is disabled while a generated tool waits for approval, unless Stop is showing', () => {
		const input = {
			mode: 'chat' as const,
			isStreaming: false,
			history: historyWithTool('generated'),
			codeToEdit: [],
			runningJobs: 0,
		};
		assert.strictEqual(knoxToolbarEnterDisabled(input), true);
		assert.deepStrictEqual(knoxToolbarPrimaryState(input), { kind: 'cancel', canCancel: true, enabled: true });
	});

	test('Edit mode shows Retry after accepting and disables Send with no code to edit', () => {
		assert.deepStrictEqual(
			knoxToolbarPrimaryState({
				mode: 'edit',
				isStreaming: false,
				history: [],
				codeToEdit: [],
				editStatus: 'accepting',
				runningJobs: 0,
			}),
			{ kind: 'retry', canCancel: false, enabled: false },
		);
		assert.deepStrictEqual(
			knoxToolbarPrimaryState({
				mode: 'edit',
				isStreaming: false,
				history: [],
				codeToEdit: [{ filepath: 'a.ts', contents: 'x' }],
				editStatus: 'not-started',
				runningJobs: 0,
			}),
			{ kind: 'edit', canCancel: false, enabled: true },
		);
	});
});
