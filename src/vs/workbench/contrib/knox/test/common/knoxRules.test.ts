/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxMergeRuleCards,
	knoxParseYamlRules,
	knoxProfileIsLocal,
} from '../../common/knoxRules.js';

suite('knox rules (T5.5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses inline strings and uses: blocks from assistant YAML', () => {
		const yaml = [
			'name: Local',
			'rules:',
			'  - Always be concise',
			'  - "Quoted rule"',
			'  - uses: knox/style',
			'  - uses: "knox/other"',
			'  - name: skipped',
			'    globs: ["*.ts"]',
			'models:',
			'  - title: GPT',
		].join('\n');
		assert.deepStrictEqual(knoxParseYamlRules(yaml), [
			'Always be concise',
			'Quoted rule',
			{ uses: 'knox/style' },
			{ uses: 'knox/other' },
			{},
		]);
		assert.deepStrictEqual(knoxParseYamlRules(undefined), []);
		assert.deepStrictEqual(knoxParseYamlRules('models:\n  - title: GPT\n'), []);
	});

	test('merges unrolled rules with YAML for titles and editability', () => {
		const cards = knoxMergeRuleCards(
			['local text', 'inline text', 'block text', 'hidden'],
			[undefined, 'inline yaml', { uses: 'knox/style' }, {}],
		);
		assert.deepStrictEqual(cards.map(card => ({ kind: card.titleKind, editable: card.editable, uses: card.uses })), [
			{ kind: 'local', editable: true, uses: undefined },
			{ kind: 'inline', editable: false, uses: undefined },
			{ kind: 'uses', editable: false, uses: 'knox/style' },
		]);
		assert.strictEqual(knoxMergeRuleCards(['only local'], []).length, 1);
		assert.strictEqual(knoxMergeRuleCards(['only local'], [])[0].titleKind, 'local');
	});

	test('treats missing profile type as local for Add vs Explore', () => {
		assert.strictEqual(knoxProfileIsLocal(undefined), true);
		assert.strictEqual(knoxProfileIsLocal('local'), true);
		assert.strictEqual(knoxProfileIsLocal('platform'), false);
	});
});
