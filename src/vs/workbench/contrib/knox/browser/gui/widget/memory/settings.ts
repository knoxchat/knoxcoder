/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Settings tab: grouped config fields, maintenance actions, backup import/export and the danger zone. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import {
	MEMORY_SETTING_GROUP_ICONS,
	MEMORY_SETTING_GROUPS,
	parseMemorySettingInput,
	IKnoxGuiMemorySettingField,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	memoryClasses,
	mk,
	svg,
	spinner,
	memoryButton,
	memoryConfirmDialog,
} from './kit.js';

export function renderMemorySettings(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-314
	const config = state.memoryConfig;
	if (state.memoryConfigLoading && !Object.keys(config).length) {
		const loading = mk(body, 'div', 'center py-12');
		loading.setAttribute('data-testid', 'memory-settings-loading');
		spinner(loading, 24);
		return;
	}
	body.classList.add(...memoryClasses('py-4 sy-4').split(' '));
	renderMemorySettingsConfirm(widget, body, state);
	const result = state.memorySettingsResult;
	if (result) {
		const toast = mk(body, 'div', `banner is-${result.type} settings-result`);
		toast.setAttribute('data-testid', 'memory-settings-result');
		svg(toast, result.type === 'success' ? 'check' : 'x', 14);
		mk(toast, 'span', 'flex-1', result.message);
		memoryButton(widget, toast, { tokens: 'banner-close', icon: 'x', ariaLabel: t(state, 'close'), onClick: () => widget.controller.store.patch({ memorySettingsResult: undefined }) });
	}
	for (const group of MEMORY_SETTING_GROUPS) {
		const icon = (MEMORY_SETTING_GROUP_ICONS[group.titleKey] as KnoxGuiSvgIcon) || 'settings';
		const open = !group.collapsed || widget.memorySettingsOpen.has(group.titleKey);
		const content = group.collapsed
			? collapsibleSettingsSection(widget, body, t(state, group.titleKey), icon, open, () => {
				if (widget.memorySettingsOpen.has(group.titleKey)) {
					widget.memorySettingsOpen.delete(group.titleKey);
				} else {
					widget.memorySettingsOpen.add(group.titleKey);
				}
				widget.render();
			})
			: settingsSection(body, t(state, group.titleKey), icon);
		if (!content) {
			continue;
		}
		if (group.descKey) {
			mk(content, 'p', 'xs o-50', t(state, group.descKey));
		}
		let lastSection: string | undefined;
		for (const field of group.fields) {
			if (field.sectionKey && field.sectionKey !== lastSection) {
				mk(content, 'p', lastSection ? 'pt-2 xs fw-5 o-70' : 'xs fw-5 o-70', t(state, field.sectionKey));
				lastSection = field.sectionKey;
			}
			renderMemorySettingRow(widget, content, state, field);
		}
	}
	const busy = state.memorySettingsAction;
	const maintenance = settingsSection(body, t(state, 'memoryMaintenanceActions'), 'wrench');
	const actions = mk(maintenance, 'div', 'grid-2 gap-2');
	const file = DOM.$('input.knox-gui-hidden-file') as HTMLInputElement;
	const actionButton = (id: string, icon: KnoxGuiSvgIcon, labelKey: string, testId: string, onClick: () => void) => memoryButton(widget, actions, {
		tokens: 'action-btn btn-secondary',
		icon,
		iconSize: 14,
		spinning: busy === id,
		label: t(state, labelKey),
		testId,
		disabled: busy === id,
		onClick,
	});
	actionButton('optimize', 'zap', 'memoryOptimizeDb', 'knox-gui-memory-optimize', () => void widget.controller.runMemoryMaintenance('optimize'));
	actionButton('consolidate', 'refresh-cw', 'memoryConsolidateNow', 'knox-gui-memory-consolidate-now', () => {
		widget.memorySettingsConfirm = { action: 'consolidate', label: t(state, 'memoryConsolidateNow'), description: t(state, 'memoryConsolidateWarning') };
		widget.render();
	});
	actionButton('export', 'file-down', 'memoryExportData', 'knox-gui-memory-export', () => {
		void widget.controller.exportMemory(widget.memoryExportPassword).then(ok => {
			if (ok) {
				widget.memoryExportPassword = '';
				widget.render();
			}
		});
	});
	actionButton('import', 'upload', 'memoryImportData', 'knox-gui-memory-import', () => file.click());
	actionButton('heal', 'heart-pulse', 'memoryHealSystem', 'knox-gui-memory-heal', () => void widget.controller.runMemoryMaintenance('heal'));
	const passwords = mk(maintenance, 'div', 'password-grid');
	const passwordField = (labelKey: string, placeholderKey: string, testId: string, value: string, onInput: (value: string) => void) => {
		const label = mk(passwords, 'label', 'block xs o-70', t(state, labelKey));
		const input = mk(label, 'input', 'field password-input');
		input.type = 'password';
		input.value = value;
		input.placeholder = t(state, placeholderKey);
		input.setAttribute('data-testid', testId);
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onInput(input.value)));
	};
	passwordField('memoryExportPasswordOptional', 'memoryExportPasswordPlaceholder', 'memory-export-password', widget.memoryExportPassword, value => { widget.memoryExportPassword = value; });
	passwordField('memoryImportPasswordOptional', 'memoryImportPasswordPlaceholder', 'memory-import-password', widget.memoryImportPassword, value => { widget.memoryImportPassword = value; });
	mk(maintenance, 'p', 'xs o-50', t(state, 'memoryBackupLocalOnly'));
	maintenance.appendChild(file);
	file.type = 'file';
	file.accept = '.json,application/json';
	widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
		const picked = file.files?.[0];
		file.value = '';
		if (picked) {
			void importMemoryFile(widget, picked);
		}
	}));
	const danger = settingsSection(body, t(state, 'memoryDangerZone'), 'alert-triangle');
	mk(danger, 'p', 'mb-3 xs o-60', t(state, 'memoryDangerZoneDesc'));
	memoryButton(widget, danger, {
		tokens: 'action-btn is-danger',
		icon: 'trash-2',
		iconSize: 14,
		spinning: busy === 'purge',
		label: t(state, 'memoryPurgeExpired'),
		testId: 'knox-gui-memory-purge',
		disabled: busy === 'purge',
		onClick: () => {
			widget.memorySettingsConfirm = { action: 'purge', label: t(state, 'memoryPurgeExpired'), description: t(state, 'memoryPurgeWarning') };
			widget.render();
		},
	});
}

/** `SettingsSection`: card with an `h3` title; returns the `space-y-3` body. */
function settingsSection(parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = mk(parent, 'div', 'card');
	const heading = mk(card, 'h3', 'card-title mb-3');
	svg(heading, icon, 14);
	heading.append(title);
	return mk(card, 'div', 'sy-3');
}

/** `CollapsibleSettingsSection`: returns the `mt-3 space-y-3` body, or `undefined` while collapsed. */
function collapsibleSettingsSection(widget: KnoxGuiWidget, parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon, open: boolean, onToggle: () => void): HTMLElement | undefined {
	const card = mk(parent, 'div', 'card');
	const toggle = mk(card, 'button', 'collapse-head');
	toggle.type = 'button';
	toggle.setAttribute('aria-expanded', String(open));
	const label = mk(toggle, 'span', 'flex items-center gap-1_5');
	svg(label, icon, 14);
	label.append(title);
	svg(toggle, open ? 'chevron-down' : 'chevron-right', 14);
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', onToggle));
	return open ? mk(card, 'div', 'mt-3 sy-3') : undefined;
}

/** `ToggleSetting` / `NumberSetting` / `DecimalSetting` / `FloatSetting` / `TextSetting` / `SelectSetting`. */
function renderMemorySettingRow(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, field: IKnoxGuiMemorySettingField): void {
	const config = state.memoryConfig;
	const row = mk(card, 'div', field.kind === 'toggle' ? 'setting-row' : 'setting-row gap-3');
	row.setAttribute('data-setting', field.key);
	const text = mk(row, 'div', 'flex-1');
	const title = mk(text, 'div', 'flex items-center gap-2 sm');
	const inputId = `knox-memory-setting-${field.key}`;
	mk(title, 'label', 'setting-label', t(state, field.labelKey)).htmlFor = inputId;
	if (state.memorySavedKey === field.key) {
		const saved = svg(title, 'check', 12, 'saved');
		saved.setAttribute('data-testid', 'memory-setting-saved');
	}
	mk(text, 'div', 'xs o-50', field.descKey ? t(state, field.descKey) : '');
	const commitOnBlurOrEnter = (input: HTMLInputElement, commit: () => void) => {
		widget.renderStore.add(DOM.addDisposableListener(input, 'blur', commit));
		widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.isComposing) {
				commit();
			}
		}));
	};
	if (field.kind === 'toggle') {
		const isOn = config[field.key] !== false && config[field.key] !== 'false';
		const toggle = mk(row, 'button', isOn ? 'toggle is-on' : 'toggle');
		toggle.type = 'button';
		toggle.id = inputId;
		toggle.setAttribute('role', 'switch');
		toggle.setAttribute('aria-checked', String(isOn));
		mk(toggle, 'span', 'toggle-knob');
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => widget.controller.updateMemoryConfig(field.key, !isOn)));
	} else if (field.kind === 'text') {
		const input = mk(row, 'input', 'field setting-input w-48');
		input.id = inputId;
		input.type = 'text';
		const current = String(config[field.key] ?? '');
		input.value = current;
		commitOnBlurOrEnter(input, () => {
			if (input.value !== current) {
				widget.controller.updateMemoryConfig(field.key, input.value);
			}
		});
	} else if (field.kind === 'number') {
		const raw = Number(config[field.key] ?? field.min ?? 0);
		const shown = field.percent ? String(Math.round(raw * 100)) : String(raw);
		const control = field.float ? row : mk(row, 'div', 'flex items-center gap-1');
		const input = mk(control, 'input', field.float ? 'field setting-input text-right w-24' : 'field setting-input text-right w-20');
		input.id = inputId;
		input.type = 'number';
		input.value = shown;
		if (field.percent) {
			input.min = String(Math.round((field.min ?? 0) * 100));
			input.max = String(Math.round((field.max ?? 1) * 100));
		} else {
			if (field.min != null) {
				input.min = String(field.min);
			}
			if (field.max != null) {
				input.max = String(field.max);
			}
			if (field.step != null) {
				input.step = String(field.step);
			}
		}
		commitOnBlurOrEnter(input, () => {
			const parsed = parseMemorySettingInput(field, input.value);
			if (parsed === undefined) {
				input.value = shown;
			} else if (parsed !== raw) {
				widget.controller.updateMemoryConfig(field.key, parsed);
			}
		});
		const suffix = field.percent ? '%' : field.suffixKey ? t(state, field.suffixKey) : undefined;
		if (suffix && !field.float) {
			mk(control, 'span', 'xs o-50', suffix);
		}
	} else if (field.kind === 'select' && field.options) {
		const select = mk(row, 'select', 'field setting-input');
		select.id = inputId;
		for (const option of field.options) {
			const el = mk(select, 'option', '', t(state, option.labelKey));
			el.value = option.value;
			if (String(config[field.key] ?? '') === option.value) {
				el.selected = true;
			}
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => widget.controller.updateMemoryConfig(field.key, select.value)));
	}
}

function renderMemorySettingsConfirm(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const confirm = widget.memorySettingsConfirm;
	if (!confirm) {
		return;
	}
	const close = () => {
		widget.memorySettingsConfirm = null;
		widget.render();
	};
	const overlay = memoryConfirmDialog(widget, body, {
		title: t(state, 'memoryConfirmAction'),
		lines: [{ text: confirm.description, tokens: 'mb-4 xs o-70' }],
		cancelLabel: t(state, 'memoryCancel'),
		confirmLabel: confirm.label,
		testId: 'memory-settings-confirm',
		confirmTestId: 'memory-settings-confirm-run',
		onCancel: close,
		onConfirm: () => {
			widget.memorySettingsConfirm = null;
			void widget.controller.runMemoryMaintenance(confirm.action);
			widget.render();
		},
	});
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'mousedown', (e: MouseEvent) => {
		if (e.target === overlay) {
			close();
		}
	}));
}

async function importMemoryFile(widget: KnoxGuiWidget, file: File): Promise<void> {
	try {
		if (await widget.controller.importMemoryData(await file.text(), widget.memoryImportPassword)) {
			widget.memoryImportPassword = '';
			widget.render();
		}
	} catch {
		// optional
	}
}
