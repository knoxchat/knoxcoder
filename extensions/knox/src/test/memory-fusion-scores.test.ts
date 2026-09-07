/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import {
	detectFusionProfile,
	fusionWeightsAreSafe,
	FUSION_WEIGHT_PROFILES,
	getFusionWeights,
} from '../../core/context/memory/brain/memoryConfigAccess';
import {
	fuseCandidateScore,
	normalizeBm25,
	RECENCY_IMPORTANCE_THETA_MARGIN,
} from '../../core/context/memory/brain/RetrievalFusion';

function assertCloseTo(actual: number, expected: number, digits = 5): void {
	const tol = 10 ** -digits / 2;
	assert.ok(
		Math.abs(actual - expected) < tol,
		`${actual} is not close to ${expected}`,
	);
}

suite('REL-02 absolute BM25 + fusion cap (pure)', () => {
	test('maps BM25 independently of other hits (not min-max)', () => {
		assert.strictEqual(normalizeBm25(0), 0);
		assert.strictEqual(normalizeBm25(-1), 0);
		const weak = normalizeBm25(0.15);
		const strong = normalizeBm25(2.5);
		assert.ok(weak > 0);
		assert.ok(weak < 0.2);
		assert.ok(strong > 0.9);
		assert.ok(strong <= 1);
		assert.strictEqual(normalizeBm25(0.15), weak);
		assert.ok(Math.abs(weak - 1) > 0.1);
	});

	test('a high-importance memory with zero overlap scores below θ', () => {
		const theta = 0.6;
		const conversational = getFusionWeights('conversational');
		const score = fuseCandidateScore(
			{ fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
			conversational,
			theta,
		);
		assert.ok(score < theta);
		assert.ok(score <= theta - RECENCY_IMPORTANCE_THETA_MARGIN + 1e-9);
	});

	test('caps recency+importance so they cannot clear θ alone even with heavy weights', () => {
		const theta = 0.6;
		const heavyRi = {
			fts5: 0.1,
			trigram: 0.1,
			graph: 0.1,
			recency: 0.4,
			importance: 0.4,
		};
		const zeroLexical = fuseCandidateScore(
			{ fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
			heavyRi,
			theta,
		);
		assert.ok(zeroLexical < theta);
		assertCloseTo(zeroLexical, theta - RECENCY_IMPORTANCE_THETA_MARGIN, 5);

		const withLexical = fuseCandidateScore(
			{ fts5: 0.8, trigram: 0, graph: 0, recency: 1, importance: 1 },
			heavyRi,
			theta,
		);
		assert.ok(withLexical > theta);
	});

	test('REL-11: graph cannot lift a zero-lexical candidate over θ', () => {
		const theta = 0.6;
		const heavyGraph = {
			fts5: 0.1,
			trigram: 0.1,
			graph: 0.9,
			recency: 0.15,
			importance: 0.15,
		};
		const score = fuseCandidateScore(
			{ fts5: 0, trigram: 0, graph: 1, recency: 1, importance: 1 },
			heavyGraph,
			theta,
		);
		assert.ok(score < theta);

		const withLexicalFloor = fuseCandidateScore(
			{ fts5: 0.3, trigram: 0, graph: 1, recency: 0.5, importance: 0.5 },
			heavyGraph,
			theta,
		);
		assert.ok(withLexicalFloor > score);
	});
});

suite('REL-09 fusion weight safety (pure)', () => {
	const theta = 0.6;

	test('every profile has w_recency + w_importance < retrieval_threshold', () => {
		for (const profile of FUSION_WEIGHT_PROFILES) {
			const weights = getFusionWeights(profile);
			assert.strictEqual(fusionWeightsAreSafe(weights, theta), true);
			assert.ok(weights.recency + weights.importance < theta);
			const zeroOverlap = fuseCandidateScore(
				{ fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
				weights,
				theta,
			);
			assert.ok(zeroOverlap < theta);
		}
	});

	test('conversational recency is lowered and fts5 is raised', () => {
		const conversational = getFusionWeights('conversational');
		assert.ok(conversational.recency <= 0.15);
		assert.ok(conversational.fts5 >= 0.40);
		assert.ok(conversational.recency + conversational.importance < theta);
	});

	test('continuation ranks recency higher within a gated (lexical) set', () => {
		const continuation = getFusionWeights('continuation');
		assert.ok(continuation.recency > getFusionWeights('conversational').recency);
		const recent = fuseCandidateScore(
			{ fts5: 0.8, trigram: 0, graph: 0, recency: 1, importance: 0.5 },
			continuation,
			theta,
		);
		const stale = fuseCandidateScore(
			{ fts5: 0.8, trigram: 0, graph: 0, recency: 0.2, importance: 0.5 },
			continuation,
			theta,
		);
		assert.ok(recent > stale);
	});

	test('detects continuation even after REL-01 query expansion', () => {
		assert.strictEqual(detectFusionProfile('continue'), 'continuation');
		assert.strictEqual(
			detectFusionProfile('oauth jwt refresh', {
				intent: 'continuation',
				originalQuery: 'continue',
			}),
			'continuation',
		);
	});

	test('does not treat a short task message as factual importance boost', () => {
		assert.strictEqual(detectFusionProfile('use sqlite for the brain'), 'default');
		assert.strictEqual(detectFusionProfile('What is JWT?'), 'factual');
		const factual = getFusionWeights('factual');
		const defaults = getFusionWeights('default');
		assert.ok(factual.importance <= defaults.importance);
	});

	test('classifies procedural from the original message, not the stripped query', () => {
		assert.strictEqual(
			detectFusionProfile('install docker', {
				originalQuery: 'How to install docker',
			}),
			'procedural',
		);
	});
});
