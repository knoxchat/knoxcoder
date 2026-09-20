/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem, IKnoxSession } from '../../common/knoxChatTypes.js';
import {
	GUI_DISPLAY_MAX_CHARS,
	GUI_SESSION_HYDRATE_BUDGET_BYTES,
	capContextItems,
	capDisplayText,
	dropSettledToolCallOutputs,
	estimateSessionPayloadBytes,
	knoxHydrateNoticeForSession,
	normalizeHistoryForGui,
	shouldWarnLargeSession,
	slimSessionForGui,
} from '../../common/knoxDisplayCap.js';
import { knoxHasNlsKey, knoxNls } from '../../common/knoxI18n.js';

function toolItem(id: string, body: string): IKnoxChatHistoryItem {
	return {
		message: { role: 'tool', content: body, toolCallId: id },
		contextItems: [
			{ name: 'Terminal', description: 'out', content: body },
		],
		promptLogs: [
			{
				modelTitle: 'm',
				prompt: 'P'.repeat(50_000),
				completion: 'C'.repeat(50_000),
			},
		],
		toolCallState: {
			toolCallId: id,
			toolCall: {
				id,
				type: 'function',
				function: { name: 'builtin_run_terminal_command', arguments: '{}' },
			},
			status: 'done',
			parsedArgs: {},
			output: [{ name: 'Terminal', description: 'out', content: body }],
		},
	};
}

suite('knox display cap (T8.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps short strings unchanged', () => {
		assert.deepStrictEqual(capDisplayText('hello'), {
			text: 'hello',
			truncated: false,
			originalLength: 5,
		});
	});

	test('tails oversized strings', () => {
		const text = `${'a'.repeat(10)}\n${'b'.repeat(GUI_DISPLAY_MAX_CHARS + 50)}`;
		const { truncated, originalLength, text: tail } = capDisplayText(text);
		assert.strictEqual(truncated, true);
		assert.strictEqual(originalLength, text.length);
		assert.ok(tail.length < text.length);
		assert.ok(tail.endsWith('b'.repeat(20)));
	});

	test('caps context item bodies and leaves identity when already small', () => {
		const small = [{ content: 'ok', description: 'd' }];
		assert.strictEqual(capContextItems(small), small);
		const fat = [
			{ content: 'x'.repeat(GUI_DISPLAY_MAX_CHARS + 100), description: 'out' },
		];
		const capped = capContextItems(fat);
		assert.ok(capped[0].content.length < fat[0].content.length);
		assert.ok(capped[0].description?.includes('truncated'));
	});

	test('drops toolCallState.output once a tool message exists', () => {
		const history: IKnoxChatHistoryItem[] = [
			{
				message: { role: 'assistant', content: '', id: 'a' },
				contextItems: [],
				toolCallState: {
					toolCallId: 'c1',
					toolCall: { id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } },
					status: 'done',
					parsedArgs: {},
					output: [{ name: 'Terminal', description: '', content: 'dup'.repeat(100) }],
				},
			},
			{
				message: { role: 'tool', content: 'full-output', toolCallId: 'c1' },
				contextItems: [
					{ name: 'Terminal', description: '', content: 'dup'.repeat(100) },
				],
			},
		];
		const next = dropSettledToolCallOutputs(history);
		assert.strictEqual(next[0].toolCallState?.output, undefined);
		assert.strictEqual(next[1].message.content, 'full-output');
	});

	test('does not truncate tool message.content used by the model', () => {
		const full = 'z'.repeat(GUI_DISPLAY_MAX_CHARS + 500);
		const history: IKnoxChatHistoryItem[] = [
			{
				message: { role: 'tool', content: full, toolCallId: 'c1' },
				contextItems: [
					{ name: 'Terminal', description: 'out', content: full },
				],
			},
		];
		const next = normalizeHistoryForGui(history);
		assert.strictEqual(next[0].message.content, full);
		assert.ok(next[0].contextItems[0].content.length < full.length);
	});

	test('drops promptLogs and duplicate settled outputs without touching tool message.content', () => {
		const full = 'z'.repeat(GUI_DISPLAY_MAX_CHARS + 500);
		const session: IKnoxSession = {
			sessionId: 's1',
			title: 't',
			workspaceDirectory: '/w',
			history: [toolItem('c1', full)],
		};
		const { session: slimmed, slimmed: changed } = slimSessionForGui(session);
		assert.strictEqual(changed, true);
		assert.strictEqual(slimmed.history[0].promptLogs, undefined);
		assert.strictEqual(slimmed.history[0].toolCallState?.output, undefined);
		assert.strictEqual(slimmed.history[0].message.content, full);
		assert.ok(slimmed.history[0].contextItems[0].content.length < full.length);
		assert.strictEqual(slimmed.guiHydrateSlimmed, true);
		assert.strictEqual(shouldWarnLargeSession(slimmed), true);
		assert.strictEqual(knoxHydrateNoticeForSession(session), 'large');
	});

	test('does not warn after dropping only small promptLogs', () => {
		const session: IKnoxSession = {
			sessionId: 's3',
			title: 't',
			workspaceDirectory: '/w',
			history: [
				{
					message: { role: 'assistant', content: 'hi' },
					contextItems: [],
					promptLogs: [
						{ modelTitle: 'm', prompt: 'short', completion: 'also short' },
					],
				},
			],
		};
		const result = slimSessionForGui(session);
		assert.strictEqual(result.slimmed, true);
		assert.strictEqual(result.session.guiHydrateSlimmed, undefined);
		assert.strictEqual(shouldWarnLargeSession(result.session), false);
		assert.strictEqual(knoxHydrateNoticeForSession(session), null);
	});

	test('keeps a small session unchanged and under budget', () => {
		const session: IKnoxSession = {
			sessionId: 's2',
			title: 't',
			workspaceDirectory: '/w',
			history: [
				{ message: { role: 'user', content: 'hi' }, contextItems: [] },
			],
		};
		const result = slimSessionForGui(session);
		assert.strictEqual(result.slimmed, false);
		assert.strictEqual(result.overBudget, false);
		assert.strictEqual(result.session, session);
		assert.ok(result.originalBytes < GUI_SESSION_HYDRATE_BUDGET_BYTES);
		assert.strictEqual(estimateSessionPayloadBytes(session), result.originalBytes);
		assert.strictEqual(knoxHydrateNoticeForSession(session), null);
	});

	test('warns when the host already marked guiHydrateSlimmed', () => {
		const session: IKnoxSession = {
			sessionId: 's4',
			title: 't',
			history: [{ message: { role: 'user', content: 'hi' }, contextItems: [] }],
			guiHydrateSlimmed: true,
		};
		assert.strictEqual(shouldWarnLargeSession(session), true);
		assert.strictEqual(knoxHydrateNoticeForSession(session), 'large');
	});

	test('largeSessionBanner i18n exists in en and zh', () => {
		assert.ok(knoxHasNlsKey('largeSessionBanner'));
		assert.strictEqual(
			knoxNls('largeSessionBanner', undefined, undefined, 'en'),
			'This chat is very large; older messages load as you scroll up.',
		);
		assert.ok(knoxNls('largeSessionBanner', undefined, undefined, 'zh').includes('对话'));
	});
});
