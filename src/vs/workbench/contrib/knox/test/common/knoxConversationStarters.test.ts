/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxBookmarkedCommands,
	knoxDefaultBookmarks,
	knoxParseBookmarks,
	knoxStarterInsertText,
	knoxVisibleStarters,
} from '../../common/knoxConversationStarters.js';
import type { IKnoxSlashCommand } from '../../common/knoxChatTypes.js';

const commands: IKnoxSlashCommand[] = [
	{ name: 'commit', description: 'Write a commit', prompt: 'Commit the staged files.' },
	{ name: 'review', description: 'Review', prompt: 'Review this diff.' },
	{ name: 'test', prompt: 'Run tests.' },
	{ name: 'docs' },
	{ name: 'plan', prompt: 'Make a plan.' },
	{ name: 'extra', prompt: 'More.' },
];

suite('knox conversation starters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('defaults to the first five slash commands when nothing is stored', () => {
		assert.deepStrictEqual(knoxDefaultBookmarks(commands), ['commit', 'review', 'test', 'docs', 'plan']);
		assert.deepStrictEqual(knoxParseBookmarks(undefined, knoxDefaultBookmarks(commands)), ['commit', 'review', 'test', 'docs', 'plan']);
		assert.deepStrictEqual(knoxParseBookmarks('[]', knoxDefaultBookmarks(commands)), []);
	});

	test('filters bookmarked commands and paginates the empty-state cards', () => {
		const bookmarked = knoxBookmarkedCommands(commands, ['plan', 'commit']);
		assert.deepStrictEqual(bookmarked.map(command => command.name), ['plan', 'commit']);
		const collapsed = knoxVisibleStarters(commands, false, 5);
		assert.strictEqual(collapsed.visible.length, 5);
		assert.strictEqual(collapsed.remaining, 1);
		const expanded = knoxVisibleStarters(commands, true, 5);
		assert.strictEqual(expanded.visible.length, 6);
		assert.strictEqual(expanded.remaining, 0);
	});

	test('injects the prompt, or a slash chip when the command has no prompt', () => {
		assert.strictEqual(knoxStarterInsertText(commands[0]), 'Commit the staged files.');
		assert.strictEqual(knoxStarterInsertText({ name: 'help' }), '/help');
	});
});
