/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxAddTab,
	knoxHandleSessionChange,
	knoxParseTabs,
	knoxRemoveTab,
	knoxSerializeTabs,
	knoxSetActiveTab,
	knoxShowSessionTabs,
	type IKnoxSessionTab,
} from '../../common/knoxTabs.js';

function tab(partial: Partial<IKnoxSessionTab> & Pick<IKnoxSessionTab, 'id'>): IKnoxSessionTab {
	return {
		title: 'Chat 1',
		isActive: false,
		...partial,
	};
}

suite('knox session tabs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('updates the active tab title when the session already belongs to it', () => {
		const tabs = [tab({ id: 'a', isActive: true, sessionId: 's1', title: 'Old' })];
		const next = knoxHandleSessionChange(tabs, { currentSessionId: 's1', currentSessionTitle: 'Renamed' });
		assert.strictEqual(next[0].title, 'Renamed');
		assert.strictEqual(next[0].isActive, true);
	});

	test('activates an existing tab that already owns the session', () => {
		const tabs = [
			tab({ id: 'a', isActive: true, sessionId: 's1' }),
			tab({ id: 'b', sessionId: 's2', title: 'Other' }),
		];
		const next = knoxHandleSessionChange(tabs, { currentSessionId: 's2', currentSessionTitle: 'Other live' });
		assert.deepStrictEqual(next.map(item => item.isActive), [false, true]);
		assert.strictEqual(next[1].title, 'Other live');
	});

	test('assigns the current session onto a blank active tab', () => {
		const tabs = [tab({ id: 'a', isActive: true })];
		const next = knoxHandleSessionChange(tabs, { currentSessionId: 's9', currentSessionTitle: 'First' });
		assert.strictEqual(next[0].sessionId, 's9');
		assert.strictEqual(next[0].title, 'First');
	});

	test('opens a new tab when the active tab already has a different session', () => {
		const tabs = [tab({ id: 'a', isActive: true, sessionId: 's1', title: 'First' })];
		const next = knoxHandleSessionChange(tabs, {
			currentSessionId: 's2',
			currentSessionTitle: 'Second',
			newTabId: 'b',
		});
		assert.strictEqual(next.length, 2);
		assert.strictEqual(next[0].isActive, false);
		assert.deepStrictEqual(next[1], { id: 'b', title: 'Second', isActive: true, sessionId: 's2' });
	});

	test('add / remove / setActive keep a single active tab', () => {
		let tabs = [tab({ id: 'a', isActive: true, sessionId: 's1' })];
		tabs = knoxAddTab(tabs, tab({ id: 'b', isActive: true, title: 'Chat 2' }));
		assert.deepStrictEqual(tabs.map(item => item.isActive), [false, true]);
		tabs = knoxSetActiveTab(tabs, 'a');
		assert.deepStrictEqual(tabs.map(item => item.isActive), [true, false]);
		tabs = knoxRemoveTab(tabs, 'b');
		assert.strictEqual(tabs.length, 1);
		assert.strictEqual(tabs[0].id, 'a');
	});

	test('round-trips storage and reads the ui flag', () => {
		const tabs = [tab({ id: 'a', isActive: true, sessionId: 's1' })];
		assert.deepStrictEqual(knoxParseTabs(knoxSerializeTabs(tabs)), tabs);
		assert.strictEqual(knoxShowSessionTabs({ showSessionTabs: true }), true);
		assert.strictEqual(knoxShowSessionTabs({ showSessionTabs: false }), false);
		assert.strictEqual(knoxShowSessionTabs(undefined), false);
	});
});
