/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Recipes tab (MC-70): verified work Knox can reuse, with its track record and retire / quarantine controls. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { formatMemoryTimeAgo, memoryRecipeActions, memoryRecipeCaptureNotice } from '../../../../common/knoxGuiMemory.js';
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
		const notice = memoryRecipeCaptureNotice(cap);
		const banner = mk(body, 'div', cap.captured ? 'banner is-notice' : 'session-error');
		banner.setAttribute('data-testid', 'memory-recipes-last-capture');
		banner.textContent = notice.params
			? t(state, notice.key, { title: notice.params.title, status: t(state, notice.params.statusKey) })
			: t(state, notice.key);
	}

	const tabDecision = state.recipeDecision;
	if (tabDecision?.source === 'tab' && tabDecision.awaitingChoice && tabDecision.preview && tabDecision.recipe) {
		const card = mk(body, 'div', 'banner is-notice');
		card.setAttribute('role', 'group');
		card.setAttribute('data-testid', 'memory-recipe-preview-card');
		mk(card, 'p', 'sm fw-6', t(state, 'recipePreviewTitle', { title: tabDecision.recipe.title }));
		const latency = mk(card, 'p', 'xs o-60');
		latency.setAttribute('data-testid', 'memory-recipe-preview-latency');
		latency.textContent = t(state, 'recipePreviewLatency');
		mk(card, 'pre', 'mt-1 xs', tabDecision.preview);
		const choice = mk(card, 'div', 'mt-2 flex gap-2');
		memoryButton(widget, choice, {
			tokens: 'pill-btn btn-primary',
			icon: 'check',
			label: t(state, 'recipeApply'),
			testId: 'memory-recipe-preview-apply',
			disabled: Boolean(state.memoryRecipeBusyId),
			onClick: () => widget.controller.answerRecipeChoice('apply'),
		});
		memoryButton(widget, choice, {
			tokens: 'pill-btn is-quiet btn-secondary',
			label: t(state, 'cancel'),
			testId: 'memory-recipe-preview-skip',
			disabled: Boolean(state.memoryRecipeBusyId),
			onClick: () => widget.controller.answerRecipeChoice('skip'),
		});
	} else if (tabDecision?.source === 'tab' && tabDecision.recipe && tabDecision.replay?.status === 'applied' && tabDecision.undoCheckpointId) {
		const done = mk(body, 'div', 'banner is-notice');
		done.setAttribute('role', 'status');
		done.setAttribute('data-testid', 'memory-recipe-replay-notice');
		mk(done, 'span', 'flex-1', t(state, 'recipeReplayApplied', { title: tabDecision.recipe.title, count: tabDecision.replay.appliedPaths.length }));
		memoryButton(widget, done, {
			tokens: 'pill-btn is-quiet btn-secondary',
			icon: 'rotate-ccw',
			label: t(state, 'recipeUndo'),
			testId: 'memory-recipe-undo',
			onClick: () => widget.controller.restoreCheckpoint(tabDecision.undoCheckpointId!),
		});
	} else if (tabDecision?.source === 'tab' && tabDecision.recipe && tabDecision.replay && tabDecision.replay.status !== 'applied') {
		const fail = mk(body, 'div', 'session-error');
		fail.setAttribute('data-testid', 'memory-recipe-replay-error');
		fail.textContent = t(state, 'memoryRecipeReplayFailed', { title: tabDecision.recipe.title, reason: tabDecision.replay.reason ?? 'unknown' });
	}
	if (state.recipeDecision?.skillResult) {
		const skill = mk(body, 'div', 'banner is-notice');
		skill.setAttribute('data-testid', 'memory-recipe-skill-result');
		skill.textContent = state.recipeDecision.skillResult;
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
				icon: 'git-commit',
				label: checkpointId.slice(0, 8),
				title: t(state, 'memoryRecipeCopyCheckpoint'),
				testId: `memory-recipe-checkpoint-${recipe.id}-${checkpointId.slice(0, 8)}`,
				onClick: () => widget.controller.openRecipeCheckpoint(checkpointId),
			});
		}
		if (!recipe.sourceCheckpointIds.length) {
			links.append('-');
		}

		const actions = memoryRecipeActions(recipe);
		if (actions.preview || actions.replay || actions.verify || actions.restore || actions.promoteSkill || actions.quarantine || actions.retire) {
			const buttons = mk(row, 'div', 'mt-2 flex gap-2');
			if (actions.verify) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'check',
					label: t(state, 'memoryRecipeVerify'),
					title: t(state, 'memoryRecipeVerifyHint'),
					disabled: busy,
					testId: `memory-recipe-verify-${recipe.id}`,
					onClick: () => void widget.controller.setMemoryRecipeStatus(recipe.id, 'verified'),
				});
			}
			if (actions.restore) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'rotate-ccw',
					label: t(state, 'memoryRecipeRestore'),
					title: t(state, 'memoryRecipeRestoreHint'),
					disabled: busy,
					testId: `memory-recipe-restore-${recipe.id}`,
					onClick: () => void widget.controller.setMemoryRecipeStatus(recipe.id, 'candidate'),
				});
			}
			if (actions.promoteSkill) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'zap',
					label: t(state, 'recipePromoteProject'),
					disabled: busy,
					testId: `memory-recipe-skill-project-${recipe.id}`,
					onClick: () => widget.controller.promoteRecipeSkill('project', recipe.id),
				});
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'zap',
					label: t(state, 'recipePromoteGlobal'),
					disabled: busy,
					testId: `memory-recipe-skill-global-${recipe.id}`,
					onClick: () => widget.controller.promoteRecipeSkill('global', recipe.id),
				});
			}
			if (actions.preview) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'eye',
					label: t(state, 'memoryRecipePreview'),
					title: t(state, 'memoryRecipePreviewHint'),
					disabled: busy,
					testId: `memory-recipe-preview-${recipe.id}`,
					onClick: () => void widget.controller.previewMemoryRecipe(recipe.id),
				});
			}
			if (actions.replay) {
				memoryButton(widget, buttons, {
					tokens: 'pill-btn is-quiet btn-secondary',
					icon: 'rotate-cw',
					label: t(state, 'memoryRecipeReplay'),
					title: t(state, 'memoryRecipeReplayHint'),
					disabled: busy,
					testId: `memory-recipe-replay-${recipe.id}`,
					onClick: () => void widget.controller.replayMemoryRecipe(recipe.id),
				});
			}
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
