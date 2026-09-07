/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as Diff from 'diff';

import { computeInlineLineDiffs } from '../checkpoints/inlineDiffLines';

suite('inlineDiffLines (CP-29)', () => {
	test('reports added, removed, and modified lines against a checkpoint snapshot', () => {
		const diffs = computeInlineLineDiffs(
			'const a = 1;\nconst b = 2;\n',
			'const a = 1;\nconst b = 3;\nconst c = 4;\n',
			Diff.diffLines,
			Diff.diffWords,
		);
		const types = diffs.map((diff) => diff.type);
		assert.ok(types.includes('modified') || types.includes('removed'));
		assert.ok(types.includes('added'));
		const modified = diffs.find((diff) => diff.type === 'modified' || diff.type === 'removed');
		assert.ok(modified?.originalContent?.includes('const b = 2'));
	});

	test('identical trees produce no decorations', () => {
		const text = 'export const n = 1;\n';
		assert.deepStrictEqual(
			computeInlineLineDiffs(text, text, Diff.diffLines, Diff.diffWords),
			[],
		);
	});

	test('non-string inputs do not throw', () => {
		assert.deepStrictEqual(
			computeInlineLineDiffs(
				{ content: 'x' } as unknown as string,
				'x\n',
				Diff.diffLines,
				Diff.diffWords,
			),
			[],
		);
	});
});
