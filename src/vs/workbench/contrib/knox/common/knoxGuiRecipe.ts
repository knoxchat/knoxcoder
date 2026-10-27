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
		autoReplay: rec.autoReplay === 'ask' || rec.autoReplay === 'exact' || rec.autoReplay === 'adapt' ? rec.autoReplay : 'off',
		selfImprove: rec.selfImprove === true,
	};
}

export interface IKnoxGuiRecipeNotice {
	/** i18n key in `gui/i18n/{en,zh}/chat.ts`. */
	key: 'recipeDecisionExact' | 'recipeDecisionAdapt' | 'recipeDecisionSuggest' | 'recipeDecisionPreviewed' | 'recipeDecisionSkipped' | 'recipeDecisionSkippedNear';
	params: { title: string; uses: number; reverts: number };
	/** Undo needs a pre-replay checkpoint, which only exists once a replay applied files. */
	undoCheckpointId?: string;
	/** Adapt `what-if/*` branch, when one was forked. */
	whatIfBranch?: string;
}

const LAST_RECIPE_DECISION_MARKER = 'Last recipe decision';

/** Compact line compaction re-injects so the next turn still sees recipe id + title. */
export function knoxGuiRecipeLoopLine(decision: IKnoxGuiRecipeDecision | undefined): string | undefined {
	if (!decision) {
		return undefined;
	}
	const title = (decision.recipe?.title ?? decision.matches?.[0]?.title ?? '').replace(/"/g, '');
	const id = decision.recipe?.id ?? decision.matches?.[0]?.id;
	const verb = decision.awaitingChoice
		? 'previewed'
		: decision.mode === 'exact'
			? 'reused'
			: decision.mode === 'adapt'
				? 'adapted'
				: decision.mode === 'suggest'
					? 'hinted'
					: 'skipped';
	const body = title ? `${verb} "${title}"${id ? ` id=${id}` : ''}` : `${verb}${id ? ` id=${id}` : ''}`;
	return `${LAST_RECIPE_DECISION_MARKER}: ${body}`;
}

/** P6.5: a compact card for reused / previewed / hinted / skipped. */
export function knoxGuiRecipeNotice(decision: IKnoxGuiRecipeDecision | undefined): IKnoxGuiRecipeNotice | undefined {
	if (!decision) {
		return undefined;
	}
	if (decision.mode === 'generate') {
		const near = decision.recipe ?? (decision.matches?.[0] ? { title: decision.matches[0].title, uses: 0, reverts: 0 } : undefined);
		if (near) {
			return { key: 'recipeDecisionSkippedNear', params: { title: near.title, uses: near.uses, reverts: near.reverts } };
		}
		return { key: 'recipeDecisionSkipped', params: { title: '', uses: 0, reverts: 0 } };
	}
	if (!decision.recipe) {
		return undefined;
	}
	const key = decision.awaitingChoice
		? 'recipeDecisionPreviewed'
		: decision.mode === 'exact'
			? 'recipeDecisionExact'
			: decision.mode === 'adapt'
				? 'recipeDecisionAdapt'
				: 'recipeDecisionSuggest';
	const { title, uses, reverts } = decision.recipe;
	return {
		key,
		params: { title, uses, reverts },
		undoCheckpointId: decision.mode === 'suggest' ? undefined : decision.undoCheckpointId,
		whatIfBranch: decision.mode === 'suggest' ? undefined : decision.whatIfBranch,
	};
}

/** Every slot has a value so Apply can run parameterized exact. */
export function knoxGuiRecipeSlotsReady(decision: IKnoxGuiRecipeDecision | undefined): boolean {
	if (!decision?.slots?.length) {
		return true;
	}
	return decision.slots.every(slot => Boolean(slot.value?.trim()));
}

function slotValuesFromDecision(decision: IKnoxGuiRecipeDecision | undefined): Record<string, string> | undefined {
	if (!decision?.slots?.length) {
		return undefined;
	}
	const values: Record<string, string> = {};
	for (const slot of decision.slots) {
		if (slot.value?.trim()) {
			values[slot.name] = slot.value.trim();
		}
	}
	return Object.keys(values).length ? values : undefined;
}

export { slotValuesFromDecision };

export function recipeApplyPayload(decision: IKnoxGuiRecipeDecision | undefined): {
	slotValues?: Record<string, string>;
	includePaths?: string[];
	approvedExtraPaths?: string[];
	composeIds?: string[];
} {
	const includePaths = decision?.files?.length
		? decision.files.filter(file => file.included && !file.extra).map(file => file.path)
		: undefined;
	const approvedExtraPaths = decision?.files
		? decision.files.filter(file => file.included && file.extra).map(file => file.path)
		: undefined;
	const composeIds = decision?.compose && decision.compose.recipes.length > 1
		? decision.compose.recipes.map(recipe => recipe.id)
		: undefined;
	return {
		slotValues: slotValuesFromDecision(decision),
		includePaths,
		approvedExtraPaths: approvedExtraPaths?.length ? approvedExtraPaths : undefined,
		composeIds,
	};
}

/** MC-35 / MC-32: `exact` (ask) or `adapt` with a preview the user has not answered yet. */
export function knoxGuiRecipeNeedsChoice(decision: IKnoxGuiRecipeDecision | undefined): boolean {
	const waiting = Boolean(decision?.recipe && (decision.mode === 'exact' || decision.mode === 'adapt') && decision.needsConfirmation && !decision.replay);
	if (!waiting) {
		return false;
	}
	return Boolean(decision?.preview) || Boolean(decision?.slots?.length) || Boolean(decision?.files?.length) || Boolean(decision?.compose);
}

/** Context for the model when the user approved a replay and it did not land. */
export function knoxGuiRecipeFailureNote(reason: string): string {
	return `A saved recipe was tried first and did not apply. Reason: ${reason}\nNo files were changed by it.`;
}
