/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiRecipeDecision, IKnoxGuiRecipeSettings } from '../../../common/knoxGuiState.js';
import { knoxGuiRecipeFailureNote, knoxGuiRecipeNeedsChoice, parseRecipeSettings } from '../../../common/knoxGuiRecipe.js';
import { knoxGuiT } from '../knoxGuiI18n.js';
import type { KnoxGuiController } from '../../knoxGuiController.js';

interface IReplayReply {
	status: 'applied' | 'refused' | 'drifted' | 'failed_verify' | 'failed_apply';
	checkpointId?: string;
	reason?: string;
	appliedPaths: string[];
	failureContext?: string;
}

/** Answer from the preview card buttons (MC-35). Turn-path uses `recipeChoice`; Recipes-tab Preview/Replay (T5) applies here. */
export function answerRecipeChoice(controller: KnoxGuiController, choice: 'apply' | 'skip'): void {
	if (controller.recipeChoice) {
		controller.recipeChoice(choice);
		return;
	}
	if (choice === 'skip') {
		const decision = controller.store.state.recipeDecision;
		if (decision?.source === 'tab' && decision.awaitingChoice) {
			controller.store.patch({ recipeDecision: { ...decision, awaitingChoice: false, preview: undefined } });
		}
		return;
	}
	void applyTabRecipe(controller);
}

/** Stop while the card waits counts as Skip, so the turn can end instead of hanging. */
export function cancelRecipeChoice(controller: KnoxGuiController): void {
	if (controller.recipeChoice) {
		controller.recipeChoice('skip');
		return;
	}
	answerRecipeChoice(controller, 'skip');
}

interface IPreviewReply {
	text?: string;
}

function verifiedRecipeRow(controller: KnoxGuiController, recipeId: string) {
	return controller.store.state.memoryRecipes.find(recipe => recipe.id === recipeId && recipe.status === 'verified');
}

/** Recipes tab Preview: fetch the plan and show the ask card. Nothing is written. */
export async function previewMemoryRecipe(controller: KnoxGuiController, recipeId: string): Promise<void> {
	if (controller.store.state.memoryRecipeBusyId || controller.recipeChoice) {
		return;
	}
	const row = verifiedRecipeRow(controller, recipeId);
	if (!row) {
		return;
	}
	controller.store.patch({ memoryRecipeBusyId: recipeId, memoryRecipeError: undefined });
	try {
		const preview = await controller.messenger.request<IPreviewReply | undefined>('knox/recipePreview', { recipeId });
		if (!preview?.text) {
			controller.store.patch({ memoryRecipeError: 'memoryRecipesActionFailed' });
			return;
		}
		controller.store.patch({
			recipeDecision: {
				mode: 'exact',
				why: '',
				needsConfirmation: true,
				awaitingChoice: true,
				preview: preview.text,
				source: 'tab',
				recipe: { id: row.id, title: row.title, uses: row.uses, reverts: row.reverted, score: 1 },
			},
		});
	} catch {
		controller.store.patch({ memoryRecipeError: 'memoryRecipesActionFailed' });
	} finally {
		controller.store.patch({ memoryRecipeBusyId: undefined });
	}
}

/** Recipes tab Replay: show the ask card, or apply if this recipe is already previewed. */
export async function replayMemoryRecipe(controller: KnoxGuiController, recipeId: string): Promise<void> {
	const decision = controller.store.state.recipeDecision;
	if (decision?.source === 'tab' && decision.awaitingChoice && decision.recipe?.id === recipeId) {
		await applyTabRecipe(controller);
		return;
	}
	await previewMemoryRecipe(controller, recipeId);
}

async function applyTabRecipe(controller: KnoxGuiController): Promise<void> {
	const decision = controller.store.state.recipeDecision;
	if (decision?.source !== 'tab' || !decision.recipe || controller.store.state.memoryRecipeBusyId) {
		return;
	}
	const recipeId = decision.recipe.id;
	controller.store.patch({
		memoryRecipeBusyId: recipeId,
		memoryRecipeError: undefined,
		recipeDecision: { ...decision, awaitingChoice: false, preview: undefined },
	});
	let reply: IReplayReply | undefined;
	try {
		reply = await controller.messenger.request<IReplayReply | undefined>('knox/recipeReplay', { recipeId });
	} catch (error) {
		reply = { status: 'failed_apply', reason: error instanceof Error ? error.message : String(error), appliedPaths: [] };
	}
	controller.store.patch({
		recipeDecision: {
			...decision,
			source: 'tab',
			awaitingChoice: false,
			preview: undefined,
			undoCheckpointId: reply?.status === 'applied' ? reply.checkpointId : undefined,
			replay: {
				status: reply?.status ?? 'failed_apply',
				appliedPaths: reply?.appliedPaths ?? [],
				reason: reply?.reason,
			},
		},
		memoryRecipeBusyId: undefined,
	});
	if (reply?.status === 'applied') {
		void controller.loadMemoryRecipes();
	}
}

function appendToAssistant(controller: KnoxGuiController, text: string): void {
	const history = controller.store.state.history.slice();
	const index = history.length - 1;
	const last = history[index];
	if (last?.role === 'assistant') {
		history[index] = { ...last, content: last.content ? `${last.content}\n\n${text}` : text };
		controller.store.patch({ history });
	}
}

/**
 * After `knox/startTurn`: either the recipe was already applied by the host (autoReplay = exact),
 * or the user is asked first (autoReplay = ask). Returns `done` when the turn is finished
 * without a model call, `continue` to run the model as usual (a failure note goes into its context).
 */
export async function resolveRecipeDecision(controller: KnoxGuiController): Promise<'done' | 'continue'> {
	const language = controller.store.state.language;
	let decision = controller.store.state.recipeDecision;
	if (!decision?.recipe) {
		return 'continue';
	}
	const title = decision.recipe.title;

	if (decision.replay?.status === 'applied') {
		appendToAssistant(controller, knoxGuiT(language, 'recipeReplayApplied', { title, count: decision.replay.appliedPaths.length }));
		return 'done';
	}

	if (knoxGuiRecipeNeedsChoice(decision)) {
		controller.store.patch({ isGatheringContext: false, recipeDecision: { ...decision, awaitingChoice: true } });
		const choice = await new Promise<'apply' | 'skip'>(resolve => {
			controller.recipeChoice = resolve;
		});
		controller.recipeChoice = undefined;
		decision = controller.store.state.recipeDecision as IKnoxGuiRecipeDecision;
		controller.store.patch({ recipeDecision: { ...decision, awaitingChoice: false, preview: undefined } });
		if (choice === 'skip' || controller.turnAborted) {
			return 'continue';
		}
		let reply: IReplayReply | undefined;
		try {
			reply = await controller.messenger.request<IReplayReply | undefined>('knox/recipeReplay', { recipeId: decision.recipe!.id });
		} catch (error) {
			reply = { status: 'failed_apply', reason: error instanceof Error ? error.message : String(error), appliedPaths: [] };
		}
		if (reply?.status === 'applied') {
			controller.store.patch({
				recipeDecision: { ...decision, awaitingChoice: false, preview: undefined, undoCheckpointId: reply.checkpointId, replay: { status: 'applied', appliedPaths: reply.appliedPaths } },
			});
			appendToAssistant(controller, knoxGuiT(language, 'recipeReplayApplied', { title, count: reply.appliedPaths.length }));
			return 'done';
		}
		const reason = reply?.reason ?? 'unknown';
		appendToAssistant(controller, knoxGuiT(language, 'recipeReplayFailed', { title, reason }));
		const note = reply?.failureContext || knoxGuiRecipeFailureNote(reason);
		controller.turnRecipeHint = [note, controller.turnRecipeHint].filter(Boolean).join('\n\n');
	}
	return 'continue';
}

/** MC-42 / T13: "Promote to skill" from the chat notice or the Recipes tab. Choosing a destination is the approval; the host never overwrites. */
export async function promoteRecipeSkill(controller: KnoxGuiController, scope: 'project' | 'global', recipeId?: string): Promise<void> {
	const row = recipeId ? controller.store.state.memoryRecipes.find(recipe => recipe.id === recipeId) : undefined;
	const decision = controller.store.state.recipeDecision;
	const id = row?.id ?? decision?.recipe?.id;
	const eligible = row ? row.skillEligible === true : Boolean(decision?.recipe?.skillEligible && !decision.skillResult);
	if (!id || !eligible) {
		return;
	}
	const language = controller.store.state.language;
	let line: string;
	try {
		const out = await controller.messenger.request<{ ok: boolean; path?: string; reason?: string }>('knox/recipePromoteSkill', { recipeId: id, scope });
		line = out.ok ? knoxGuiT(language, 'recipePromoteSaved', { path: out.path ?? '' }) : knoxGuiT(language, 'recipePromoteFailed', { reason: out.reason ?? 'unknown' });
	} catch (error) {
		line = knoxGuiT(language, 'recipePromoteFailed', { reason: error instanceof Error ? error.message : String(error) });
	}
	const current = controller.store.state.recipeDecision;
	const recipe = row
		? { id: row.id, title: row.title, uses: row.uses, reverts: row.reverted, score: 1, skillEligible: true }
		: current?.recipe ?? decision?.recipe;
	controller.store.patch({
		recipeDecision: {
			mode: 'exact',
			why: '',
			needsConfirmation: false,
			...current,
			recipe,
			skillResult: line,
		},
	});
}

/** MC-72: current host values; a failed read keeps what the UI has (all off by default). */
export async function loadRecipeSettings(controller: KnoxGuiController): Promise<void> {
	try {
		controller.store.patch({ recipeSettings: parseRecipeSettings(await controller.messenger.request<unknown>('knox/recipeSettings', undefined)) });
	} catch {
		// optional: older host
	}
}

/** MC-72: optimistic update, then the host's answer is the truth (it validates the values). */
export async function setRecipeSettings(controller: KnoxGuiController, patch: Partial<IKnoxGuiRecipeSettings>): Promise<void> {
	const before = controller.store.state.recipeSettings;
	controller.store.patch({ recipeSettings: { ...before, ...patch } });
	try {
		controller.store.patch({ recipeSettings: parseRecipeSettings(await controller.messenger.request<unknown>('knox/recipeSettingsSet', patch)) });
	} catch {
		controller.store.patch({ recipeSettings: before });
	}
}
