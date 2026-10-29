/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { knoxGuiRecipeLoopLine, knoxGuiRecipeNeedsChoice, knoxGuiRecipeNotice, knoxGuiRecipeSlotsReady, parseRecipeSettings, recipeApplyPayload, recipePreviewToMarkdown } from './knoxGuiRecipe.js';
import { parseRecipeMetrics } from './knoxGuiCheckpoints.js';
import { filterAndSortRecipes, groupRecipesByFamily, memoryRecipeActions, memoryRecipeCaptureNotice, memoryRecipeMatchNotice, parseMemoryRecipe, parseMemoryRecipeCapture, parseMemoryRecipeList, parseRecipeIdFromMemory } from './knoxGuiMemory.js';
import type { IKnoxGuiRecipeDecision } from './knoxGuiState.js';

suite('Knox GUI recipe notice (MC-25)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const recipe = { id: 'r1', title: 'Add lint script', uses: 5, reverts: 0, score: 1 };
	const decision = (over: Partial<IKnoxGuiRecipeDecision>): IKnoxGuiRecipeDecision => ({ mode: 'exact', why: '', needsConfirmation: false, recipe, ...over });

	test('exact shows title, uses and reverts', () => {
		assert.deepStrictEqual(knoxGuiRecipeNotice(decision({})), { key: 'recipeDecisionExact', params: { title: 'Add lint script', uses: 5, reverts: 0 }, undoCheckpointId: undefined, whatIfBranch: undefined });
		assert.ok(knoxGuiRecipeLoopLine(decision({}))?.includes('id=r1'));
		assert.ok(knoxGuiRecipeLoopLine(decision({}))?.includes('Add lint script'));
	});

	test('undo is offered only once a replay created a checkpoint', () => {
		assert.strictEqual(knoxGuiRecipeNotice(decision({ undoCheckpointId: 'cp1' }))?.undoCheckpointId, 'cp1');
		assert.strictEqual(knoxGuiRecipeNotice(decision({ mode: 'suggest', undoCheckpointId: 'cp1' }))?.undoCheckpointId, undefined);
	});

	test('generate shows a skipped card; missing decisions show nothing', () => {
		assert.strictEqual(knoxGuiRecipeNotice(undefined), undefined);
		assert.deepStrictEqual(knoxGuiRecipeNotice(decision({ mode: 'generate', recipe: undefined })), {
			key: 'recipeDecisionSkipped',
			params: { title: '', uses: 0, reverts: 0 },
		});
		assert.deepStrictEqual(knoxGuiRecipeNotice(decision({ mode: 'generate' })), {
			key: 'recipeDecisionSkippedNear',
			params: { title: 'Add lint script', uses: 5, reverts: 0 },
		});
		assert.ok(knoxGuiRecipeLoopLine(decision({ mode: 'generate' }))?.includes('skipped "Add lint script"'));
		assert.strictEqual(knoxGuiRecipeNotice(decision({ recipe: undefined, mode: 'exact' })), undefined);
	});

	test('awaitingChoice uses the previewed banner', () => {
		assert.strictEqual(knoxGuiRecipeNotice(decision({ awaitingChoice: true }))?.key, 'recipeDecisionPreviewed');
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
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({
			needsConfirmation: true,
			slots: [{ name: 'componentName', kind: 'identifier', filled: false }],
		})), true);
		assert.strictEqual(knoxGuiRecipeNeedsChoice(decision({
			needsConfirmation: true,
			files: [{ path: 'src/New.ts', action: 'create', included: false, extra: true }],
		})), true);
		assert.strictEqual(knoxGuiRecipeSlotsReady(decision({ slots: [{ name: 'x', kind: 'identifier', filled: false }] })), false);
		assert.strictEqual(knoxGuiRecipeSlotsReady(decision({ slots: [{ name: 'x', kind: 'identifier', value: 'Card', filled: true }] })), true);
		assert.deepStrictEqual(recipeApplyPayload(decision({
			files: [
				{ path: 'src/a.ts', action: 'modify', included: true },
				{ path: 'src/Extra.ts', action: 'create', included: true, extra: true },
				{ path: 'src/skip.ts', action: 'modify', included: false },
			],
			compose: { why: '2', recipes: [{ id: 'a', title: 'A', paths: ['src/a.ts'] }, { id: 'b', title: 'B', paths: ['src/b.ts'] }] },
		})), {
			slotValues: undefined,
			includePaths: ['src/a.ts'],
			approvedExtraPaths: ['src/Extra.ts'],
			composeIds: ['a', 'b'],
		});
	});
});

suite('Knox GUI recipe settings, tab and metrics (MC-70/71/72)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('settings default to off for anything unexpected', () => {
		assert.deepStrictEqual(parseRecipeSettings(undefined), { enabled: false, autoReplay: 'off', selfImprove: false });
		assert.deepStrictEqual(parseRecipeSettings({ enabled: 'yes', autoReplay: 'always', selfImprove: 1 }), { enabled: false, autoReplay: 'off', selfImprove: false });
		assert.deepStrictEqual(parseRecipeSettings({ enabled: true, autoReplay: 'ask', selfImprove: true }), { enabled: true, autoReplay: 'ask', selfImprove: true });
		assert.deepStrictEqual(parseRecipeSettings({ enabled: true, autoReplay: 'adapt' }), { enabled: true, autoReplay: 'adapt', selfImprove: false });
	});

	test('recipe rows parse defensively and drop unknown statuses', () => {
		assert.strictEqual(parseMemoryRecipe({ id: 'a', status: 'weird' }), undefined);
		assert.strictEqual(parseMemoryRecipe({ status: 'verified' }), undefined);
		const row = parseMemoryRecipe({ id: 'abc', title: '', status: 'verified', uses: -3, reverted: 2, sourceCheckpointIds: ['c1', 5] });
		assert.deepStrictEqual({ title: row?.title, uses: row?.uses, reverted: row?.reverted, ids: row?.sourceCheckpointIds, scope: row?.scope }, { title: 'abc', uses: 0, reverted: 2, ids: ['c1'], scope: 'project' });
	});

	test('recipe list accepts a wrapped payload or a bare array', () => {
		const row = { id: 'abc', title: 'Add lint', status: 'candidate', uses: 0, sourceCheckpointIds: [] };
		assert.strictEqual(parseMemoryRecipeList([row]).recipes[0]?.title, 'Add lint');
		const wrapped = parseMemoryRecipeList({ recipes: [row], lastCapture: { captured: false, reason: 'no_mutation', at: '2026-01-01T00:00:00.000Z' } });
		assert.strictEqual(wrapped.recipes[0]?.status, 'candidate');
		assert.deepStrictEqual(wrapped.lastCapture, { captured: false, created: false, recipeId: undefined, title: undefined, status: undefined, reason: 'no_mutation', at: '2026-01-01T00:00:00.000Z' });
		const history = parseMemoryRecipeList({
			recipes: [row],
			lastCapture: { captured: false, reason: 'no_oracle' },
			lastCaptures: [
				{ captured: false, reason: 'no_mutation' },
				{ captured: false, reason: 'delete_not_replayable' },
			],
		});
		assert.strictEqual(history.lastCaptures?.length, 2);
		assert.strictEqual(history.lastCaptures?.[1]?.reason, 'delete_not_replayable');
		const withMatch = parseMemoryRecipeList({
			recipes: [row],
			lastMatch: { mode: 'suggest', why: 'similar', title: 'Create Button', score: 0.62, replayable: false },
		});
		assert.deepStrictEqual(memoryRecipeMatchNotice(withMatch.lastMatch!), {
			key: 'memoryRecipeMatchNearMiss',
			params: { title: 'Create Button', percent: '62' },
		});
		assert.deepStrictEqual(memoryRecipeMatchNotice({ mode: 'generate', why: 'no verified recipe matches this task', replayable: false }), { key: 'memoryRecipeMatchNone' });
		assert.strictEqual(parseMemoryRecipeCapture({ captured: true, title: 'X', status: 'verified' })?.captured, true);
		assert.strictEqual(parseMemoryRecipeCapture({ captured: false, reason: 'nope' })?.reason, 'error');
	});

	test('actions follow the host state machine', () => {
		assert.deepStrictEqual(memoryRecipeActions({ status: 'candidate', scope: 'project' }), { quarantine: true, retire: true, preview: false, replay: false, verify: false, restore: false, promoteSkill: false, promoteScope: false, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'candidate', scope: 'project', oracleKind: 'build' }), { quarantine: true, retire: true, preview: false, replay: false, verify: true, restore: false, promoteSkill: false, promoteScope: false, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'verified', scope: 'project' }), { quarantine: true, retire: true, preview: true, replay: true, verify: false, restore: false, promoteSkill: false, promoteScope: false, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'verified', scope: 'project', skillEligible: true }), { quarantine: true, retire: true, preview: true, replay: true, verify: false, restore: false, promoteSkill: true, promoteScope: false, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'verified', scope: 'project', preconditions: [{ kind: 'file_exists', value: 'package.json' }] }), { quarantine: true, retire: true, preview: true, replay: true, verify: false, restore: false, promoteSkill: false, promoteScope: true, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'verified', scope: 'global' }), { quarantine: true, retire: true, preview: true, replay: true, verify: false, restore: false, promoteSkill: false, promoteScope: false, demoteScope: true });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'quarantined', scope: 'project' }), { quarantine: false, retire: true, preview: false, replay: false, verify: false, restore: true, promoteSkill: false, promoteScope: false, demoteScope: false });
		assert.deepStrictEqual(memoryRecipeActions({ status: 'retired', scope: 'project' }), { quarantine: false, retire: false, preview: false, replay: false, verify: false, restore: false, promoteSkill: false, promoteScope: false, demoteScope: false });
	});

	test('inspector parse, search, family grouping, and memory recipe id', () => {
		const row = parseMemoryRecipe({
			id: 'aa'.repeat(32),
			title: 'Create Button',
			status: 'verified',
			scope: 'project',
			uses: 2,
			intentText: 'create a Button component',
			intentFingerprint: 'create button component',
			familyId: 'fam1',
			slots: [{ name: 'componentName', kind: 'identifier', examples: ['Button'] }],
			slotValues: { componentName: 'Button' },
			preconditions: [{ kind: 'file_exists', value: 'package.json' }],
			steps: [{ kind: 'write_file', path: 'src/Button.tsx' }],
			pinned: true,
			notes: 'from lint turn',
		});
		assert.strictEqual(row?.pinned, true);
		assert.strictEqual(row?.slots?.[0].name, 'componentName');
		assert.strictEqual(row?.preconditions?.[0].value, 'package.json');
		const card = parseMemoryRecipe({
			id: 'bb'.repeat(32),
			title: 'Create Card',
			status: 'verified',
			familyId: 'fam1',
			slotValues: { componentName: 'Card' },
			slots: [{ name: 'componentName', kind: 'identifier' }],
			steps: [{ kind: 'write_file', path: 'src/Card.tsx' }],
		});
		const grouped = groupRecipesByFamily([row!, card!]);
		assert.strictEqual(grouped.length, 1);
		assert.strictEqual(grouped[0].recipes.length, 2);
		assert.strictEqual(grouped[0].distinguishingSlot, 'componentName');
		assert.deepStrictEqual(filterAndSortRecipes([row!, card!], { query: 'src/card' }).map(r => r.id), [card!.id]);
		assert.strictEqual(filterAndSortRecipes([row!, card!], { kind: 'slots' }).length, 2);
		assert.strictEqual(parseRecipeIdFromMemory(`Verified recipe\nrecipe_id: ${'aa'.repeat(32)}`), 'aa'.repeat(32));
		assert.strictEqual(parseRecipeIdFromMemory('nope'), undefined);
	});

	test('capture toast keys distinguish saved vs skip', () => {
		assert.deepStrictEqual(memoryRecipeCaptureNotice({ captured: true, title: 'Add lint', status: 'candidate' }), {
			key: 'memoryRecipeCaptured',
			params: { title: 'Add lint', statusKey: 'memoryRecipeStatus_candidate' },
		});
		assert.deepStrictEqual(memoryRecipeCaptureNotice({ captured: false, reason: 'no_oracle' }), { key: 'memoryRecipeSkip_no_oracle' });
		assert.deepStrictEqual(memoryRecipeCaptureNotice({ captured: false, reason: 'delete_not_replayable' }), { key: 'memoryRecipeSkip_delete_not_replayable' });
		assert.deepStrictEqual(memoryRecipeCaptureNotice({ captured: false, reason: 'user_refused' }), { key: 'memoryRecipeSkip_user_refused' });
	});

	test('preview listing becomes highlighted markdown instead of a raw dump', () => {
		const markdown = recipePreviewToMarkdown([
			'This listing is instant; Apply runs the real tool path and the recorded check, which can take seconds.',
			'2 file(s), +260 -0',
			'unchanged .gitignore',
			'create    assets/main.css',
			'conflict  Cargo.toml (cannot merge: no base version or file missing)',
			'command   cargo test 2>&1 | tail -30',
			'',
			'--- /dev/null',
			'+++ b/assets/main.css',
			'@@ -0,0 +1,2 @@',
			'+:root {',
			'+}',
		].join('\n'));
		assert.ok(markdown.startsWith('**2 file(s), +260 -0**'));
		assert.ok(markdown.includes('- `create` `assets/main.css`'));
		assert.ok(markdown.includes('- `conflict` `Cargo.toml` (cannot merge: no base version or file missing)'));
		assert.ok(markdown.includes('```bash\ncargo test 2>&1 | tail -30\n```'));
		assert.ok(markdown.includes('```diff\n--- /dev/null\n+++ b/assets/main.css'));
		assert.ok(!markdown.includes('This listing is instant'));
		assert.strictEqual(recipePreviewToMarkdown('Replay refused: recipe is a candidate'), '**Replay refused: recipe is a candidate**');
		assert.strictEqual(recipePreviewToMarkdown('```diff\n+already\n```'), '```diff\n+already\n```');
		assert.strictEqual(recipePreviewToMarkdown('1 file(s), +12 -0\n--- src/Button.tsx'), '**1 file(s), +12 -0**\n\n```diff\n--- src/Button.tsx\n```');
	});

	test('dashboard metrics: absent stays absent, bad numbers become 0 and the rate is capped', () => {
		assert.strictEqual(parseRecipeMetrics(undefined), undefined);
		assert.deepStrictEqual(parseRecipeMetrics({ attempts: 4, applied: 3, failedVerify: 1, reverted: 'x', llmCallsAvoided: 3, tokensSaved: 900, wrongApplyRate: 7, slotReplays: 2, nearMisses: 1, skips: 3, skipReasons: { no_mutation: 2 }, projectCount: 4, globalCount: 1 }), {
			attempts: 4, applied: 3, failedVerify: 1, reverted: 0, llmCallsAvoided: 3, tokensSaved: 900, wrongApplyRate: 1,
			slotReplays: 2, nearMisses: 1, skips: 3, skipReasons: { no_mutation: 2 }, projectCount: 4, globalCount: 1,
		});
	});
});
