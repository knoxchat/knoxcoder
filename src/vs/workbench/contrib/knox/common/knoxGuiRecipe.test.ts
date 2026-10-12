/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiRecipeNeedsChoice, knoxGuiRecipeNotice, parseRecipeSettings } from './knoxGuiRecipe.js';
import { parseRecipeMetrics } from './knoxGuiCheckpoints.js';
import { memoryRecipeActions, parseMemoryRecipe } from './knoxGuiMemory.js';
import type { IKnoxGuiRecipeDecision } from './knoxGuiState.js';

suite('Knox GUI recipe notice (MC-25)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const recipe = { id: 'r1', title: 'Add lint script', uses: 5, reverts: 0, score: 1 };
	const decision = (over: Partial<IKnoxGuiRecipeDecision>): IKnoxGuiRecipeDecision => ({ mode: 'exact', why: '', needsConfirmation: false, recipe, ...over });

	test('exact shows title, uses and reverts', () => {
		assert.deepStrictEqual(knoxGuiRecipeNotice(decision({})), { key: 'recipeDecisionExact', params: { title: 'Add lint script', uses: 5, reverts: 0 }, undoCheckpointId: undefined });
	});

	test('undo is offered only once a replay created a checkpoint', () => {
		assert.strictEqual(knoxGuiRecipeNotice(decision({ undoCheckpointId: 'cp1' }))?.undoCheckpointId, 'cp1');
		assert.strictEqual(knoxGuiRecipeNotice(decision({ mode: 'suggest', undoCheckpointId: 'cp1' }))?.undoCheckpointId, undefined);
	});

	test('generate and missing decisions show nothing', () => {
		assert.strictEqual(knoxGuiRecipeNotice(undefined), undefined);
		assert.strictEqual(knoxGuiRecipeNotice(decision({ mode: 'generate' })), undefined);
		assert.strictEqual(knoxGuiRecipeNotice(decision({ recipe: undefined })), undefined);
	});

	test('the preview card waits only for an unanswered exact+ask decision (MC-35)', () => {
		const base = decision({ needsConfirmation: true, preview: '1 file(s)' });
		assert.strictEqual(knoxGuiRecipeNeedsChoice(base), true);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({ needsConfirmation: false, preview: 'x' })), false);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({ needsConfirmation: true })), false);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({ needsConfirmation: true, preview: 'x', mode: 'suggest' })), false);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({ needsConfirmation: true, preview: 'x', mode: 'adapt' })), true);
		assert.strictEqual(knoxGuiRecipeNeedsChoice({ ...base, replay: { status: 'applied', appliedPaths: [] } }), false);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(undefined), false);
	});
});

suite('Knox GUI recipe settings, tab and metrics (MC-70/71/72)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('settings default to off for anything unexpected', () => {
		assert.deepStrictEqual(parseRecipeSettings(undefined), { enabled: false, autoReplay: 'off', selfImprove: false });
		assert.deepStrictEqual(parseRecipeSettings({ enabled: 'yes', autoReplay: 'always', selfImprove: 1 }), { enabled: false, autoReplay: 'off', selfImprove: false });
		assert.deepStrictEqual(parseRecipeSettings({ enabled: true, autoReplay: 'ask', selfImprove: true }), { enabled: true, autoReplay: 'ask', selfImprove: true });
	});

	test('recipe rows parse defensively and drop unknown statuses', () => {
		assert.strictEqual(parseMemoryRecipe({ id: 'a', status: 'weird' }), undefined);
		assert.strictEqual(parseMemoryRecipe({ status: 'verified' }), undefined);
		const row = parseMemoryRecipe({ id: 'abc', title: '', status: 'verified', uses: -3, reverted: 2, sourceCheckpointIds: ['c1', 5] });
		assert.deepStrictEqual({ title: row?.title, uses: row?.uses, reverted: row?.reverted, ids: row?.sourceCheckpointIds, scope: row?.scope }, { title: 'abc', uses: 0, reverted: 2, ids: ['c1'], scope: 'project' });
	});

	test('actions follow the host state machine', () => {
		assert.deepStrictEqual(memoryRecipeActions('candidate'), { quarantine: true, retire: true });
		assert.deepStrictEqual(memoryRecipeActions('verified'), { quarantine: true, retire: true });
		assert.deepStrictEqual(memoryRecipeActions('quarantined'), { quarantine: false, retire: true });
		assert.deepStrictEqual(memoryRecipeActions('retired'), { quarantine: false, retire: false });
	});

	test('dashboard metrics: absent stays absent, bad numbers become 0 and the rate is capped', () => {
		assert.strictEqual(parseRecipeMetrics(undefined), undefined);
		assert.deepStrictEqual(parseRecipeMetrics({ attempts: 4, applied: 3, failedVerify: 1, reverted: 'x', llmCallsAvoided: 3, tokensSaved: 900, wrongApplyRate: 7 }), {
			attempts: 4, applied: 3, failedVerify: 1, reverted: 0, llmCallsAvoided: 3, tokensSaved: 900, wrongApplyRate: 1,
		});
	});
});
