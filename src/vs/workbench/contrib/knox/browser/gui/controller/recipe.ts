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

/** Answer from the preview card buttons (MC-35). Ignored when no card is waiting. */
export function answerRecipeChoice(controller: KnoxGuiController, choice: 'apply' | 'skip'): void {
	controller.recipeChoice?.(choice);
}

/** Stop while the card waits counts as Skip, so the turn can end instead of hanging. */
export function cancelRecipeChoice(controller: KnoxGuiController): void {
	controller.recipeChoice?.('skip');
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

/** MC-42: "Promote to skill". Choosing a destination is the approval; the host never overwrites. */
export async function promoteRecipeSkill(controller: KnoxGuiController, scope: 'project' | 'global'): Promise<void> {
	const decision = controller.store.state.recipeDecision;
	if (!decision?.recipe?.skillEligible || decision.skillResult) {
		return;
	}
	const language = controller.store.state.language;
	let line: string;
	try {
		const out = await controller.messenger.request<{ ok: boolean; path?: string; reason?: string }>('knox/recipePromoteSkill', { recipeId: decision.recipe.id, scope });
		line = out.ok ? knoxGuiT(language, 'recipePromoteSaved', { path: out.path ?? '' }) : knoxGuiT(language, 'recipePromoteFailed', { reason: out.reason ?? 'unknown' });
	} catch (error) {
		line = knoxGuiT(language, 'recipePromoteFailed', { reason: error instanceof Error ? error.message : String(error) });
	}
	const current = controller.store.state.recipeDecision;
	if (current) {
		controller.store.patch({ recipeDecision: { ...current, skillResult: line } });
	}
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
