/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxExtractHistoricalChips,
	knoxHistoricalChipsEnableSuggestion,
	knoxHistoricalSegments,
	knoxIsTipTapEditorState,
} from '../../common/knoxHistoricalChips.js';

suite('knox historical chips (T4.9)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('native editorState chips stay in the typed text as non-editable segments', () => {
		const editorState = {
			mentions: [{ id: 'file:///ws/package.json', label: 'package.json', itemType: 'file', query: 'file:///ws/package.json' }],
			slashCommands: [{ id: 'commit', label: 'commit' }],
		};
		const extracted = knoxExtractHistoricalChips(editorState);
		assert.strictEqual(extracted.fromTipTap, false);
		assert.ok(extracted.hasChips);
		assert.strictEqual(extracted.mentions[0].label, 'package.json');

		const segments = knoxHistoricalSegments(editorState, 'please @package.json then /commit ');
		assert.deepStrictEqual(segments.map(s => s.kind), ['text', 'chip', 'text', 'chip', 'text']);
		assert.strictEqual(segments[1].kind === 'chip' && segments[1].chip.kind, 'mention');
		assert.strictEqual(segments[3].kind === 'chip' && segments[3].chip.kind, 'slash');
		assert.strictEqual(knoxHistoricalChipsEnableSuggestion(false), false);
		assert.strictEqual(knoxHistoricalChipsEnableSuggestion(true), false);
	});

	test('TipTap JSON from loaded webview sessions walks mention and slash nodes', () => {
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'See ' },
						{
							type: 'mention',
							attrs: {
								id: 'file:///ws/core.ts',
								label: 'core.ts',
								query: 'file:///ws/core.ts',
								itemType: 'file',
							},
						},
						{ type: 'text', text: ' via ' },
						{ type: 'slashcommand', attrs: { id: 'edit', label: 'edit' } },
					],
				},
			],
		};
		assert.ok(knoxIsTipTapEditorState(doc));
		const extracted = knoxExtractHistoricalChips(doc);
		assert.strictEqual(extracted.fromTipTap, true);
		assert.strictEqual(extracted.mentions.length, 1);
		assert.strictEqual(extracted.slashCommands.length, 1);

		const segments = knoxHistoricalSegments(doc, 'ignored resolved body');
		assert.deepStrictEqual(
			segments.map(s => s.kind === 'text' ? s.text : s.chip.label),
			['See ', '@core.ts', ' via ', '/edit'],
		);
	});

	test('plain user text without chips is a single text segment', () => {
		assert.deepStrictEqual(
			knoxHistoricalSegments({ mentions: [] }, 'hello'),
			[{ kind: 'text', text: 'hello' }],
		);
		assert.strictEqual(knoxExtractHistoricalChips(undefined).hasChips, false);
		assert.strictEqual(knoxIsTipTapEditorState({ mentions: [] }), false);
	});

	test('historical file chips stay openable; slash chips do not', () => {
		const segments = knoxHistoricalSegments({
			mentions: [{ id: 'file:///ws/a.ts', label: 'a.ts', itemType: 'file', query: 'file:///ws/a.ts' }],
			slashCommands: [{ id: 'commit' }],
		}, '@a.ts /commit');
		const mention = segments.find(s => s.kind === 'chip' && s.chip.kind === 'mention');
		const slash = segments.find(s => s.kind === 'chip' && s.chip.kind === 'slash');
		assert.ok(mention && mention.kind === 'chip');
		assert.strictEqual(mention.chip.itemType, 'file');
		assert.strictEqual(mention.chip.query, 'file:///ws/a.ts');
		assert.ok(slash && slash.kind === 'chip');
		assert.strictEqual(slash.chip.itemType, 'slashCommand');
	});
});
