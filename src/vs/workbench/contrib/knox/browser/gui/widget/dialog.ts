/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

export interface IKnoxGuiTextDialogOptions {
	testId: string;
	title?: string;
	body?: string;
	enterCloses?: boolean;
	role?: 'dialog' | 'alertdialog';
	labelledBy?: string;
	onClose: () => void;
	renderBody?: (box: HTMLElement) => void;
}

/** Layout `TextDialog`: dim + blur overlay, 600px card, X, Esc, click-out, optional Enter. */
export function renderTextDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: IKnoxGuiTextDialogOptions): HTMLElement {
	const overlay = DOM.append(parent, DOM.$('.knox-gui-text-dialog'));
	overlay.setAttribute('data-testid', options.testId);
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', options.onClose));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', options.role ?? 'dialog');
	box.setAttribute('aria-modal', 'true');
	if (options.labelledBy) {
		box.setAttribute('aria-labelledby', options.labelledBy);
	}
	widget.chromeButton(box, {
		svg: 'x',
		svgSize: 20,
		title: t(state, 'close'),
		extraClass: 'knox-gui-text-dialog-close',
		testId: `${options.testId}-close`,
		onClick: options.onClose,
	});
	if (options.enterCloses) {
		widget.renderStore.add(DOM.addDisposableListener(overlay, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				options.onClose();
			}
		}));
		queueMicrotask(() => overlay.focus());
		overlay.tabIndex = -1;
	}
	if (options.renderBody) {
		options.renderBody(box);
		return box;
	}
	const content = DOM.append(box, DOM.$('.knox-gui-text-dialog-content'));
	if (options.title) {
		DOM.append(content, DOM.$('h3', undefined, options.title));
	}
	if (options.body) {
		DOM.append(content, DOM.$('p', undefined, options.body));
	}
	return box;
}

export function renderMilestoneDialog(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	if (!widget.textDialog) {
		return;
	}
	renderTextDialog(widget, widget.root, state, {
		testId: 'knox-gui-text-dialog',
		title: widget.textDialog.title,
		body: widget.textDialog.body,
		enterCloses: true,
		onClose: () => widget.closeTextDialog(),
	});
}

export function renderImageViewer(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	if (!widget.imageViewerUrl) {
		return;
	}
	const url = widget.imageViewerUrl;
	renderTextDialog(widget, widget.root, state, {
		testId: 'knox-gui-image-viewer',
		enterCloses: true,
		onClose: () => widget.closeImageViewer(),
		renderBody: box => {
			const img = DOM.append(box, DOM.$('img.knox-gui-image-viewer-img')) as HTMLImageElement;
			img.src = url;
			img.alt = t(state, 'uploadedImageAlt', { index: 1 });
		},
	});
}
