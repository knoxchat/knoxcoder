/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiChatPickerModels, knoxGuiListboxNextIndex, knoxGuiModelSelectTitle, knoxGuiModelTriggerLabel, knoxGuiShouldOpenAddModelDirectly, knoxGuiSortModelsByApiKey } from '../../../../common/knoxGuiCapabilities.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { reasoningEffortLabelKey } from '../../../../common/knoxGuiOverlays.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';

export function renderModelSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
	const models = knoxGuiChatPickerModels(state);
	const current = models.find(model => model.title === state.modelTitle) ?? models[0];
	const wrap = DOM.append(parent, DOM.$('.knox-gui-model-wrap'));
	const skipPicker = knoxGuiShouldOpenAddModelDirectly(models);
	const open = !skipPicker && widget.openMenu === 'model' && widget.openMenuSource === source;
	const trigger = widget.chromeButton(wrap, {
		label: knoxGuiModelTriggerLabel(current, models) || t(state, 'selectModel'),
		svg: 'chevrons-down',
		svgSize: 16,
		svgAfter: true,
		title: t(state, 'models'),
		testId: source === 'main' ? 'knox-gui-model-select' : `knox-gui-model-select-${source}`,
		extraClass: 'knox-gui-model-trigger',
		menuTrigger: true,
		onClick: () => {
			if (skipPicker) {
				widget.closeMenus();
				widget.controller.openAddModel('chat', { bulk: true });
				return;
			}
			widget.toggleMenu('model', source);
		},
	});
	trigger.setAttribute('aria-haspopup', skipPicker ? 'dialog' : 'listbox');
	trigger.setAttribute('aria-expanded', String(open));
	if (!skipPicker) {
		trigger.setAttribute('aria-controls', 'knox-gui-model-menu');
	}
	if (!open) {
		return;
	}
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-popover.knox-gui-model-menu'));
	menu.id = 'knox-gui-model-menu';
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('data-testid', 'knox-gui-model-menu');
	const rows: HTMLButtonElement[] = [];
	for (const model of knoxGuiSortModelsByApiKey(models)) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-model-option')) as HTMLButtonElement;
		row.type = 'button';
		row.setAttribute('role', 'option');
		const missingKey = model.apiKey === '';
		row.setAttribute('aria-selected', String(model.title === current?.title));
		row.setAttribute('aria-disabled', String(missingKey));
		if (missingKey) {
			row.classList.add('disabled');
		} else {
			rows.push(row);
		}
		appendKnoxGuiSvg(row, 'cpu', 14);
		const title = DOM.append(row, DOM.$('span.knox-gui-model-option-title', undefined, knoxGuiModelSelectTitle(model, models)));
		if (missingKey) {
			DOM.append(title, DOM.$('span.knox-gui-muted', undefined, ` (${t(state, 'missingApiKey')})`));
		}
		if (model.title === current?.title) {
			appendKnoxGuiSvg(row, 'check', 14);
		}
		const hoverActs = DOM.append(row, DOM.$('span.knox-gui-model-option-actions'));
		const trash = DOM.append(hoverActs, DOM.$('span.knox-gui-model-action.knox-gui-model-delete'));
		trash.setAttribute('role', 'button');
		trash.setAttribute('title', t(state, 'deleteModel'));
		appendKnoxGuiSvg(trash, 'trash', 12);
		widget.renderStore.add(DOM.addDisposableListener(trash, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.deleteModel(model.title);
			widget.closeMenus();
		}));
		const gear = DOM.append(hoverActs, DOM.$('span.knox-gui-model-action.knox-gui-model-config'));
		gear.setAttribute('role', 'button');
		gear.setAttribute('title', t(state, 'configureModel'));
		appendKnoxGuiSvg(gear, 'settings', 12);
		widget.renderStore.add(DOM.addDisposableListener(gear, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.messenger.post('config/openProfile', { profileId: state.profileId });
			widget.closeMenus();
		}));
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			if (missingKey) {
				e.preventDefault();
				return;
			}
			widget.closeMenus();
			if (model.title !== current?.title) {
				widget.controller.selectModel('chat', model.title);
			}
		}));
	}
	if (state.profileType === 'local') {
		const add = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-model-add')) as HTMLButtonElement;
		add.type = 'button';
		add.setAttribute('role', 'option');
		rows.push(add);
		appendKnoxGuiSvg(add, 'plus', 12);
		add.append(t(state, 'addModel'));
		widget.renderStore.add(DOM.addDisposableListener(add, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.openAddModel('chat', { bulk: true });
		}));
	}
	widget.renderStore.add(DOM.addDisposableListener(trigger, 'keydown', e => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? rows[0];
			selected?.focus();
		}
	}));
	widget.renderStore.add(DOM.addDisposableListener(menu, 'keydown', e => {
		const index = rows.indexOf(e.target as HTMLButtonElement);
		const next = knoxGuiListboxNextIndex(e.key, index, rows.length);
		if (next !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			rows[next].focus();
		}
	}));
	widget.anchorPopover(menu, trigger, { minWidth: 160 });
	queueMicrotask(() => {
		const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]:not([aria-disabled="true"])') ?? rows[0];
		selected?.focus();
	});
}

export function renderReasoningSelect(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
	if (!state.reasoningEfforts.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-effort-wrap'));
	const currentKey = reasoningEffortLabelKey(state.reasoningEffort ?? '');
	const open = widget.openMenu === 'effort' && widget.openMenuSource === source;
	const trigger = widget.chromeButton(wrap, {
		svg: 'brain',
		svgSize: 12,
		label: currentKey ? t(state, currentKey) : (state.reasoningEffort ?? t(state, 'reasoningEffortSelect')),
		svgAfter: false,
		title: t(state, 'reasoningEffortTooltip'),
		testId: source === 'main' ? 'knox-gui-reasoning-select' : `knox-gui-reasoning-select-${source}`,
		extraClass: 'knox-gui-effort-trigger',
		menuTrigger: true,
		disabled: state.isStreaming,
		onClick: () => widget.toggleMenu('effort', source),
	});
	appendKnoxGuiSvg(trigger, 'chevron-down', 12).classList.add('knox-gui-effort-chevron');
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', String(open));
	trigger.setAttribute('aria-controls', 'knox-gui-effort-menu');
	if (!open) {
		return;
	}
	const menu = DOM.append(widget.root, DOM.$('.knox-gui-popover.knox-gui-effort-menu'));
	menu.id = 'knox-gui-effort-menu';
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('data-testid', 'knox-gui-effort-menu');
	const rows: HTMLButtonElement[] = [];
	for (const effort of state.reasoningEfforts) {
		const row = DOM.append(menu, DOM.$('button.knox-gui-popover-item.knox-gui-effort-option')) as HTMLButtonElement;
		row.type = 'button';
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(effort === state.reasoningEffort));
		rows.push(row);
		const labelKey = reasoningEffortLabelKey(effort);
		DOM.append(row, DOM.$('span', undefined, labelKey ? t(state, labelKey) : effort));
		if (effort === state.reasoningEffort) {
			appendKnoxGuiSvg(row, 'check', 12).classList.add('knox-gui-effort-check');
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
			e.stopPropagation();
			widget.closeMenus();
			widget.controller.setReasoningEffort(effort);
		}));
	}
	widget.renderStore.add(DOM.addDisposableListener(menu, 'keydown', e => {
		const index = rows.indexOf(e.target as HTMLButtonElement);
		const next = knoxGuiListboxNextIndex(e.key, index, rows.length);
		if (next !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			rows[next].focus();
		}
	}));
	widget.anchorPopover(menu, trigger, { minWidth: 104 });
	queueMicrotask(() => {
		const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? rows[0];
		selected?.focus();
	});
}
