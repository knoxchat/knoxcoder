/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	isKnoxLumpSection,
	KNOX_LUMP_SECTIONS,
	knoxLumpSectionContentVisible,
	knoxLumpShouldSaveBeforeNewChat,
	knoxToggleLumpSection,
} from '../../common/knoxLump.js';
import type { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';

suite('knox lump (T5.3)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('lists the GUI Lump sections in order', () => {
		assert.deepStrictEqual(
			[...KNOX_LUMP_SECTIONS],
			['models', 'rules', 'prompts', 'tools', 'history', 'checkpoints'],
		);
		assert.strictEqual(isKnoxLumpSection('models'), true);
		assert.strictEqual(isKnoxLumpSection('context'), false);
		assert.strictEqual(isKnoxLumpSection(''), false);
	});

	test('toggles a section closed when it is already selected', () => {
		assert.strictEqual(knoxToggleLumpSection(undefined, 'models'), 'models');
		assert.strictEqual(knoxToggleLumpSection('models', 'models'), undefined);
		assert.strictEqual(knoxToggleLumpSection('models', 'rules'), 'rules');
	});

	test('hides section content while streaming except pending Tools', () => {
		const empty: IKnoxChatHistoryItem[] = [];
		const generated: IKnoxChatHistoryItem[] = [{
			message: { role: 'assistant', content: '', id: 'a' },
			contextItems: [],
			toolCallState: {
				toolCallId: 't1',
				status: 'generated',
				parsedArgs: {},
				toolCall: { id: 't1', type: 'function', function: { name: 'builtin_read_file', arguments: '{}' } },
			},
		}];
		assert.strictEqual(knoxLumpSectionContentVisible({ section: undefined, isStreaming: false, history: empty }), false);
		assert.strictEqual(knoxLumpSectionContentVisible({ section: 'models', isStreaming: false, history: empty }), true);
		assert.strictEqual(knoxLumpSectionContentVisible({ section: 'models', isStreaming: true, history: empty }), false);
		assert.strictEqual(knoxLumpSectionContentVisible({ section: 'tools', isStreaming: true, history: empty }), false);
		assert.strictEqual(knoxLumpSectionContentVisible({ section: 'tools', isStreaming: true, history: generated }), true);
		assert.strictEqual(knoxLumpSectionContentVisible({ section: 'models', isStreaming: true, history: generated }), false);
	});

	test('saves the current thread before New Chat when history exists', () => {
		assert.strictEqual(knoxLumpShouldSaveBeforeNewChat(0), false);
		assert.strictEqual(knoxLumpShouldSaveBeforeNewChat(1), true);
	});
});
