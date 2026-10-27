/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Recipes tab (MC-70 / P5): inspector for verified work — detail, search, pin, promote. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import {
	filterAndSortRecipes,
	formatMemoryTimeAgo,
	groupRecipesByFamily,
	memoryRecipeActions,
	memoryRecipeCaptureNotice,
	memoryRecipeMatchNotice,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiMemoryRecipe, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { mk, svg, memoryButton, memoryConfirmDialog } from './kit.js';

/** Recipe waiting for the retire confirmation, per widget. Retiring is final, so it asks first. */
const retireConfirm = new WeakMap<KnoxGuiWidget, string>();

const SLOT_KINDS = ['identifier', 'path', 'package', 'text'] as const;
const USER_PRE_KINDS = ['file_exists', 'file_absent', 'dependency'] as const;

export function renderMemoryRecipes(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-memory-recipes-view');
	const header = mk(body, 'div', 'kv shrink-0 gap-2');
	const title = mk(header, 'h2', 'flex items-center gap-1_5 sm fw-6');
	svg(title, 'zap', 14, 'teal');
	title.append(t(state, 'memoryRecipesTitle'));
	memoryButton(widget, header, { tokens: 'pill-btn is-quiet btn-secondary', icon: 'refresh-cw', label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemoryRecipes() });
	if (state.recipeSettings.enabled) {
		memoryButton(widget, header, {
			tokens: 'pill-btn is-quiet btn-secondary',
			icon: 'plus',
			label: t(state, 'memoryRecipeSave'),
			title: t(state, 'memoryRecipeSaveHint'),
			testId: 'memory-recipes-save',
			disabled: Boolean(state.memoryRecipeBusyId),
			onClick: () => void widget.controller.saveMemoryRecipe(),
		});
	}
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
		const earlierSkips = (state.memoryRecipeCaptures ?? []).filter(item => !item.captured).length - (cap.captured ? 0 : 1);
		if (earlierSkips > 0) {
			const extra = mk(body, 'p', 'xs o-60 shrink-0');
			extra.setAttribute('data-testid', 'memory-recipes-earlier-skips');
			extra.textContent = t(state, 'memoryRecipesEarlierSkips', { count: earlierSkips });
		}
		if (cap.captured) {
			const refuse = mk(body, 'div', 'mt-1');
			memoryButton(widget, refuse, {
				tokens: 'pill-btn is-quiet btn-secondary',
				label: t(state, 'memoryRecipeRefuse'),
				title: t(state, 'memoryRecipeRefuseHint'),
				testId: 'memory-recipes-refuse',
				disabled: Boolean(state.memoryRecipeBusyId),
				onClick: () => void widget.controller.refuseMemoryRecipe(),
			});
		}
	}

	if (state.memoryRecipeLastMatch && (state.memoryRecipeLastMatch.mode === 'generate' || !state.memoryRecipeLastMatch.replayable)) {
		const notice = memoryRecipeMatchNotice(state.memoryRecipeLastMatch);
		const banner = mk(body, 'p', 'xs o-60 shrink-0');
		banner.setAttribute('data-testid', 'memory-recipes-last-match');
		banner.textContent = notice.params
			? t(state, notice.key, { title: notice.params.title, percent: notice.params.percent })
			: t(state, notice.key);
	}

	renderTabPreview(widget, body, state);

	if (state.memoryRecipeError) {
		mk(body, 'div', 'session-error', t(state, state.memoryRecipeError)).setAttribute('data-testid', 'memory-recipes-error');
	}

	renderSearchFilters(widget, body, state);

	const filtered = filterAndSortRecipes(state.memoryRecipes, {
		query: widget.recipeSearchDraft || state.memoryRecipeQuery,
		status: state.memoryRecipeFilterStatus,
		scope: state.memoryRecipeFilterScope,
		oracle: state.memoryRecipeFilterOracle,
		kind: state.memoryRecipeFilterKind,
		sortBy: state.memoryRecipeSortBy,
	});
	const families = groupRecipesByFamily(filtered);

	const list = mk(body, 'div', 'panel');
	list.setAttribute('data-testid', 'memory-recipes-list');
	mk(list, 'div', 'panel-head shrink-0', t(state, 'memoryRecipesCount', { count: filtered.length }));
	const scroll = mk(list, 'div', 'panel-scroll');
	if (state.memoryRecipesLoading && !state.memoryRecipes.length) {
		svg(mk(scroll, 'div', 'center py-8'), 'loader-2', 20, 'spin o-50');
		return;
	}
	if (!filtered.length) {
		const empty = mk(scroll, 'div', 'px-3 py-4');
		empty.setAttribute('data-testid', 'memory-recipes-empty');
		mk(empty, 'p', 'xs o-50', t(state, 'memoryRecipesEmpty'));
		mk(empty, 'p', 'mt-2 xs o-60', t(state, 'memoryRecipesHowTo'));
		mk(empty, 'p', 'mt-1 xs o-60', t(state, 'memoryRecipesHowToReuse'));
	}

	for (const family of families) {
		if (family.recipes.length > 1) {
			const head = mk(scroll, 'div', 'px-3 pt-2 xs o-60 fw-6');
			head.setAttribute('data-testid', `memory-recipe-family-${family.familyId.slice(0, 8)}`);
			head.textContent = `${family.title} · ${t(state, 'memoryRecipeFamily', { count: family.recipes.length })}`;
		}
		for (const recipe of family.recipes) {
			renderRecipeRow(widget, scroll, state, recipe, family.recipes.length > 1 ? family.distinguishingSlot : undefined);
		}
	}

	renderDialogs(widget, body, state);
}

function renderSearchFilters(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const searchWrap = mk(body, 'div', 'search knox-gui-memory-search');
	const input = mk(searchWrap, 'input', 'field search-input') as HTMLInputElement;
	input.type = 'text';
	input.placeholder = t(state, 'memoryRecipeSearchPlaceholder');
	input.value = widget.recipeSearchDraft || state.memoryRecipeQuery;
	input.setAttribute('data-testid', 'memory-recipes-search');
	svg(searchWrap, 'search', 14, 'search-icon o-50');
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.recipeSearchDraft = input.value;
		if (widget.recipeSearchTimer) {
			clearTimeout(widget.recipeSearchTimer);
		}
		widget.recipeSearchTimer = setTimeout(() => {
			widget.controller.store.patch({ memoryRecipeQuery: widget.recipeSearchDraft });
		}, 200);
	}));

	const filters = mk(body, 'div', 'flex flex-wrap items-center gap-2 xs mt-2');
	const filterSelect = (testId: string, options: ReadonlyArray<readonly [string, string]>, current: string, onChange: (value: string) => void) => {
		const select = mk(filters, 'select', 'dropdown') as HTMLSelectElement;
		select.setAttribute('data-testid', testId);
		for (const [value, label] of options) {
			const el = mk(select, 'option', '', label) as HTMLOptionElement;
			el.value = value;
			el.selected = value === current;
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => onChange(select.value)));
	};
	filterSelect('memory-recipes-filter-status', [
		['all', t(state, 'memoryRecipeAllStatuses')],
		['candidate', t(state, 'memoryRecipeStatus_candidate')],
		['verified', t(state, 'memoryRecipeStatus_verified')],
		['quarantined', t(state, 'memoryRecipeStatus_quarantined')],
		['retired', t(state, 'memoryRecipeStatus_retired')],
	], state.memoryRecipeFilterStatus, value => widget.controller.store.patch({ memoryRecipeFilterStatus: value as IKnoxGuiState['memoryRecipeFilterStatus'] }));
	filterSelect('memory-recipes-filter-scope', [
		['all', t(state, 'memoryRecipeAllScopes')],
		['project', t(state, 'memoryRecipeScopeProject')],
		['global', t(state, 'memoryRecipeGlobal')],
	], state.memoryRecipeFilterScope, value => widget.controller.store.patch({ memoryRecipeFilterScope: value as IKnoxGuiState['memoryRecipeFilterScope'] }));
	filterSelect('memory-recipes-filter-oracle', [
		['all', t(state, 'memoryRecipeAllOracles')],
		['build', t(state, 'memoryRecipeOracle_build')],
		['test', t(state, 'memoryRecipeOracle_test')],
		['lsp', t(state, 'memoryRecipeOracle_lsp')],
		['user', t(state, 'memoryRecipeOracle_user')],
	], state.memoryRecipeFilterOracle, value => widget.controller.store.patch({ memoryRecipeFilterOracle: value as IKnoxGuiState['memoryRecipeFilterOracle'] }));
	filterSelect('memory-recipes-filter-kind', [
		['all', t(state, 'memoryRecipeAllKinds')],
		['slots', t(state, 'memoryRecipeKindSlots')],
		['skill', t(state, 'memoryRecipeKindSkill')],
	], state.memoryRecipeFilterKind, value => widget.controller.store.patch({ memoryRecipeFilterKind: value as IKnoxGuiState['memoryRecipeFilterKind'] }));
	filterSelect('memory-recipes-sort', [
		['recent', t(state, 'memoryRecipeSortRecent')],
		['uses', t(state, 'memoryRecipeSortUses')],
		['score', t(state, 'memoryRecipeSortScore')],
	], state.memoryRecipeSortBy, value => widget.controller.store.patch({ memoryRecipeSortBy: value as IKnoxGuiState['memoryRecipeSortBy'] }));
}

function renderRecipeRow(widget: KnoxGuiWidget, scroll: HTMLElement, state: IKnoxGuiState, recipe: IKnoxGuiMemoryRecipe, distinguishingSlot?: string): void {
	const busy = state.memoryRecipeBusyId === recipe.id;
	const selected = state.memorySelectedRecipeId === recipe.id;
	const row = mk(scroll, 'div', `detail-card md-card recipe-${recipe.status}${selected ? ' selected' : ''}`);
	row.setAttribute('data-testid', `memory-recipe-${recipe.id}`);
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
		if ((e.target as HTMLElement).closest('button, input, textarea, select, label')) {
			return;
		}
		widget.controller.selectMemoryRecipe(recipe.id);
	}));
	const head = mk(row, 'div', 'md-card-head');
	mk(head, 'span', `md-badge recipe-status-${recipe.status}`, t(state, `memoryRecipeStatus_${recipe.status}`));
	if (recipe.pinned) {
		svg(head, 'pin', 11, 'teal');
	}
	const title = mk(head, 'span', 'md-card-title', recipe.title);
	if (distinguishingSlot && recipe.slotValues?.[distinguishingSlot]) {
		mk(head, 'span', 'teal-badge ml-1_5 px-1 t-10', t(state, 'memoryRecipeVariant', { slot: distinguishingSlot, value: recipe.slotValues[distinguishingSlot] }));
	}
	if (recipe.scope === 'global') {
		mk(head, 'span', 'teal-badge ml-1_5 px-1 t-10', t(state, 'memoryRecipeGlobal'));
	}
	title.setAttribute('data-testid', `memory-recipe-title-${recipe.id}`);
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

	renderRecipeActions(widget, row, state, recipe, busy);
	if (selected) {
		renderRecipeDetail(widget, row, state, recipe, busy);
	}
}

function renderRecipeActions(widget: KnoxGuiWidget, row: HTMLElement, state: IKnoxGuiState, recipe: IKnoxGuiMemoryRecipe, busy: boolean): void {
	const actions = memoryRecipeActions(recipe);
	const buttons = mk(row, 'div', 'mt-2 flex flex-wrap gap-2');
	if (recipe.status !== 'retired') {
		memoryButton(widget, buttons, {
			tokens: 'pill-btn is-quiet btn-secondary',
			icon: recipe.pinned ? 'pin-off' : 'pin',
			label: t(state, recipe.pinned ? 'memoryRecipeUnpin' : 'memoryRecipePin'),
			disabled: busy,
			testId: `memory-recipe-pin-${recipe.id}`,
			onClick: () => void widget.controller.patchMemoryRecipe({ recipeId: recipe.id, pinned: !recipe.pinned }),
		});
	}
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
	if (actions.promoteScope) {
		memoryButton(widget, buttons, {
			tokens: 'pill-btn is-quiet btn-secondary',
			label: t(state, 'memoryRecipePromoteScope'),
			title: t(state, 'memoryRecipePromoteScopeHint', { checks: (recipe.preconditions ?? []).map(p => `${p.kind} ${p.value}`).join(', ') }),
			disabled: busy,
			testId: `memory-recipe-promote-scope-${recipe.id}`,
			onClick: () => {
				widget.recipePromoteId = recipe.id;
				widget.recipePromoteConsent = false;
				widget.render();
			},
		});
	} else if (recipe.status === 'verified' && recipe.scope !== 'global') {
		memoryButton(widget, buttons, {
			tokens: 'pill-btn is-quiet btn-secondary',
			label: t(state, 'memoryRecipePromoteScope'),
			title: t(state, 'memoryRecipeNeedsPrecondition'),
			disabled: true,
			testId: `memory-recipe-promote-scope-${recipe.id}`,
			onClick: () => undefined,
		});
	}
	if (actions.demoteScope) {
		memoryButton(widget, buttons, {
			tokens: 'pill-btn is-quiet btn-secondary',
			label: t(state, 'memoryRecipeDemoteScope'),
			disabled: busy,
			testId: `memory-recipe-demote-scope-${recipe.id}`,
			onClick: () => void widget.controller.patchMemoryRecipe({ recipeId: recipe.id, scope: 'project' }),
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

function renderRecipeDetail(widget: KnoxGuiWidget, row: HTMLElement, state: IKnoxGuiState, recipe: IKnoxGuiMemoryRecipe, busy: boolean): void {
	const detail = mk(row, 'div', 'divided mt-2 pt-2 sy-2');
	detail.setAttribute('data-testid', `memory-recipe-detail-${recipe.id}`);

	const titleLabel = mk(detail, 'label', 'block xs o-60', t(state, 'memoryRecipeRename'));
	const titleInput = document.createElement('input');
	titleInput.type = 'text';
	titleInput.value = recipe.title;
	titleInput.className = 'knox-gui-memory-field';
	titleInput.setAttribute('data-testid', `memory-recipe-title-input-${recipe.id}`);
	titleLabel.appendChild(titleInput);

	if (recipe.intentText) {
		mk(detail, 'p', 'xs o-60', `${t(state, 'memoryRecipeIntent')}: ${recipe.intentText}`).setAttribute('data-testid', `memory-recipe-intent-${recipe.id}`);
	}
	if (recipe.intentFingerprint) {
		mk(detail, 'p', 'xs o-50', `${t(state, 'memoryRecipeFingerprint')}: ${recipe.intentFingerprint}`).setAttribute('data-testid', `memory-recipe-fingerprint-${recipe.id}`);
	}

	const notesLabel = mk(detail, 'label', 'block xs o-60 mt-1', t(state, 'memoryRecipeNotes'));
	notesLabel.title = t(state, 'memoryRecipeNotesHint');
	const notesInput = document.createElement('textarea');
	notesInput.value = recipe.notes ?? '';
	notesInput.rows = 2;
	notesInput.className = 'knox-gui-memory-field';
	notesInput.setAttribute('data-testid', `memory-recipe-notes-input-${recipe.id}`);
	notesLabel.appendChild(notesInput);

	const slotsBox = mk(detail, 'div', 'mt-1');
	mk(slotsBox, 'p', 'xs o-60', t(state, 'memoryRecipeSlots'));
	slotsBox.setAttribute('data-testid', `memory-recipe-slots-${recipe.id}`);
	for (const slot of recipe.slots ?? []) {
		const line = mk(slotsBox, 'p', 'xs');
		const examples = slot.examples?.length ? t(state, 'memoryRecipeSlotExamples', { examples: slot.examples.join(', ') }) : '';
		const captured = recipe.slotValues?.[slot.name] ? ` = ${recipe.slotValues[slot.name]}` : '';
		line.textContent = `${slot.name} (${t(state, `memoryRecipeSlotKind_${slot.kind}`)})${captured}${examples ? ` · ${examples}` : ''}`;
	}
	const addSlot = mk(slotsBox, 'div', 'flex flex-wrap gap-1 mt-1');
	const slotName = document.createElement('input');
	slotName.type = 'text';
	slotName.placeholder = 'componentName';
	slotName.setAttribute('data-testid', `memory-recipe-slot-name-${recipe.id}`);
	addSlot.appendChild(slotName);
	const slotKind = document.createElement('select');
	slotKind.setAttribute('data-testid', `memory-recipe-slot-kind-${recipe.id}`);
	for (const kind of SLOT_KINDS) {
		const opt = document.createElement('option');
		opt.value = kind;
		opt.textContent = t(state, `memoryRecipeSlotKind_${kind}`);
		slotKind.appendChild(opt);
	}
	addSlot.appendChild(slotKind);

	const presBox = mk(detail, 'div', 'mt-1');
	mk(presBox, 'p', 'xs o-60', t(state, 'memoryRecipePreconditions'));
	presBox.setAttribute('data-testid', `memory-recipe-preconditions-${recipe.id}`);
	for (const pre of recipe.preconditions ?? []) {
		mk(presBox, 'p', 'xs', `${t(state, `memoryRecipePreKind_${pre.kind}`)}: ${pre.value}`);
	}
	const addPre = mk(presBox, 'div', 'flex flex-wrap gap-1 mt-1');
	const preKind = document.createElement('select');
	preKind.setAttribute('data-testid', `memory-recipe-pre-kind-${recipe.id}`);
	for (const kind of USER_PRE_KINDS) {
		const opt = document.createElement('option');
		opt.value = kind;
		opt.textContent = t(state, `memoryRecipePreKind_${kind}`);
		preKind.appendChild(opt);
	}
	addPre.appendChild(preKind);
	const preValue = document.createElement('input');
	preValue.type = 'text';
	preValue.placeholder = 'src/Button.tsx';
	preValue.setAttribute('data-testid', `memory-recipe-pre-value-${recipe.id}`);
	addPre.appendChild(preValue);

	if (recipe.steps?.length) {
		const steps = mk(detail, 'div', 'mt-1');
		mk(steps, 'p', 'xs o-60', t(state, 'memoryRecipeSteps'));
		steps.setAttribute('data-testid', `memory-recipe-steps-${recipe.id}`);
		for (const step of recipe.steps) {
			const label = t(state, `memoryRecipeStep_${step.kind}`);
			mk(steps, 'p', 'xs', step.kind === 'command' ? `${label}: ${step.command ?? ''}` : `${label} ${step.path ?? ''}`);
		}
	}
	if (recipe.oracleKind) {
		mk(detail, 'p', 'xs o-60 mt-1', `${t(state, 'memoryRecipeOracle')}: ${t(state, `memoryRecipeOracle_${recipe.oracleKind}`)}${recipe.oracleCommand ? ` (${recipe.oracleCommand})` : ''}`);
	}

	if (typeof recipe.memoryId === 'number') {
		const mem = mk(detail, 'div', 'mt-1');
		memoryButton(widget, mem, {
			tokens: 'pill-btn is-quiet btn-secondary',
			label: t(state, 'memoryRecipeOpenMemory'),
			testId: `memory-recipe-open-memory-${recipe.id}`,
			onClick: () => widget.controller.openRecipeMemory(recipe),
		});
	}

	const preview = mk(detail, 'div', 'mt-2');
	mk(preview, 'p', 'xs o-60', t(state, 'memoryRecipePreviewInline'));
	if (state.memoryRecipePreviewLoading && state.memorySelectedRecipeId === recipe.id) {
		mk(preview, 'p', 'xs o-50', t(state, 'memoryRecipePreviewLoading')).setAttribute('data-testid', 'memory-recipe-inline-preview-loading');
	} else if (state.memoryRecipePreview && state.memorySelectedRecipeId === recipe.id) {
		mk(preview, 'pre', 'mt-1 xs', state.memoryRecipePreview).setAttribute('data-testid', 'memory-recipe-inline-preview');
	} else {
		mk(preview, 'p', 'xs o-50', t(state, 'memoryRecipeNoPreview'));
	}

	if (recipe.status !== 'retired') {
		memoryButton(widget, detail, {
			tokens: 'pill-btn btn-primary mt-2',
			label: t(state, 'memoryRecipeSaveEdits'),
			disabled: busy,
			testId: `memory-recipe-save-edits-${recipe.id}`,
			onClick: () => void saveRecipeEdits(widget, recipe, detail),
		});
	}

	if (state.memoryRecipeLastMatch?.title === recipe.title && !state.memoryRecipeLastMatch.replayable) {
		const notice = memoryRecipeMatchNotice(state.memoryRecipeLastMatch);
		mk(detail, 'p', 'xs o-60 mt-1', notice.params
			? t(state, notice.key, { title: notice.params.title, percent: notice.params.percent })
			: t(state, notice.key));
	}
}

async function saveRecipeEdits(widget: KnoxGuiWidget, recipe: IKnoxGuiMemoryRecipe, root: ParentNode): Promise<void> {
	const titleEl = root.querySelector(`[data-testid="memory-recipe-title-input-${recipe.id}"]`) as HTMLInputElement | null;
	const notesEl = root.querySelector(`[data-testid="memory-recipe-notes-input-${recipe.id}"]`) as HTMLTextAreaElement | null;
	const slotName = (root.querySelector(`[data-testid="memory-recipe-slot-name-${recipe.id}"]`) as HTMLInputElement | null)?.value.trim();
	const slotKind = (root.querySelector(`[data-testid="memory-recipe-slot-kind-${recipe.id}"]`) as HTMLSelectElement | null)?.value;
	const preKind = (root.querySelector(`[data-testid="memory-recipe-pre-kind-${recipe.id}"]`) as HTMLSelectElement | null)?.value;
	const preValue = (root.querySelector(`[data-testid="memory-recipe-pre-value-${recipe.id}"]`) as HTMLInputElement | null)?.value.trim();
	const slots = [...(recipe.slots ?? [])];
	if (slotName && slotKind && (SLOT_KINDS as readonly string[]).includes(slotKind) && !slots.some(slot => slot.name === slotName)) {
		slots.push({ name: slotName, kind: slotKind as typeof SLOT_KINDS[number] });
	}
	const userPreconditions = (recipe.preconditions ?? []).filter(pre => (USER_PRE_KINDS as readonly string[]).includes(pre.kind));
	if (preKind && preValue && (USER_PRE_KINDS as readonly string[]).includes(preKind) && !userPreconditions.some(pre => pre.kind === preKind && pre.value === preValue)) {
		userPreconditions.push({ kind: preKind, value: preValue });
	}
	await widget.controller.patchMemoryRecipe({
		recipeId: recipe.id,
		title: titleEl?.value,
		notes: notesEl?.value,
		slots: slots.map(slot => ({
			name: slot.name,
			kind: (SLOT_KINDS as readonly string[]).includes(slot.kind) ? slot.kind as typeof SLOT_KINDS[number] : 'identifier',
			examples: slot.examples,
		})),
		userPreconditions,
	});
}

function renderTabPreview(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const tabDecision = state.recipeDecision;
	if (tabDecision?.source === 'tab' && tabDecision.awaitingChoice && tabDecision.recipe && (tabDecision.preview || tabDecision.slots?.length || tabDecision.files?.length || tabDecision.compose)) {
		const card = mk(body, 'div', 'banner is-notice');
		card.setAttribute('role', 'group');
		card.setAttribute('data-testid', 'memory-recipe-preview-card');
		mk(card, 'p', 'sm fw-6', t(state, tabDecision.compose ? 'recipeComposeTitle' : 'recipePreviewTitle', { title: tabDecision.recipe.title, count: tabDecision.compose?.recipes.length ?? 1 }));
		const latency = mk(card, 'p', 'xs o-60');
		latency.setAttribute('data-testid', 'memory-recipe-preview-latency');
		latency.textContent = t(state, 'recipePreviewLatency');
		if (tabDecision.compose?.recipes.length) {
			const plan = mk(card, 'ol', 'mt-1 xs');
			plan.setAttribute('data-testid', 'recipe-compose-plan');
			for (const [index, child] of tabDecision.compose.recipes.entries()) {
				mk(plan, 'li', '', t(state, 'recipeComposeStep', { index: index + 1, title: child.title }));
			}
		}
		if (tabDecision.slots?.length) {
			const slots = mk(card, 'div', 'mt-1');
			slots.setAttribute('data-testid', 'recipe-slot-fields');
			mk(slots, 'p', 'xs o-60', t(state, 'recipeSlotsNeedValues'));
			for (const slot of tabDecision.slots) {
				const row = mk(slots, 'label', 'block xs mt-1');
				row.append(slot.name);
				const input = document.createElement('input');
				input.type = 'text';
				input.value = slot.value ?? '';
				input.placeholder = slot.examples?.[0] ?? '';
				input.setAttribute('data-testid', `recipe-slot-input-${slot.name}`);
				row.appendChild(input);
			}
		}
		if (tabDecision.files?.length) {
			const files = mk(card, 'div', 'mt-1');
			files.setAttribute('data-testid', 'recipe-file-fields');
			mk(files, 'p', 'xs o-60', t(state, tabDecision.files.some(file => file.extra) ? 'recipeExtraFiles' : 'recipePartialFiles'));
			for (const [index, file] of tabDecision.files.entries()) {
				const row = mk(files, 'label', 'block xs mt-1');
				const input = document.createElement('input');
				input.type = 'checkbox';
				input.checked = file.included;
				input.setAttribute('data-testid', `recipe-file-include-${index}`);
				row.appendChild(input);
				row.append(` ${file.path}${file.extra ? ` (${t(state, 'recipeFileExtra')})` : ''}`);
			}
		}
		if (tabDecision.preview) {
			mk(card, 'pre', 'mt-1 xs', tabDecision.preview);
		}
		const choice = mk(card, 'div', 'mt-2 flex gap-2');
		const slotsReady = !tabDecision.slots?.length || tabDecision.slots.every(slot => Boolean(slot.value?.trim()));
		memoryButton(widget, choice, {
			tokens: 'pill-btn btn-primary',
			icon: 'check',
			label: t(state, 'recipeApply'),
			testId: 'memory-recipe-preview-apply',
			disabled: Boolean(state.memoryRecipeBusyId) || !slotsReady,
			onClick: () => {
				widget.controller.flushRecipeSlotInputs(card);
				widget.controller.answerRecipeChoice('apply');
			},
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
		if (tabDecision.whatIfBranch) {
			const whatIf = mk(done, 'p', 'xs o-60');
			whatIf.setAttribute('data-testid', 'recipe-whatif-branch');
			whatIf.textContent = t(state, 'recipeWhatIfBranch', { branch: tabDecision.whatIfBranch });
		}
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
}

function renderDialogs(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
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

	const promoteId = widget.recipePromoteId;
	const promote = promoteId ? state.memoryRecipes.find(recipe => recipe.id === promoteId) : undefined;
	if (promoteId && !promote) {
		widget.recipePromoteId = null;
	}
	if (promote) {
		const checks = (promote.preconditions ?? []).map(pre => `${pre.kind} ${pre.value}`).join(', ') || '—';
		const close = () => {
			widget.recipePromoteId = null;
			widget.recipePromoteConsent = false;
			widget.render();
		};
		const overlay = memoryConfirmDialog(widget, body, {
			title: t(state, 'memoryRecipePromoteScope'),
			lines: [{ text: t(state, 'memoryRecipePromoteScopeHint', { checks }), tokens: 'xs o-70 mb-3' }],
			cancelLabel: t(state, 'cancel'),
			confirmLabel: t(state, 'memoryRecipePromoteScope'),
			busy: Boolean(state.memoryRecipeBusyId) || !widget.recipePromoteConsent,
			testId: 'memory-recipe-promote-dialog',
			confirmTestId: 'memory-recipe-confirm-promote',
			onCancel: close,
			onConfirm: () => {
				if (!widget.recipePromoteConsent) {
					return;
				}
				widget.recipePromoteId = null;
				void widget.controller.patchMemoryRecipe({ recipeId: promote.id, scope: 'global', consent: true });
			},
		});
		const confirm = overlay.querySelector('[data-testid="memory-recipe-confirm-promote"]');
		const actions = confirm?.parentElement;
		if (actions?.parentElement) {
			const label = document.createElement('label');
			label.className = 'knox-gui-memory-xs';
			label.setAttribute('data-testid', 'memory-recipe-promote-consent');
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = widget.recipePromoteConsent;
			widget.renderStore.add(DOM.addDisposableListener(box, 'change', () => {
				widget.recipePromoteConsent = box.checked;
				widget.render();
			}));
			label.appendChild(box);
			label.append(` ${t(state, 'memoryRecipePromoteConsent')}`);
			actions.parentElement.insertBefore(label, actions);
		}
	}
}
