/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import {
	buildFts5Query,
	contentWords,
	detectIntent,
	expandRetrievalQuery,
	pickLastSubstantialTurn,
} from '../../core/context/memory/brain/RetrievalQuery';

suite('REL-01 RetrievalQuery (pure)', () => {
	test('strips stopwords including continuation filler', () => {
		assert.deepStrictEqual(contentWords('ok now do it'), []);
		assert.deepStrictEqual(contentWords('now update the README'), ['update', 'readme']);
		assert.deepStrictEqual(contentWords('continue'), []);
		assert.deepStrictEqual(contentWords('We decided to use JWT refresh tokens'), [
			'decided',
			'use',
			'jwt',
			'refresh',
			'tokens',
		]);
	});

	test('detects continuation vs new task', () => {
		assert.strictEqual(detectIntent('continue'), 'continuation');
		assert.strictEqual(detectIntent('ok'), 'continuation');
		assert.strictEqual(detectIntent('yes please'), 'continuation');
		assert.strictEqual(detectIntent('keep going'), 'continuation');
		assert.strictEqual(detectIntent('now update the README'), 'new_task');
		assert.strictEqual(detectIntent('ok, now fix the README'), 'new_task');
		assert.strictEqual(detectIntent('Implement OAuth login'), 'new_task');
		assert.strictEqual(detectIntent('new question: how do I style the button?'), 'new_task');
		assert.strictEqual(detectIntent('new question: continue'), 'new_task');
		assert.strictEqual(
			detectIntent('also add jwt rotation', 'auth, jwt, oauth, login', 0.15),
			'continuation',
		);
	});

	test('does not put now* in the FTS query for README follow-ups', () => {
		const expanded = expandRetrievalQuery({ message: 'now update the README' });
		assert.strictEqual(expanded.intent, 'new_task');
		assert.strictEqual(expanded.retrievalQuery, 'update readme');
		const fts = expanded.fts5Query;
		assert.ok(fts);
		assert.doesNotMatch(fts, /\bnow\*/i);
		assert.match(fts, /update\*/);
		assert.match(fts, /readme\*/);
		assert.ok(fts.includes('AND'));
	});

	test('ANDs content words and never ORs stopwords', () => {
		const fts = buildFts5Query('ok now update the README please');
		assert.ok(fts);
		assert.strictEqual(fts, 'update* AND readme*');
		assert.ok(!fts.includes('ok'));
		assert.ok(!fts.includes('now'));
		assert.ok(!fts.includes('please'));
	});

	test('quotes hyphenated FTS terms (valid MATCH syntax)', () => {
		const fts = buildFts5Query('build-cache invalidation');
		assert.ok(fts);
		assert.ok(fts.includes('"build-cache"'));
		assert.ok(fts.includes('invalidation*'));
		assert.ok(fts.includes('AND'));
	});

	test('expands continuation with topic + last substantial turn', () => {
		const expanded = expandRetrievalQuery({
			message: 'continue',
			topicKeywords: 'auth, jwt, oauth',
			lastSubstantialTurn: 'How should we implement JWT refresh tokens?',
		});
		assert.strictEqual(expanded.intent, 'continuation');
		for (const word of ['auth', 'jwt', 'oauth', 'refresh', 'tokens']) {
			assert.ok(expanded.contentWords.includes(word), word);
		}
		assert.doesNotMatch(expanded.retrievalQuery, /\bcontinue\b/);
		const fts = expanded.fts5Query;
		assert.ok(fts);
		assert.doesNotMatch(fts, /\bcontinue\*/);
		assert.ok(!fts.includes('AND'));
	});

	test('does not mix last turn into a new-task query', () => {
		const expanded = expandRetrievalQuery({
			message: 'now update the README badges',
			topicKeywords: 'auth, jwt, oauth',
			lastSubstantialTurn: 'How should we implement JWT refresh tokens?',
		});
		assert.strictEqual(expanded.intent, 'new_task');
		assert.deepStrictEqual(expanded.contentWords, ['update', 'readme', 'badges']);
		assert.ok(!expanded.retrievalQuery.includes('jwt'));
		assert.ok(!expanded.retrievalQuery.includes('oauth'));
	});

	test('picks last substantial turn and skips pure continuations', () => {
		const picked = pickLastSubstantialTurn(
			['continue', 'ok', 'How should we implement JWT refresh tokens?', 'hi'],
			'continue',
		);
		assert.ok(picked?.includes('JWT refresh'));
	});

	test('ORs synonym extras outside the AND clause', () => {
		const fts = buildFts5Query('auth jwt', {
			useAnd: true,
			extraOrTerms: ['login', 'signin'],
		});
		assert.ok(fts);
		assert.match(fts, /^\(auth\* AND jwt\*\) OR login\* OR signin\*$/);
	});
});
