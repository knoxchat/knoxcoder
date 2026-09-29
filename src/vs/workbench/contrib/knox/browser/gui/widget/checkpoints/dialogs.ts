/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Restore-preview and compare dialogs. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { restorePreviewActionKey } from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { checkpointButton, checkpointCheckbox, checkpointDialog, checkpointDialogHeader } from './primitives.js';

export function renderRestorePreviewDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const close = () => {
		if (!state.checkpointRestoring) {
			widget.controller.closeCheckpointDialog();
		}
	};
	const dialog = checkpointDialog(widget, parent, 'restore-preview-dialog', close, '2xl', { title: t(state, 'close'), onClick: close });
	const node = state.checkpoints.find(item => item.id === state.checkpointRestoreId) ?? state.checkpointListItems.find(item => item.id === state.checkpointRestoreId);
	checkpointDialogHeader(dialog, t(state, 'restorePreviewTitle'), 'rotate-ccw', node?.description || state.checkpointRestorePreview?.description || t(state, 'restorePreviewSubtitle'));
	const body = DOM.append(dialog, DOM.$('.knox-gui-restore-body'));
	if (state.checkpointRestoreLoading) {
		DOM.append(body, DOM.$('p.knox-gui-restore-status', undefined, t(state, 'restorePreviewLoading')));
	} else if (state.checkpointRestoreError) {
		const error = DOM.append(body, DOM.$('p.knox-gui-restore-error', undefined, state.checkpointRestoreError === 'restorePreviewFailed' ? t(state, 'restorePreviewFailed') : state.checkpointRestoreError));
		error.setAttribute('data-testid', 'restore-preview-error');
	} else if (state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length) {
		DOM.append(body, DOM.$('p.knox-gui-restore-empty', undefined, t(state, 'restorePreviewEmpty')));
	} else if (state.checkpointRestorePreview) {
		const preview = state.checkpointRestorePreview;
		const summary = DOM.append(body, DOM.$('.knox-gui-restore-summary'));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-yellow', undefined, `${t(state, 'modified')}: ${preview.modified}`));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-green', undefined, `${t(state, 'added')}: ${preview.added}`));
		DOM.append(summary, DOM.$('span.odp-chip.odp-chip-red', undefined, `${t(state, 'deleted')}: ${preview.deleted}`));
		DOM.append(body, DOM.$('p.knox-gui-restore-hint', undefined, t(state, 'restorePreviewExtrasHint')));
		const all = DOM.append(body, DOM.$('label.knox-gui-restore-all'));
		const allBox = checkpointCheckbox(all, preview.files.length > 0 && state.checkpointRestoreSelected.length === preview.files.length, t(state, 'selectAll'));
		widget.renderStore.add(DOM.addDisposableListener(allBox, 'change', () => widget.controller.toggleRestoreAll(allBox.checked)));
		DOM.append(all, DOM.$('span', undefined, t(state, 'selectAll')));
		const list = DOM.append(body, DOM.$('ul.knox-gui-restore-files'));
		for (const file of preview.files) {
			const row = DOM.append(list, DOM.$('li.knox-gui-restore-file'));
			const box = checkpointCheckbox(row, state.checkpointRestoreSelected.includes(file.relativePath), file.relativePath);
			widget.renderStore.add(DOM.addDisposableListener(box, 'change', () => widget.controller.toggleRestorePath(file.relativePath, box.checked)));
			appendKnoxGuiSvg(row, 'file', 14).classList.add('knox-gui-restore-file-icon');
			const meta = DOM.append(row, DOM.$('.knox-gui-restore-file-main'));
			DOM.append(meta, DOM.$('div.knox-gui-restore-file-path', { title: file.relativePath }, file.relativePath));
			const stats = DOM.append(meta, DOM.$('.knox-gui-restore-file-meta'));
			DOM.append(stats, DOM.$(`span.knox-gui-restore-${file.action}`, undefined, t(state, restorePreviewActionKey(file.action))));
			DOM.append(stats, DOM.$('span', undefined, `+${file.additions}/-${file.deletions}`));
			DOM.append(stats, DOM.$('span', undefined, t(state, 'restorePreviewHunks', { count: file.hunkCount })));
		}
		if (preview.extraPaths.length) {
			DOM.append(body, DOM.$('p.knox-gui-restore-note', undefined, `${t(state, 'restorePreviewWillDelete')}: ${preview.extraPaths.join(', ')}`));
		}
		if (preview.skippedFiles.length) {
			DOM.append(body, DOM.$('p.knox-gui-restore-note', undefined, `${t(state, 'restorePreviewSkipped')}: ${preview.skippedFiles.map(file => `${file.path} (${file.reason})`).join(', ')}`));
		}
		checkpointButton(widget, body, {
			svg: 'git-compare',
			label: state.checkpointRestoreShowDiff ? t(state, 'restorePreviewHideDiff') : t(state, 'restorePreviewShowDiff'),
			variant: 'ghost',
			extraClass: 'knox-gui-restore-diff-toggle',
			onClick: () => void widget.controller.toggleRestoreDiff(),
		});
		if (state.checkpointRestoreShowDiff && state.checkpointRestoreDiff) {
			widget.renderDiffViewer(DOM.append(body, DOM.$('.knox-gui-restore-diff')), state, state.checkpointRestoreDiff);
		}
	}
	const memory = DOM.append(dialog, DOM.$('.knox-gui-restore-memory'));
	widget.toggle(memory, t(state, 'checkpointGraph.menu.restoreMemory'), state.checkpointRestoreMemory, value => widget.controller.store.patch({ checkpointRestoreMemory: value }));
	const actions = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
	const busy = state.checkpointRestoring;
	checkpointButton(widget, actions, { label: t(state, 'cancel'), variant: 'ghost', size: 'default', disabled: busy, onClick: () => widget.controller.closeCheckpointDialog() });
	checkpointButton(widget, actions, { label: t(state, 'restoreSelectedCount', { count: state.checkpointRestoreSelected.length }), size: 'default', disabled: busy || state.checkpointRestoreLoading || !state.checkpointRestoreSelected.length, onClick: () => void widget.controller.restoreSelectedFiles() });
	checkpointButton(widget, actions, {
		label: state.checkpointRestorePreview && !state.checkpointRestorePreview.files.length ? t(state, 'restoreAnyway') : t(state, 'restoreAll'),
		variant: 'default',
		size: 'default',
		disabled: busy || state.checkpointRestoreLoading || Boolean(state.checkpointRestoreError),
		onClick: () => void widget.controller.restoreAllFiles(),
	});
}

export function renderCompareDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const close = () => widget.controller.closeCheckpointDialog();
	const dialog = checkpointDialog(widget, parent, 'checkpoint-compare-dialog', close, '6xl', { title: t(state, 'close'), onClick: close });
	const label = (id: string | undefined) => state.checkpointCompareCatalog.find(item => item.id === id) ?? state.checkpoints.find(node => node.id === id);
	const left = label(state.checkpointCompareLeftId);
	const right = label(state.checkpointCompareRightId);
	checkpointDialogHeader(dialog, t(state, 'compareTwoCheckpoints'), 'git-compare', `${(left?.description || state.checkpointCompareLeftId || '').slice(0, 48)} → ${(right?.description || state.checkpointCompareRightId || '').slice(0, 48)}`);
	const body = DOM.append(dialog, DOM.$('.knox-gui-compare-body'));
	if (state.checkpointCompareLoading) {
		DOM.append(body, DOM.$('p.knox-gui-compare-status', undefined, t(state, 'loadingPreviousCheckpoint')));
	} else if (state.checkpointCompareError) {
		DOM.append(body, DOM.$('p.knox-gui-compare-status', undefined, t(state, state.checkpointCompareError)));
	} else if (state.checkpointCompareDiff) {
		widget.renderDiffViewer(body, state, state.checkpointCompareDiff);
	}
	const footer = DOM.append(dialog, DOM.$('.knox-gui-cpl-dialog-footer'));
	checkpointButton(widget, footer, { label: t(state, 'close'), size: 'default', onClick: close });
}
