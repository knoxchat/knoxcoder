/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiRecipeDecision, IKnoxGuiRecipeSettings } from './knoxGuiState.js';

/** MC-72: host reply -> settings, with anything unexpected falling back to the safe (off) value. */
export function parseRecipeSettings(raw: unknown): IKnoxGuiRecipeSettings {
	const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		enabled: rec.enabled === true,
		autoReplay: rec.autoReplay === 'ask' || rec.autoReplay === 'exact' ? rec.autoReplay : 'off',
		selfImprove: rec.selfImprove === true,
	};
}

export interface IKnoxGuiRecipeNotice {
	/** i18n key in `gui/i18n/{en,zh}/chat.ts`. */
	key: 'recipeDecisionExact' | 'recipeDecisionAdapt' | 'recipeDecisionSuggest';
	params: { title: string; uses: number; reverts: number };
	/** Undo needs a pre-replay checkpoint, which only exists once a replay applied files. */
	undoCheckpointId?: string;
}

/** MC-25: the chat line for a recipe decision. Undefined for `generate` (nothing to explain). */
export function knoxGuiRecipeNotice(decision: IKnoxGuiRecipeDecision | undefined): IKnoxGuiRecipeNotice | undefined {
	if (!decision?.recipe || decision.mode === 'generate') {
		return undefined;
	}
	const key = decision.mode === 'exact' ? 'recipeDecisionExact' : decision.mode === 'adapt' ? 'recipeDecisionAdapt' : 'recipeDecisionSuggest';
	const { title, uses, reverts } = decision.recipe;
	return {
		key,
		params: { title, uses, reverts },
		undoCheckpointId: decision.mode === 'suggest' ? undefined : decision.undoCheckpointId,
	};
}

/** MC-35 / MC-32: `exact` (ask) or `adapt` with a preview the user has not answered yet. */
export function knoxGuiRecipeNeedsChoice(decision: IKnoxGuiRecipeDecision | undefined): boolean {
	return Boolean(decision?.recipe && (decision.mode === 'exact' || decision.mode === 'adapt') && decision.needsConfirmation && decision.preview && !decision.replay);
}

/** Context for the model when the user approved a replay and it did not land. */
export function knoxGuiRecipeFailureNote(reason: string): string {
	return `A saved recipe was tried first and did not apply. Reason: ${reason}\nNo files were changed by it.`;
}
