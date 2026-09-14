/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	compileKnoxSearchPattern,
	findKnoxThreadMatches,
	knoxFindMatchRanges,
	knoxNextFindIndex,
	knoxTextMatchesPattern,
} from '../../common/knoxFind.js';
import type { IKnoxThreadRow } from '../../common/knoxThreadModel.js';

suite('knox find', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('compiles literal case-insensitive by default', () => {
		assert.deepStrictEqual(
			compileKnoxSearchPattern('Foo', { caseSensitive: false, useRegex: false }),
			{ kind: 'literal', value: 'foo', caseSensitive: false },
		);
	});

	test('compiles valid regex and rejects invalid regex', () => {
		const valid = compileKnoxSearchPattern('fo+', { caseSensitive: true, useRegex: true });
		assert.strictEqual(valid.kind, 'regex');
		const invalid = compileKnoxSearchPattern('(', { caseSensitive: false, useRegex: true });
		assert.strictEqual(invalid.kind, 'invalid');
	});

	test('finds literal and regex ranges', () => {
		const literal = compileKnoxSearchPattern('ab', { caseSensitive: false, useRegex: false });
		assert.deepStrictEqual(knoxFindMatchRanges('abXab', literal), [
			{ start: 0, end: 2 },
			{ start: 3, end: 5 },
		]);
		const regex = compileKnoxSearchPattern('a+', { caseSensitive: true, useRegex: true });
		assert.deepStrictEqual(knoxFindMatchRanges('baaac', regex), [{ start: 1, end: 4 }]);
		assert.deepStrictEqual(
			knoxFindMatchRanges('abc', compileKnoxSearchPattern('(', { caseSensitive: false, useRegex: true })),
			[],
		);
	});

	test('matches literals case-insensitively', () => {
		const pattern = compileKnoxSearchPattern('Hi', { caseSensitive: false, useRegex: false });
		assert.strictEqual(knoxTextMatchesPattern('say hi there', pattern), true);
		assert.strictEqual(knoxTextMatchesPattern('nope', pattern), false);
	});

	test('searches flattened thread rows and wraps next/previous', () => {
		const rows: IKnoxThreadRow[] = [
			{ id: 'user:1', kind: 'user', historyIndex: 0, measuredHeight: undefined, item: { message: { role: 'user', content: 'Hello world' }, contextItems: [] } },
			{ id: 'assistant:1', kind: 'assistant', historyIndex: 1, measuredHeight: undefined, item: { message: { role: 'assistant', content: 'hello again' }, contextItems: [] } },
		];
		const hits = findKnoxThreadMatches(rows, compileKnoxSearchPattern('hello', { caseSensitive: false, useRegex: false }));
		assert.strictEqual(hits.length, 2);
		assert.strictEqual(hits[0].rowId, 'user:1');
		assert.strictEqual(hits[1].rowId, 'assistant:1');
		assert.strictEqual(knoxNextFindIndex(0, 2, 1), 1);
		assert.strictEqual(knoxNextFindIndex(1, 2, 1), 0);
		assert.strictEqual(knoxNextFindIndex(0, 2, -1), 1);
	});
});
