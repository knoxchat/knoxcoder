/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import {
	findMissingRequiredParams,
	incompleteToolCallMessage,
	isMissingToolArg,
} from '../agent/toolCallValidation';

suite('toolCallValidation', () => {
	test('isMissingToolArg treats empty string as missing', () => {
		assert.strictEqual(isMissingToolArg(undefined), true);
		assert.strictEqual(isMissingToolArg(null), true);
		assert.strictEqual(isMissingToolArg(''), true);
		assert.strictEqual(isMissingToolArg('   '), true);
		assert.strictEqual(isMissingToolArg('ok'), false);
		assert.strictEqual(isMissingToolArg(0), false);
	});

	test('findMissingRequiredParams does not invent placeholders', () => {
		const tool = {
			name: 'builtin_create_new_file',
			requiredParams: ['filepath', 'contents'],
		};
		assert.deepStrictEqual(
			findMissingRequiredParams(tool, { filepath: 'a.ts' }),
			['contents'],
		);
		assert.deepStrictEqual(
			findMissingRequiredParams(tool, {
				filepath: 'a.ts',
				contents: '// TODO: Add file contents',
			}),
			[],
		);
		assert.deepStrictEqual(
			findMissingRequiredParams(tool, { filepath: '', contents: 'x' }),
			['filepath'],
		);
	});

	test('incompleteToolCallMessage names the tool and params', () => {
		const msg = incompleteToolCallMessage('builtin_exact_search', ['query']);
		assert.match(msg, /builtin_exact_search/);
		assert.match(msg, /query/);
		assert.match(msg, /placeholders are not accepted/i);
	});
});
