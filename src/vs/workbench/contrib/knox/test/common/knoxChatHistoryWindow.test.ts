/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';
import {
	AUTO_DISPLAY_START,
	CHAT_DISPLAY_WINDOW,
	CHAT_LOAD_MORE_COUNT,
	computeDisplayStart,
	groupHistoryTurns,
	knoxLastUserIndex,
	knoxVisibleHistoryIndexes,
	nextExpandedStart,
	resolveDisplayStart,
	shouldFloatLastUser,
	snapStartToTurn,
	visibleTurnIndexes,
} from '../../common/knoxChatHistoryWindow.js';
import {
	buildKnoxThreadRows,
	withKnoxLoadEarlierRow,
} from '../../common/knoxThreadModel.js';
import {
	compileKnoxSearchPattern,
	findKnoxHistoryIndexes,
	findKnoxThreadMatches,
	knoxHistoryItemSearchText,
} from '../../common/knoxFind.js';
import { knoxHasNlsKey, knoxNls } from '../../common/knoxI18n.js';

function roles(...rs: string[]): Array<{ message: { role: string } }> {
	return rs.map(role => ({ message: { role } }));
}

function item(role: IKnoxChatHistoryItem['message']['role'], content: string, id = content): IKnoxChatHistoryItem {
	return { message: { role, content, id }, contextItems: [] };
}

function makeHistory(count: number): IKnoxChatHistoryItem[] {
	return Array.from({ length: count }, (_, i) => item(
		i % 2 === 0 ? 'user' : 'assistant',
		i === 0 ? 'rare-token-xyz' : `msg-${i}`,
		`id-${i}`,
	));
}

suite('knox chat history window (T8.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups user-started turns and orphan prefixes', () => {
		const turns = groupHistoryTurns(
			roles('assistant', 'tool', 'user', 'assistant', 'tool', 'user', 'assistant'),
		);
		assert.deepStrictEqual(turns, [
			{ userIndex: -1, startIndex: 0, endIndex: 2 },
			{ userIndex: 2, startIndex: 2, endIndex: 5 },
			{ userIndex: 5, startIndex: 5, endIndex: 7 },
		]);
	});

	test('starts at 0 when history fits in the window', () => {
		assert.strictEqual(computeDisplayStart({
			historyLength: 10,
			expandedStart: AUTO_DISPLAY_START,
		}), 0);
	});

	test('windows the last 25 messages even when the live turn is longer', () => {
		assert.strictEqual(CHAT_DISPLAY_WINDOW, 25);
		assert.strictEqual(CHAT_LOAD_MORE_COUNT, 25);
		assert.strictEqual(computeDisplayStart({
			historyLength: 200,
			expandedStart: AUTO_DISPLAY_START,
		}), 175);
	});

	test('keeps a user-expanded earlier start', () => {
		assert.strictEqual(computeDisplayStart({
			historyLength: 200,
			expandedStart: 40,
		}), 40);
	});

	test('snaps a user-expanded mid-turn start back to that turn\'s user message', () => {
		const turns = groupHistoryTurns(
			roles('user', 'assistant', 'user', 'assistant', 'tool', 'user', 'assistant'),
		);
		assert.strictEqual(snapStartToTurn(4, turns), 2);
		assert.strictEqual(resolveDisplayStart({
			historyLength: 7,
			expandedStart: AUTO_DISPLAY_START,
			turns,
			windowSize: 3,
		}), 4);
		assert.strictEqual(resolveDisplayStart({
			historyLength: 7,
			expandedStart: 4,
			turns,
			windowSize: 3,
		}), 2);
	});

	test('steps backward when loading earlier messages', () => {
		assert.strictEqual(nextExpandedStart(50, 25), 25);
		assert.strictEqual(nextExpandedStart(10, 25), 0);
	});

	test('keeps the live user prompt when the rest of the turn is windowed', () => {
		const live = { userIndex: 0, startIndex: 0, endIndex: 200 };
		assert.deepStrictEqual(visibleTurnIndexes(live, 175, 0), [
			0,
			...Array.from({ length: 25 }, (_, i) => 175 + i),
		]);
		assert.strictEqual(visibleTurnIndexes(live, 0, 0)[0], 0);
		assert.deepStrictEqual(
			visibleTurnIndexes({ userIndex: 10, startIndex: 10, endIndex: 20 }, 175, 0),
			[],
		);
	});

	test('floats the last sent prompt only while following a live stream', () => {
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: true, lastUserIndex: 2 }), true);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: false, lastUserIndex: 2 }), false);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: false, followLive: true, lastUserIndex: 2 }), false);
		assert.strictEqual(shouldFloatLastUser({ isStreaming: true, followLive: true, lastUserIndex: -1 }), false);
	});

	test('buildKnoxThreadRows mounts only the latest window of a long history', () => {
		const history = makeHistory(500);
		const displayStart = resolveDisplayStart({
			historyLength: history.length,
			expandedStart: AUTO_DISPLAY_START,
			turns: groupHistoryTurns(history),
		});
		assert.strictEqual(displayStart, 475);
		const rows = buildKnoxThreadRows(history, {
			mode: 'chat',
			isStreaming: false,
			displayStart,
			lastUserIndex: knoxLastUserIndex(history),
		});
		assert.strictEqual(rows.length, CHAT_DISPLAY_WINDOW);
		assert.ok(rows.every(row => row.historyIndex >= displayStart));
		const withButton = withKnoxLoadEarlierRow(rows, displayStart);
		assert.strictEqual(withButton[0].kind, 'loadEarlier');
		assert.strictEqual(withButton[0].userIndex, displayStart);
	});

	test('does not mount a giant live turn all at once, but keeps the last user prompt', () => {
		const history = makeHistory(200);
		const displayStart = resolveDisplayStart({
			historyLength: history.length,
			expandedStart: AUTO_DISPLAY_START,
			turns: groupHistoryTurns(history),
		});
		const lastUserIndex = 0;
		const rows = buildKnoxThreadRows(history, {
			mode: 'chat',
			isStreaming: false,
			displayStart,
			lastUserIndex,
		});
		assert.strictEqual(rows.length, CHAT_DISPLAY_WINDOW + 1);
		assert.strictEqual(rows[0].historyIndex, 0);
		assert.strictEqual(rows[0].kind, 'user');
		assert.ok(rows.slice(1).every(row => row.historyIndex >= displayStart));
	});

	test('prepends earlier messages without mounting the full transcript', () => {
		const history = makeHistory(80);
		const initialStart = resolveDisplayStart({
			historyLength: history.length,
			expandedStart: AUTO_DISPLAY_START,
			turns: groupHistoryTurns(history),
		});
		assert.strictEqual(initialStart, 55);
		const first = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false, displayStart: initialStart });
		assert.strictEqual(first.length, CHAT_DISPLAY_WINDOW);

		const prependedStart = nextExpandedStart(initialStart);
		const prepended = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false, displayStart: prependedStart });
		assert.ok(prepended.length > CHAT_DISPLAY_WINDOW);
		assert.ok(prepended.length < 80);
		assert.strictEqual(prependedStart, 30);
		assert.ok(prepended.every(row => row.historyIndex >= prependedStart));
	});

	test('find searches full history then expanding displayStart reveals the hidden hit', () => {
		const history = makeHistory(80);
		const displayStart = resolveDisplayStart({
			historyLength: history.length,
			expandedStart: AUTO_DISPLAY_START,
			turns: groupHistoryTurns(history),
		});
		const pattern = compileKnoxSearchPattern('rare-token-xyz', { caseSensitive: false, useRegex: false });
		assert.deepStrictEqual(findKnoxHistoryIndexes(history, pattern), [0]);
		assert.ok(knoxHistoryItemSearchText(history[0]).includes('rare-token-xyz'));

		const windowed = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false, displayStart });
		assert.deepStrictEqual(findKnoxThreadMatches(windowed, pattern), []);

		const full = buildKnoxThreadRows(history, { mode: 'chat', isStreaming: false, displayStart: 0 });
		const hits = findKnoxThreadMatches(full, pattern);
		assert.ok(hits.length >= 1);
		assert.strictEqual(hits[0].historyIndex, 0);

		const expandedStart = hits[0].historyIndex;
		const expandedDisplay = resolveDisplayStart({
			historyLength: history.length,
			expandedStart,
			turns: groupHistoryTurns(history),
		});
		assert.strictEqual(expandedDisplay, 0);
		const expanded = buildKnoxThreadRows(history, {
			mode: 'chat',
			isStreaming: false,
			displayStart: expandedDisplay,
		});
		assert.strictEqual(expanded[0].historyIndex, 0);
		assert.ok(findKnoxThreadMatches(expanded, pattern).length >= 1);
		assert.deepStrictEqual(knoxVisibleHistoryIndexes(history, expandedDisplay)[0], 0);
	});

	test('loadEarlierMessages and loadingConversation i18n exist in en and zh', () => {
		assert.ok(knoxHasNlsKey('loadEarlierMessages'));
		assert.ok(knoxHasNlsKey('loadingConversation'));
		assert.strictEqual(
			knoxNls('loadEarlierMessages', { count: 12 }, undefined, 'en'),
			'Load 12 earlier messages',
		);
		assert.strictEqual(
			knoxNls('loadEarlierMessages', { count: 12 }, undefined, 'zh'),
			'加载更早的 12 条消息',
		);
		assert.strictEqual(knoxNls('loadingConversation', undefined, undefined, 'en'), 'Loading conversation…');
		assert.strictEqual(knoxNls('loadingConversation', undefined, undefined, 'zh'), '正在加载对话…');
	});
});
