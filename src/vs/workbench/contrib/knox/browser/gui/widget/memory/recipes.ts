/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Recipes tab (MC-70): verified work Knox can reuse, with its track record and retire / quarantine controls. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { formatMemoryTimeAgo, memoryRecipeActions } from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { mk, svg, memoryButton, memoryConfirmDialog } from './kit.js';

/** Recipe waiting for the retire confirmation, per widget. Retiring is final, so it asks first. */
const retireConfirm = new WeakMap<KnoxGuiWidget, string>();

export function renderMemoryRecipes(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-memory-recipes-view');
	const header = mk(body, 'div', 'kv shrink-0 gap-2');
	const title = mk(header, 'h2', 'flex items-center gap-1_5 sm fw-6');
	svg(title, 'zap', 14, 'teal');
	title.append(t(state, 'memoryRecipesTitle'));
	memoryButton(widget, header, { tokens: 'pill-btn is-quiet btn-secondary', icon: 'refresh-cw', label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemoryRecipes() });
	mk(body, 'p', 'xs o-60 shrink-0', t(state, 'memoryRecipesIntro'));

	if (!state.recipeSettings.enabled) {
		const off = mk(body, 'div', 'session-error');
		off.setAttribute('data-testid', 'memory-recipes-disabled');
		off.textContent = t(state, 'memoryRecipesDisabled');
	}

	if (state.memoryRecipeCapture) {
		const cap = state.memoryRecipeCapture;
		const banner = mk(body, 'div', cap.captured ? 'banner is-notice' : 'session-error');
		banner.setAttribute('data-testid', 'memory-recipes-last-capture');
		if (cap.captured) {
			banner.textContent = t(state, 'memoryRecipeCaptured', {
				title: cap.title || '',
				status: t(state, `memoryRecipeStatus_${cap.status ?? 'candidate'}`),
			});
		} else {
			const key = `memoryRecipeSkip_${cap.reason ?? 'unknown'}`;
			banner.textContent = t(state, key);
		}
	}

	if (state.memoryRecipeError) {
		mk(body, 'div', 'session-error', t(state, state.memoryRecipeError)).setAttribute('data-testid', 'memory-recipes-error');
	}

	const list = mk(body, 'div', 'panel');
	list.setAttribute('data-testid', 'memory-recipes-list');
	mk(list, 'div', 'panel-head shrink-0', t(state, 'memoryRecipesCount', { count: state.memoryRecipes.length }));
	const scroll = mk(list, 'div', 'panel-scroll');
	if (state.memoryRecipesLoading && !state.memoryRecipes.length) {
		svg(mk(scroll, 'div', 'center py-8'), 'loader-2', 20, 'spin o-50');
		return;
	}
	if (!state.memoryRecipes.length) {
		const empty = mk(scroll, 'div', 'px-3 py-4');
		empty.setAttribute('data-testid', 'memory-recipes-empty');
		mk(empty, 'p', 'xs o-50', t(state, 'memoryRecipesEmpty'));
		mk(empty, 'p', 'mt-2 xs o-60', t(state, 'memoryRecipesHowTo'));
		mk(empty, 'p', 'mt-1 xs o-60', t(state, 'memoryRecipesHowToReuse'));
	}

	for (const recipe of state.memoryRecipes) {
		const busy = state.memoryRecipeBusyId === recipe.id;
		const row = mk(scroll, 'div', `detail-card md-card recipe-${recipe.status}`);
		row.setAttribute('data-testid', `memory-recipe-${recipe.id}`);
		const head = mk(row, 'div', 'md-card-head');
		mk(head, 'span', `md-badge recipe-status-${recipe.status}`, t(state, `memoryRecipeStatus_${recipe.status}`));
		mk(head, 'span', 'md-card-title', recipe.title);
		if (recipe.scope === 'global') {
			mk(head, 'span', 'teal-badge ml-1_5 px-1 t-10', t(state, 'memoryRecipeGlobal'));
		}
		const stats = [
			t(state, 'memoryRecipeUses', { count: recipe.uses }),
			t(state, 'memoryRecipeReverts', { count: recipe.reverted }),
			t(state, 'memoryRecipeFailedVerify', { count: recipe.failedVerify }),
			t(state, 'memoryRecipeFiles', { count: recipe.files }),
			t(state, 'memoryRecipeLastUsed', { when: formatMemoryTimeAgo(recipe.lastReplayedAt, (key, vars) => t(state, key, vars)) }),
		];
		mk(row, 'div', 'mt-1 xs o-60', stats.join(' · '));

		const links = mk(row, 'div', 'mt-1 flex flex-wrap items-center gap-1 xs o-60');
		links.append(t(state, 'memoryRecipeSource'));
		for (const checkpointId of recipe.sourceCheckpointIds.slice(0, 3)) {
			memoryButton(widget, links, {
				tokens: 'pill-btn is-quiet btn-secondary',
				icon: 'copy',
				label: checkpointId.slice(0, 8),
				title: t(state, 'memoryRecipeCopyCheckpoint'),
				onClick: () => {
					// The Checkpoint Graph opens focused on this node; the id is also copied for search.
					widget.controller.store.patch({ selectedCheckpointId: checkpointId });
					void widget.controller.messenger.request('copyText', { text: checkpointId });
				},
			});
		}
		if (!recipe.sourceCheckpointIds.length) {
			links.append('-');
		}

		const actions = memoryRecipeActions(recipe.status);
		if (actions.quarantine || actions.retire) {
			const buttons = mk(row, 'div', 'mt-2 flex gap-2');
			if (actions.quarantine) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'alert-triangle',
					label: t(state, 'memoryRecipeQuarantine'),
					title: t(state, 'memoryRecipeQuarantineHint'),
					disabled: busy,
					testId: `memory-recipe-quarantine-${recipe.id}`,
					onClick: () => void widget.controller.setMemoryRecipeStatus(recipe.id, 'quarantined'),
				});
			}
			if (actions.retire) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'trash-2',
					label: t(state, 'memoryRecipeRetire'),
					title: t(state, 'memoryRecipeRetireHint'),
					disabled: busy,
					testId: `memory-recipe-retire-${recipe.id}`,
					onClick: () => {
						retireConfirm.set(widget, recipe.id);
						widget.render();
					},
				});
			}
		}
	}

	const pending = retireConfirm.get(widget);
	const target = pending ? state.memoryRecipes.find(recipe => recipe.id === pending) : undefined;
	if (pending && !target) {
		retireConfirm.delete(widget);
	}
	if (target) {
		const close = () => {
			retireConfirm.delete(widget);
			widget.render();
		};
		memoryConfirmDialog(widget, body, {
			title: t(state, 'memoryRecipeRetireConfirmTitle', { title: target.title }),
			lines: [{ text: t(state, 'memoryRecipeRetireConfirmBody'), tokens: 'xs o-70 mb-3' }],
			cancelLabel: t(state, 'cancel'),
			confirmLabel: t(state, 'memoryRecipeRetire'),
			busy: Boolean(state.memoryRecipeBusyId),
			testId: 'memory-recipe-retire-dialog',
			confirmTestId: 'memory-recipe-confirm-retire',
			onCancel: close,
			onConfirm: () => {
				retireConfirm.delete(widget);
				void widget.controller.setMemoryRecipeStatus(target.id, 'retired');
			},
		});
	}
}
