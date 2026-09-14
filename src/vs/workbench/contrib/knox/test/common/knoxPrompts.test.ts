/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxFormatPromptCommandName,
	knoxIsCommandBookmarked,
	knoxPromptFormIsValid,
	knoxPromptPayload,
	knoxSortSlashCommandsByBookmark,
	knoxToggleBookmark,
} from '../../common/knoxPrompts.js';

suite('knox prompts (T5.6)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefixes a slash on add-prompt names', () => {
		assert.strictEqual(knoxFormatPromptCommandName('check'), '/check');
		assert.strictEqual(knoxFormatPromptCommandName('/check'), '/check');
		assert.strictEqual(knoxFormatPromptCommandName('  review  '), '/review');
		assert.strictEqual(knoxFormatPromptCommandName('   '), '');
	});

	test('requires name, description, and prompt body', () => {
		assert.strictEqual(knoxPromptFormIsValid({ name: '/a', description: 'd', prompt: 'p' }), true);
		assert.strictEqual(knoxPromptFormIsValid({ name: '', description: 'd', prompt: 'p' }), false);
		assert.strictEqual(knoxPromptFormIsValid({ name: 'a', description: '  ', prompt: 'p' }), false);
		assert.deepStrictEqual(knoxPromptPayload({ name: 'check', description: '  desc  ', prompt: '  body  ' }), {
			name: '/check',
			description: 'desc',
			prompt: 'body',
		});
	});

	test('sorts bookmarked slash commands first without changing relative order', () => {
		const commands = [
			{ name: 'commit', description: 'Commit' },
			{ name: 'review', description: 'Review' },
			{ name: 'plan', description: 'Plan' },
		];
		assert.deepStrictEqual(
			knoxSortSlashCommandsByBookmark(commands, ['plan', 'commit']).map(command => command.name),
			['commit', 'plan', 'review'],
		);
		assert.deepStrictEqual(knoxToggleBookmark(['commit'], 'plan'), ['commit', 'plan']);
		assert.deepStrictEqual(knoxToggleBookmark(['commit', 'plan'], 'commit'), ['plan']);
		assert.strictEqual(knoxIsCommandBookmarked(['commit'], 'commit'), true);
		assert.strictEqual(knoxIsCommandBookmarked(['commit'], 'plan'), false);
	});
});
