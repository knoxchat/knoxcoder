/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Configuration tab. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	CHECKPOINT_CLEANUP_INTERVALS,
	checkpointConfigFieldErrors,
	checkpointConfigIsDirty,
	checkpointConfigNumber,
	DEFAULT_CHECKPOINT_CONFIG,
	formatCheckpointBytes,
	parseStorageBytes,
	parseTrackedExtensions,
} from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { cpBadge, cpButton, cpSelect } from './cpKit.js';

export function renderCheckpointConfig(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const draft = state.checkpointConfigDraft ?? DEFAULT_CHECKPOINT_CONFIG;
	const inputs = widget.checkpointConfigInputs;
	const storageText = inputs.storage ?? formatCheckpointBytes(draft.maxStorageBytes);
	const fileSizeText = inputs.fileSize ?? formatCheckpointBytes(draft.maxFileSizeBytes);
	const extensionsText = inputs.extensions ?? draft.trackedExtensions.join(', ');
	const errors = checkpointConfigFieldErrors(draft, storageText, fileSizeText);
	const hasErrors = Object.keys(errors).length > 0;
	const dirty = checkpointConfigIsDirty(draft, state.checkpointConfig, storageText);
	const loading = state.checkpointConfigLoading;
	const patch = (partial: Partial<typeof DEFAULT_CHECKPOINT_CONFIG>) => widget.controller.patchCheckpointConfig(partial);

	body.classList.add('knox-gui-cp-view');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-config'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-config-header'));
	const heading = DOM.append(header, DOM.$('.knox-gui-checkpoint-config-heading'));
	appendKnoxGuiSvg(heading, 'settings', 16).classList.add('knox-gui-cp-cyan');
	DOM.append(heading, DOM.$('h1', undefined, t(state, 'checkpointConfiguration')));
	if (dirty) {
		cpBadge(heading, 'secondary', t(state, 'unsavedChanges'), 'knox-gui-cp-unsaved').setAttribute('data-testid', 'checkpoint-config-unsaved');
	}
	const status = state.checkpointConfigStatus;
	if (status) {
		const alert = DOM.append(root, DOM.$(`.knox-gui-checkpoint-config-status.is-${status.type}`, { 'data-testid': 'checkpoint-config-status', role: 'alert' }));
		appendKnoxGuiSvg(alert, status.type === 'success' ? 'circle-check-big' : status.type === 'error' ? 'alert-circle' : 'info', 16);
		const text = status.messageKey === 'checkpointSaveFailed' ? `${t(state, status.messageKey)}: ${status.detail ?? t(state, 'unknownError')}` : t(state, status.messageKey);
		DOM.append(alert, DOM.$('div.knox-gui-checkpoint-config-status-text', undefined, text));
	}

	const sections = DOM.append(root, DOM.$('.knox-gui-cp-config-sections', { 'data-testid': 'checkpoint-config-sections' }));
	const row = (card: HTMLElement, id: string, labelKey: string, helpKey: string, error: string | undefined, control: (slot: HTMLElement) => void) => {
		const line = DOM.append(card, DOM.$('.knox-gui-checkpoint-config-row', { 'data-field': id }));
		const text = DOM.append(line, DOM.$('.knox-gui-checkpoint-config-text'));
		DOM.append(text, DOM.$('label', { for: id }, t(state, labelKey)));
		DOM.append(text, DOM.$('p.knox-gui-checkpoint-config-help', { id: `${id}-help` }, t(state, helpKey)));
		if (error) {
			DOM.append(text, DOM.$('p.knox-gui-checkpoint-config-error', { id: `${id}-error`, 'data-testid': 'checkpoint-config-error' }, t(state, error)));
		}
		const slot = DOM.append(line, DOM.$('.knox-gui-checkpoint-config-control'));
		slot.setAttribute('aria-describedby', error ? `${id}-help ${id}-error` : `${id}-help`);
		control(slot);
	};
	const numberInput = (slot: HTMLElement, id: string, value: number, min: number, max: number, invalid: boolean, onValue: (raw: string) => void) => {
		const input = DOM.append(slot, DOM.$('input', { id })) as HTMLInputElement;
		input.type = 'number';
		input.min = String(min);
		input.max = String(max);
		input.value = String(value);
		input.disabled = loading;
		input.setAttribute('aria-invalid', String(invalid));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onValue(input.value)));
	};
	const textInput = (slot: HTMLElement, id: string, value: string, placeholder: string, invalid: boolean, onValue: (raw: string) => void, onBlur: () => void) => {
		const input = DOM.append(slot, DOM.$('input', { id })) as HTMLInputElement;
		input.type = 'text';
		input.value = value;
		input.placeholder = placeholder;
		input.disabled = loading;
		input.setAttribute('aria-invalid', String(invalid));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onValue(input.value)));
		widget.renderStore.add(DOM.addDisposableListener(input, 'blur', onBlur));
	};
	const switchInput = (slot: HTMLElement, id: string, labelKey: string, value: boolean, onValue: (value: boolean) => void) => {
		const el = widget.customSwitch(DOM.append(slot, DOM.$('.knox-gui-cp-switch-wrap')), value, () => {
			if (!loading) {
				onValue(!value);
			}
		}, 16);
		el.id = id;
		el.setAttribute('aria-label', t(state, labelKey));
		el.setAttribute('aria-disabled', String(loading));
	};
	const storageRawChange = (key: 'storage' | 'fileSize', field: 'maxStorageBytes' | 'maxFileSizeBytes', raw: string) => {
		widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, [key]: raw };
		const bytes = parseStorageBytes(raw);
		if (bytes !== null) {
			patch({ [field]: bytes });
		} else {
			widget.render();
		}
	};
	const storageBlur = (key: 'storage' | 'fileSize', min: number) => {
		const raw = widget.checkpointConfigInputs[key];
		const bytes = raw === undefined ? null : parseStorageBytes(raw);
		if (bytes !== null && bytes >= min) {
			widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, [key]: undefined };
			widget.render();
		}
	};

	const storage = configSection(sections, t(state, 'storageLimits'), 'hard-drive');
	row(storage, 'maxCheckpoints', 'maxCheckpoints', 'checkpointMaxHelp', errors.maxCheckpoints, slot => numberInput(slot, 'maxCheckpoints', draft.maxCheckpoints, 1, 10000, Boolean(errors.maxCheckpoints), raw => patch({ maxCheckpoints: checkpointConfigNumber(raw, 1) })));
	row(storage, 'retentionDays', 'retentionPeriodDays', 'checkpointRetentionHelp', errors.retentionDays, slot => numberInput(slot, 'retentionDays', draft.retentionDays, 1, 365, Boolean(errors.retentionDays), raw => patch({ retentionDays: checkpointConfigNumber(raw, 1) })));
	row(storage, 'maxStorage', 'maxStorageSize', 'checkpointStorageHelp', errors.maxStorageBytes, slot => textInput(slot, 'maxStorage', storageText, '1 GB', Boolean(errors.maxStorageBytes), raw => storageRawChange('storage', 'maxStorageBytes', raw), () => storageBlur('storage', 1024 * 1024)));

	const automation = configSection(sections, t(state, 'checkpointAutomation'), 'clock');
	row(automation, 'enableAutoCheckpoints', 'enableAutoCheckpoints', 'checkpointAutoCheckpointsHelp', undefined, slot => switchInput(slot, 'enableAutoCheckpoints', 'enableAutoCheckpoints', draft.enableAutoCheckpoints, value => patch({ enableAutoCheckpoints: value })));
	row(automation, 'autoEnabled', 'enableTimedAutoCheckpoints', 'checkpointTimedAutoHelp', undefined, slot => switchInput(slot, 'autoEnabled', 'enableTimedAutoCheckpoints', draft.autoEnabled, value => patch({ autoEnabled: value })));
	if (draft.autoEnabled) {
		row(automation, 'autoMinInterval', 'autoMinIntervalSeconds', 'checkpointAutoIntervalHelp', errors.autoMinIntervalMs, slot => numberInput(slot, 'autoMinInterval', Math.round(draft.autoMinIntervalMs / 1000), 1, 3600, Boolean(errors.autoMinIntervalMs), raw => patch({ autoMinIntervalMs: checkpointConfigNumber(raw, 1) * 1000 })));
		row(automation, 'autoFileChangeThreshold', 'autoFileChangeThreshold', 'checkpointAutoFileThresholdHelp', errors.autoFileChangeThreshold, slot => numberInput(slot, 'autoFileChangeThreshold', draft.autoFileChangeThreshold, 1, 10000, Boolean(errors.autoFileChangeThreshold), raw => patch({ autoFileChangeThreshold: checkpointConfigNumber(raw, 1) })));
		row(automation, 'autoShowNotifications', 'autoShowNotifications', 'checkpointAutoNotifyHelp', undefined, slot => switchInput(slot, 'autoShowNotifications', 'autoShowNotifications', draft.autoShowNotifications, value => patch({ autoShowNotifications: value })));
	}
	row(automation, 'autoCleanup', 'autoCleanup', 'checkpointAutoCleanupHelp', undefined, slot => switchInput(slot, 'autoCleanup', 'autoCleanup', draft.autoCleanup, value => patch({ autoCleanup: value })));
	if (draft.autoCleanup) {
		row(automation, 'cleanupInterval', 'cleanupInterval', 'checkpointCleanupIntervalHelp', undefined, slot => {
			const interval = cpSelect(slot, 'cleanupInterval');
			interval.setAttribute('aria-label', t(state, 'cleanupInterval'));
			interval.disabled = loading;
			for (const option of CHECKPOINT_CLEANUP_INTERVALS) {
				const el = DOM.append(interval, DOM.$('option')) as HTMLOptionElement;
				el.value = String(option.value);
				el.textContent = t(state, option.key);
				el.selected = option.value === draft.cleanupIntervalHours;
			}
			widget.renderStore.add(DOM.addDisposableListener(interval, 'change', () => patch({ cleanupIntervalHours: Number.parseInt(interval.value, 10) })));
		});
	}

	const performance = configSection(sections, t(state, 'performanceSettings'), 'zap');
	row(performance, 'maxFiles', 'maxFilesPerCheckpoint', 'checkpointMaxFilesHelp', errors.maxFilesPerCheckpoint, slot => numberInput(slot, 'maxFiles', draft.maxFilesPerCheckpoint, 1, 100000, Boolean(errors.maxFilesPerCheckpoint), raw => patch({ maxFilesPerCheckpoint: checkpointConfigNumber(raw, 1) })));
	row(performance, 'maxFileSize', 'maxFileSize', 'checkpointMaxFileSizeHelp', errors.maxFileSizeBytes, slot => textInput(slot, 'maxFileSize', fileSizeText, '5 MB', Boolean(errors.maxFileSizeBytes), raw => storageRawChange('fileSize', 'maxFileSizeBytes', raw), () => storageBlur('fileSize', 1024)));
	row(performance, 'enableCompression', 'enableCompression', 'checkpointCompressionHelp', undefined, slot => switchInput(slot, 'enableCompression', 'enableCompression', draft.enableCompression, value => patch({ enableCompression: value })));
	row(performance, 'encryptAtRest', 'encryptAtRest', 'checkpointEncryptAtRestHelp', undefined, slot => switchInput(slot, 'encryptAtRest', 'encryptAtRest', draft.encryptAtRest, value => patch({ encryptAtRest: value })));

	const tracking = configSection(sections, t(state, 'fileTracking'), 'file-text');
	row(tracking, 'trackedExtensions', 'trackedFileExtensions', 'checkpointTrackedExtensionsHelp', undefined, slot => textInput(slot, 'trackedExtensions', extensionsText, t(state, 'fileExtensionsPlaceholder'), false, raw => {
		widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, extensions: raw };
		patch({ trackedExtensions: parseTrackedExtensions(raw) });
	}, () => {
		if (widget.checkpointConfigInputs.extensions !== undefined) {
			widget.checkpointConfigInputs = { ...widget.checkpointConfigInputs, extensions: undefined };
			widget.render();
		}
	}));
	row(tracking, 'captureBinaryFiles', 'captureBinaryFiles', 'checkpointCaptureBinaryHelp', undefined, slot => switchInput(slot, 'captureBinaryFiles', 'captureBinaryFiles', draft.captureBinaryFiles, value => patch({ captureBinaryFiles: value })));

	const clearInputs = () => { widget.checkpointConfigInputs = {}; };
	const actions = DOM.append(root, DOM.$('.knox-gui-config-actions'));
	cpButton(widget, actions, { variant: 'outline', svg: 'clock', label: t(state, 'reset'), disabled: loading, testId: 'checkpoint-config-reset', onClick: () => { clearInputs(); widget.controller.resetCheckpointConfigToDefaults(); } });
	cpButton(widget, actions, { variant: 'outline', svg: 'x', label: t(state, 'cancel'), disabled: loading || !dirty, testId: 'checkpoint-config-cancel', onClick: () => { clearInputs(); widget.controller.cancelCheckpointConfig(); } });
	cpButton(widget, actions, {
		variant: 'default',
		svg: loading ? undefined : 'save',
		spinner: loading,
		label: t(state, loading ? 'saving' : 'save'),
		disabled: loading || !dirty || hasErrors,
		testId: 'checkpoint-config-save',
		onClick: () => {
			void widget.controller.saveCheckpointConfig().then(() => {
				if (widget.controller.store.state.checkpointConfigStatus?.type === 'success') {
					clearInputs();
					widget.render();
				}
			});
		},
	});
}

function configSection(body: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = DOM.append(body, DOM.$('.knox-gui-config-card'));
	const head = DOM.append(DOM.append(card, DOM.$('.knox-gui-config-card-head')), DOM.$('.knox-gui-config-card-title'));
	appendKnoxGuiSvg(DOM.append(head, DOM.$('span.knox-gui-cp-cyan')), icon, 16);
	DOM.append(head, DOM.$('span.knox-gui-cp-truncate', undefined, title));
	return DOM.append(card, DOM.$('.knox-gui-config-card-body'));
}
