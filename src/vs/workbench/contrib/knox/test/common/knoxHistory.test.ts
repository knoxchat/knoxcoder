/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	formatKnoxSessionDate,
	knoxDateGroup,
	knoxFilterSessions,
	knoxGroupByDate,
	knoxLevenshtein,
	knoxSessionExportFilename,
	knoxSessionExportMarkdown,
	knoxWorkspaceBasename,
	parseKnoxSessionDate,
} from '../../common/knoxHistory.js';
import type { IKnoxSession, IKnoxSessionMetadata } from '../../common/knoxChatTypes.js';

function session(partial: Partial<IKnoxSessionMetadata> & Pick<IKnoxSessionMetadata, 'sessionId' | 'title'>): IKnoxSessionMetadata {
	return partial;
}

suite('knox history (T7.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseDate accepts ISO and integer millis', () => {
		const iso = parseKnoxSessionDate('2026-09-14T00:00:00.000Z');
		assert.strictEqual(iso.toISOString(), '2026-09-14T00:00:00.000Z');
		const millis = parseKnoxSessionDate(String(Date.parse('2026-01-02T03:04:00.000Z')));
		assert.strictEqual(millis.toISOString(), '2026-01-02T03:04:00.000Z');
	});

	test('formatSessionDate is numeric and 24h', () => {
		const formatted = formatKnoxSessionDate(new Date('2026-09-14T15:04:00'));
		assert.match(formatted, /\d/);
		assert.ok(!formatted.toLowerCase().includes('am'));
		assert.ok(!formatted.toLowerCase().includes('pm'));
	});

	test('workspace basename strips file URIs', () => {
		assert.strictEqual(knoxWorkspaceBasename('file:///tmp/my-app'), 'my-app');
		assert.strictEqual(knoxWorkspaceBasename('/tmp/my-app'), 'my-app');
		assert.strictEqual(knoxWorkspaceBasename(undefined), '');
	});

	test('MiniSearch-equivalent title filter is fuzzy and prefix-aware', () => {
		const sessions = [
			session({ sessionId: 'a', title: 'Fix login bug', dateCreated: '2026-09-14T10:00:00.000Z' }),
			session({ sessionId: 'b', title: 'Conversation history', dateCreated: '2026-09-13T10:00:00.000Z' }),
			session({ sessionId: 'c', title: 'Unrelated notes', dateCreated: '2026-08-01T10:00:00.000Z' }),
		];
		assert.deepStrictEqual(knoxFilterSessions(sessions, '').map(item => item.sessionId), ['a', 'b', 'c']);
		assert.deepStrictEqual(knoxFilterSessions(sessions, 'bug').map(item => item.sessionId), ['a']);
		assert.deepStrictEqual(knoxFilterSessions(sessions, 'hist').map(item => item.sessionId), ['b']);
		assert.ok(knoxLevenshtein('conversation', 'conversaton') <= 2);
		assert.ok(knoxFilterSessions(sessions, 'conversaton').some(item => item.sessionId === 'b'));
	});

	test('groups sessions into today / week / month / older buckets', () => {
		const now = Date.parse('2026-09-14T12:00:00.000Z');
		const sessions = [
			session({ sessionId: 'today', title: 't', dateCreated: '2026-09-14T08:00:00.000Z' }),
			session({ sessionId: 'week', title: 'w', dateCreated: '2026-09-10T08:00:00.000Z' }),
			session({ sessionId: 'month', title: 'm', dateCreated: '2026-08-20T08:00:00.000Z' }),
			session({ sessionId: 'old', title: 'o', dateCreated: '2026-01-01T08:00:00.000Z' }),
		];
		assert.strictEqual(knoxDateGroup(parseKnoxSessionDate(sessions[0].dateCreated), now), 'today');
		assert.strictEqual(knoxDateGroup(parseKnoxSessionDate(sessions[1].dateCreated), now), 'thisWeek');
		assert.strictEqual(knoxDateGroup(parseKnoxSessionDate(sessions[2].dateCreated), now), 'thisMonth');
		assert.strictEqual(knoxDateGroup(parseKnoxSessionDate(sessions[3].dateCreated), now), 'earlier');
		assert.deepStrictEqual(
			knoxGroupByDate(sessions, item => parseKnoxSessionDate(item.dateCreated), now).map(group => group.id),
			['today', 'thisWeek', 'thisMonth', 'earlier'],
		);
	});

	test('export markdown quotes messages and sanitizes the filename', () => {
		const sessionDoc: IKnoxSession = {
			sessionId: 's1',
			title: 'Fix login / auth!',
			workspaceDirectory: '/tmp/app',
			history: [
				{ message: { role: 'user', content: 'hello\nthere' }, contextItems: [] },
				{ message: { role: 'assistant', content: 'hi' }, contextItems: [] },
			],
		};
		const markdown = knoxSessionExportMarkdown(sessionDoc, new Date('2026-09-14T00:00:00.000Z'));
		assert.ok(markdown.includes('**Session:** Fix login / auth!'));
		assert.ok(markdown.includes('**Workspace:** app'));
		assert.ok(markdown.includes('> hello'));
		assert.ok(markdown.includes('> there'));
		assert.ok(markdown.includes('_User_'));
		assert.ok(markdown.includes('_Knox_'));
		assert.strictEqual(
			knoxSessionExportFilename(sessionDoc.title, new Date('2026-09-14T00:00:00.000Z')),
			'2026-09-14_Fix_login_auth.md',
		);
	});
});
