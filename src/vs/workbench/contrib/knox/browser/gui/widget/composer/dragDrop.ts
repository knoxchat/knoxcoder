/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import {
	isDroppedImageFile,
	KNOX_DRAG_LEAVE_HIDE_MS,
	knoxGuiDragHasImages,
	parseUriList,
} from '../../../../common/knoxGuiInput.js';
import { processImageFiles } from '../images.js';

export function onDragOver(widget: KnoxGuiWidget, event: DragEvent): void {
	event.preventDefault();
	const items = Array.from(event.dataTransfer?.items ?? []);
	if (!knoxGuiDragHasImages(items)) {
		return;
	}
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
		widget.dragLeaveTimer = undefined;
	}
	if (!widget.dragOver) {
		widget.dragOver = true;
		widget.showDropOverlay();
	}
}

/** `TipTapEditor.tsx`: leaving the window hides the overlay after 1000 ms. */
export function onDragLeave(widget: KnoxGuiWidget, event: DragEvent): void {
	if (event.relatedTarget && widget.root.contains(event.relatedTarget as Node)) {
		return;
	}
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
	}
	widget.dragLeaveTimer = setTimeout(() => {
		widget.dragLeaveTimer = undefined;
		widget.dragOver = false;
		widget.hideDropOverlay();
	}, KNOX_DRAG_LEAVE_HIDE_MS);
}

/** The overlay only shows for image models (`modelSupportsImages` guard around `DragOverlay`). */
export function showDropOverlay(widget: KnoxGuiWidget, parent: HTMLElement = widget.root): void {
	if (widget.dropOverlayEl || !widget.controller.store.state.imagesSupported) {
		return;
	}
	const overlay = DOM.append(parent, DOM.$('.knox-gui-drop-overlay'));
	overlay.setAttribute('data-testid', 'knox-gui-drop-overlay');
	if (parent !== widget.root) {
		overlay.classList.add('knox-gui-drop-overlay-scoped');
	}
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-fill'));
	DOM.append(overlay, DOM.$('.knox-gui-drop-overlay-text', undefined, t(widget.controller.store.state, 'dragAndDropImages')));
	widget.dropOverlayEl = overlay;
}

export function hideDropOverlay(widget: KnoxGuiWidget): void {
	widget.dropOverlayEl?.remove();
	widget.dropOverlayEl = undefined;
}

/**
 * Images follow `TipTapEditor.tsx` onDrop (model check, image-only toast,
 * `handleMultipleImageFiles`). Dropped paths and explorer URIs become mentions
 * or files to edit, which the webview could not receive.
 */
export function onDrop(widget: KnoxGuiWidget, event: DragEvent): void {
	event.preventDefault();
	event.stopPropagation();
	if (widget.dragLeaveTimer) {
		clearTimeout(widget.dragLeaveTimer);
		widget.dragLeaveTimer = undefined;
	}
	widget.dragOver = false;
	widget.hideDropOverlay();
	const state = widget.controller.store.state;
	const files = Array.from(event.dataTransfer?.files ?? []);
	const images = files.filter(file => isDroppedImageFile(file));
	const otherFiles = files.filter(file => !isDroppedImageFile(file));
	const uris = parseUriList(event.dataTransfer?.getData('text/uri-list') ?? '');
	if (images.length) {
		if (!state.imagesSupported) {
			widget.controller.messenger.post('showToast', ['warning', t(state, 'modelNoImageSupport')]);
		} else {
			void processImageFiles(widget, images).then(urls => widget.addImages(urls.map(imageUrl => ({ name: '', imageUrl }))));
		}
	} else if (!otherFiles.length && !uris.length && files.length) {
		widget.controller.messenger.post('showToast', ['warning', t(state, 'pleaseDropImageFiles')]);
	}
	const paths = [
		...otherFiles.map(file => (file as File & { path?: string }).path || file.name),
		...uris,
	].filter(Boolean);
	for (const path of paths) {
		if (state.mode === 'edit') {
			void widget.controller.addFilesToEdit([path]);
		} else {
			widget.controller.mentionDroppedFile(path);
		}
	}
}
