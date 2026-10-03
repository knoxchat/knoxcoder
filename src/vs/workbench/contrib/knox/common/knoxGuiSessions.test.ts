/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { KNOX_PINNED_SESSIONS_MAX, knoxGuiDecorateSessions, knoxGuiForkHistory, knoxGuiForkTitle, knoxGuiMergeContentHits, knoxGuiParsePinned, knoxGuiSerializePinned, knoxGuiTogglePinned } from './knoxGuiSessions.js';
import { groupHistoryByDate } from './knoxGuiOverlays.js';
import type { IKnoxGuiHistoryItem, IKnoxGuiHistorySession } from './knoxGuiState.js';

const item = (id: string, role: IKnoxGuiHistoryItem['role'], toolStatus?: 'calling' | 'done'): IKnoxGuiHistoryItem => ({
	id, role, content: id,
	...(toolStatus ? { toolCalls: [{ id: `${id}-t`, name: 'run_command', arguments: '{}', status: toolStatus }] } : {}),
});
const session = (id: string, title = id): IKnoxGuiHistorySession => ({ id, title, date: '2026-01-01' });

suite('Knox GUI session management (K-043)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('pinning toggles, puts the newest pin first, caps and round trips through storage', () => {
		let pinned = knoxGuiTogglePinned([], 'a');
		pinned = knoxGuiTogglePinned(pinned, 'b');
		assert.deepStrictEqual(pinned, ['b', 'a']);
		assert.deepStrictEqual(knoxGuiTogglePinned(pinned, 'b'), ['a']);
		assert.deepStrictEqual(knoxGuiTogglePinned(pinned, ''), ['b', 'a']);
		assert.deepStrictEqual(knoxGuiParsePinned(knoxGuiSerializePinned(pinned)), pinned);
		assert.deepStrictEqual(knoxGuiParsePinned('{oops'), []);
		assert.deepStrictEqual(knoxGuiParsePinned('[1,"x",""]'), ['x']);
		const many = Array.from({ length: KNOX_PINNED_SESSIONS_MAX + 3 }, (_, i) => `s${i}`);
		assert.strictEqual(knoxGuiTogglePinned(many, 'new').length, KNOX_PINNED_SESSIONS_MAX);
	});

	test('decorating marks pinned sessions and attaches snippets without touching the others', () => {
		const all = [session('a'), session('b'), session('c')];
		const out = knoxGuiDecorateSessions(all, ['b'], { c: '...needle...' });
		assert.strictEqual(out[0], all[0]);
		assert.strictEqual(out[1].pinned, true);
		assert.strictEqual(out[2].snippet, '...needle...');
	});

	test('content hits add sessions the title filter missed, once', () => {
		const all = [session('a'), session('b'), session('c')];
		const merged = knoxGuiMergeContentHits([all[0]], all, { a: 'x', c: 'y' });
		assert.deepStrictEqual(merged.map(s => s.id), ['a', 'c']);
	});

	test('forking at a reply keeps it, forking at a user message stops before it', () => {
		const history = [item('u1', 'user'), item('a1', 'assistant'), item('u2', 'user'), item('a2', 'assistant')];
		assert.deepStrictEqual(knoxGuiForkHistory(history, 1).map(i => i.id), ['u1', 'a1']);
		assert.deepStrictEqual(knoxGuiForkHistory(history, 2).map(i => i.id), ['u1', 'a1']);
		assert.deepStrictEqual(knoxGuiForkHistory(history, 3).map(i => i.id), ['u1', 'a1', 'u2', 'a2']);
		assert.deepStrictEqual(knoxGuiForkHistory(history, 9), []);
		assert.deepStrictEqual(knoxGuiForkHistory(history, 0), []);
	});

	test('forking cancels tool calls that never finished and leaves the source untouched', () => {
		const history = [item('u1', 'user'), item('a1', 'assistant', 'calling'), item('a2', 'assistant', 'done')];
		const forked = knoxGuiForkHistory(history, 2);
		assert.strictEqual(forked[1].toolCalls?.[0].status, 'canceled');
		assert.strictEqual(forked[2], history[2]);
		assert.strictEqual(history[1].toolCalls?.[0].status, 'calling');
	});

	test('fork titles get one suffix', () => {
		assert.strictEqual(knoxGuiForkTitle('Fix bug', '(fork)'), 'Fix bug (fork)');
		assert.strictEqual(knoxGuiForkTitle('Fix bug (fork)', '(fork)'), 'Fix bug (fork)');
		assert.strictEqual(knoxGuiForkTitle('  ', '(fork)'), '(fork)');
	});

	test('pinned sessions form their own group above the date groups', () => {
		const now = Date.parse('2026-01-02T12:00:00Z');
		const groups = groupHistoryByDate([{ ...session('p'), pinned: true }, session('a')], now);
		assert.strictEqual(groups[0].header, 'pinned');
		assert.deepStrictEqual(groups[0].sessions.map(s => s.id), ['p']);
		assert.strictEqual(groups.length, 2);
		assert.deepStrictEqual(groups[1].sessions.map(s => s.id), ['a']);
	});
});
