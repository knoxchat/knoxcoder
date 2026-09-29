/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { imagePreviewPosition, knoxGuiImageFileAccepted } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { processImageFile, processImageFiles } from '../images.js';

export function readImageFile(widget: KnoxGuiWidget, file: File): void {
	void processImageFile(widget, file).then(imageUrl => {
		if (imageUrl) {
			widget.addImages([{ name: file.name, imageUrl }]);
		}
	});
}

export function addImages(widget: KnoxGuiWidget, images: ReadonlyArray<{ name: string; imageUrl: string }>): void {
	if (images.length) {
		widget.controller.store.patch({ images: [...widget.controller.store.state.images, ...images] });
	}
}

const KNOX_IMAGE_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.svg,.webp';

/** Hidden file input overlay so Electron/VS Code actually opens the picker (display:none `.click()` often no-ops). */
export function renderImageAttach(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	testId: string,
	onImages: (urls: string[], files: File[]) => void,
): void {
	const wrap = DOM.append(parent, DOM.$('span.knox-gui-attach-wrap.knox-gui-xs-hide'));
	const file = DOM.append(wrap, DOM.$('input.knox-gui-file')) as HTMLInputElement;
	file.type = 'file';
	file.accept = KNOX_IMAGE_FILE_ACCEPT;
	file.multiple = true;
	file.tabIndex = -1;
	file.setAttribute('aria-hidden', 'true');
	widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
		const files = Array.from(file.files ?? []);
		file.value = '';
		void attachPickedFiles(widget, files, onImages);
	}));
	widget.chromeButton(wrap, {
		svg: 'attach-image',
		svgSize: 14,
		title: t(state, 'attachImage'),
		testId,
		extraClass: 'knox-gui-xs-hide',
		onClick: () => file.click(),
	});
}

async function attachPickedFiles(widget: KnoxGuiWidget, files: readonly File[], onImages: (urls: string[], files: File[]) => void): Promise<void> {
	if (!files.length) {
		return;
	}
	const images = files.filter(file => knoxGuiImageFileAccepted(file));
	const others = files.filter(file => !knoxGuiImageFileAccepted(file));
	if (images.length) {
		const urls = await processImageFiles(widget, images);
		onImages(urls, images);
	}
	const state = widget.controller.store.state;
	for (const extra of others) {
		const path = (extra as File & { path?: string }).path || extra.name;
		if (!path) {
			continue;
		}
		if (state.mode === 'edit') {
			void widget.controller.addFilesToEdit([path]);
		} else {
			widget.controller.mentionDroppedFile(path);
		}
	}
}

export function renderImageThumbnails(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const uploaded = state.images;
	const historical = state.historicalImages;
	if (!uploaded.length && !historical.length) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-thumbs'));
	wrap.setAttribute('data-testid', 'knox-gui-image-thumbs');
	for (const [index, image] of uploaded.entries()) {
		widget.renderThumb(wrap, state, image.imageUrl, image.name, t(state, 'uploadedImageAlt', { index: index + 1 }), () => widget.controller.removeImage(index));
	}
	for (const [index, url] of historical.entries()) {
		widget.renderThumb(wrap, state, url, `historical-${index}`, t(state, 'historicalImageAlt', { index: index + 1 }), () => widget.controller.removeHistoricalImage(index));
	}
}

export function renderThumb(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, url: string, name: string, alt: string, onRemove: () => void): void {
	const item = DOM.append(parent, DOM.$('.knox-gui-thumb-item'));
	const img = DOM.append(item, DOM.$('img.knox-gui-thumb')) as HTMLImageElement;
	img.src = url;
	img.alt = alt;
	widget.renderStore.add(DOM.addDisposableListener(item, 'mouseenter', () => widget.showImagePreview(item, url)));
	widget.renderStore.add(DOM.addDisposableListener(item, 'mouseleave', () => widget.hideImagePreview()));
	widget.renderStore.add(DOM.addDisposableListener(img, 'click', e => {
		e.stopPropagation();
		widget.openImageViewer(url);
	}));
	const remove = widget.iconButton(item, '×', onRemove, 'codicon-close');
	remove.classList.add('knox-gui-thumb-remove');
	widget.hover(remove, t(state, 'deleteImage'));
	void name;
}

export function showImagePreview(widget: KnoxGuiWidget, anchor: HTMLElement, url: string): void {
	widget.hideImagePreview();
	const rect = anchor.getBoundingClientRect();
	const pos = imagePreviewPosition(rect, window.innerWidth, window.innerHeight);
	const preview = DOM.append(document.body, DOM.$('.knox-gui-image-preview'));
	preview.style.left = `${pos.x}px`;
	preview.style.top = `${pos.y}px`;
	preview.style.transform = pos.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)';
	const img = DOM.append(preview, DOM.$('img')) as HTMLImageElement;
	img.src = url;
	widget.imagePreviewEl = preview;
}

export function hideImagePreview(widget: KnoxGuiWidget): void {
	widget.imagePreviewEl?.remove();
	widget.imagePreviewEl = undefined;
}
