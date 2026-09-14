/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	IKnoxImageAttachment,
	KNOX_IMAGE_EXTENSIONS,
	KNOX_IMAGE_JPEG_QUALITY,
	KNOX_IMAGE_RESOLUTION,
	knoxCreateImageAttachment,
	knoxDataTransferHasImages,
	knoxImageAttachPlan,
	knoxMimeFromImageName,
	knoxModelSupportsImages,
	knoxParseAddImageAttachment,
	knoxValidateImageFile,
} from '../../common/knoxImages.js';
import { mainWindow } from '../../../../../base/browser/window.js';

export async function knoxDownsizeImageDataUrl(
	dataUrl: string,
	maxEdge: number = KNOX_IMAGE_RESOLUTION,
	quality: number = KNOX_IMAGE_JPEG_QUALITY,
	win: Window & typeof globalThis = mainWindow,
): Promise<string> {
	return new Promise(resolve => {
		const img = new win.Image();
		img.onload = () => {
			const scale = Math.min(1, maxEdge / Math.max(1, img.width), maxEdge / Math.max(1, img.height));
			const canvas = win.document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(img.width * scale));
			canvas.height = Math.max(1, Math.round(img.height * scale));
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve(dataUrl);
				return;
			}
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			try {
				resolve(canvas.toDataURL('image/jpeg', quality));
			} catch {
				resolve(dataUrl);
			}
		};
		img.onerror = () => resolve(dataUrl);
		img.src = dataUrl;
	});
}

export function knoxBytesToDataUrl(bytes: Uint8Array, mime: string): string {
	return `data:${mime};base64,${encodeBase64(VSBuffer.wrap(bytes))}`;
}

/**
 * Thumbnail strip, drag overlay, paste/drop/picker, and `addImageAttachment`
 * for the native Knox input (T4.5).
 */
export class KnoxImageAttachments extends Disposable {

	readonly element: HTMLElement;

	private readonly _row: HTMLElement;
	private readonly _grid: HTMLElement;
	private readonly _attach: HTMLButtonElement;
	private readonly _warning: HTMLElement;
	private readonly _overlay: HTMLElement;
	private readonly _preview: HTMLImageElement;
	private readonly _itemDisposables = this._register(new DisposableStore());
	private _images: IKnoxImageAttachment[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this.element = parent;
		this._overlay = append(parent, $('.knox-image-drop.hidden'));
		append(this._overlay, $('span')).textContent = localize('knox.dropImageHere', "Drop image here");
		this._row = append(parent, $('.knox-image-row.hidden'));
		this._attach = append(this._row, $<HTMLButtonElement>('button.knox-image-attach'));
		this._attach.type = 'button';
		this._attach.title = localize('knox.attachImage', "Attach image");
		this._attach.setAttribute('aria-label', localize('knox.attachImage', "Attach image"));
		this._attach.textContent = '+';
		this._grid = append(this._row, $('.knox-image-grid'));
		this._warning = append(parent, $('.knox-image-warning.hidden'));
		this._warning.textContent = localize('knox.currentModelNoVision', "The current model does not support images.");
		this._preview = append(parent, $<HTMLImageElement>('img.knox-image-preview.hidden'));
		this._preview.alt = localize('knox.preview', "Preview");

		this._register(addDisposableListener(this._attach, 'click', () => void this.pick()));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	get images(): readonly IKnoxImageAttachment[] {
		return this._images;
	}

	clear(): void {
		if (!this._images.length) {
			return;
		}
		this._images = [];
		this._render();
		this._onDidChange.fire();
	}

	add(src: string, name?: string, opts?: { requireVision?: boolean }): boolean {
		const requireVision = opts?.requireVision !== false;
		const supports = knoxModelSupportsImages(this._chatService.defaultModel);
		if (requireVision && !supports) {
			this._notificationService.warn(localize('knox.modelNoImageSupport', "This model does not support images."));
			return false;
		}
		const plan = knoxImageAttachPlan({
			supportsImages: true,
			currentCount: this._images.length,
			incomingCount: 1,
		});
		if (plan.block === 'maxReached') {
			this._notificationService.warn(localize('knox.maxImagesReached', "Maximum number of images reached."));
			return false;
		}
		this._images = [...this._images, knoxCreateImageAttachment(src, name)];
		this._render();
		this._onDidChange.fire();
		return true;
	}

	addFromProtocol(data: unknown): void {
		const parsed = knoxParseAddImageAttachment(data);
		if (!parsed) {
			return;
		}
		this.add(parsed.src, parsed.name, { requireVision: false });
	}

	async pick(): Promise<void> {
		if (!this._gateVision()) {
			return;
		}
		const uris = await this._fileDialogService.showOpenDialog({
			title: localize('knox.attachImage', "Attach image"),
			canSelectFiles: true,
			canSelectMany: true,
			filters: [{
				name: localize('knox.images', "Images"),
				extensions: KNOX_IMAGE_EXTENSIONS.slice(),
			}],
		});
		if (!uris?.length) {
			return;
		}
		for (const uri of uris) {
			await this._addFromUri(uri);
		}
	}

	async handlePaste(event: ClipboardEvent): Promise<boolean> {
		const files = this._filesFromClipboard(event);
		if (!files.length) {
			return false;
		}
		event.preventDefault();
		event.stopPropagation();
		await this._addFiles(files, true);
		return true;
	}

	handleDragOver(event: DragEvent): void {
		if (!event.dataTransfer) {
			return;
		}
		const types = Array.from(event.dataTransfer.types);
		const items = event.dataTransfer.items ? Array.from(event.dataTransfer.items).map(item => item.type) : types;
		if (!knoxDataTransferHasImages(items.length ? items : types) && !types.includes('Files')) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (knoxModelSupportsImages(this._chatService.defaultModel)) {
			this._overlay.classList.remove('hidden');
		}
	}

	handleDragLeave(): void {
		this._overlay.classList.add('hidden');
	}

	async handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		this._overlay.classList.add('hidden');
		const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
		const images = files.filter(file => file.type.startsWith('image/') || knoxMimeFromImageName(file.name));
		if (!images.length) {
			if (files.length) {
				this._notificationService.warn(localize('knox.pleaseDropImageFiles', "Please drop image files."));
			}
			return;
		}
		if (!this._gateVision()) {
			return;
		}
		await this._addFiles(images, false);
	}

	private _gateVision(): boolean {
		if (knoxModelSupportsImages(this._chatService.defaultModel)) {
			return true;
		}
		this._notificationService.warn(localize('knox.modelNoImageSupport', "This model does not support images."));
		return false;
	}

	private async _addFiles(files: File[], alreadyGated: boolean): Promise<void> {
		if (!alreadyGated && !this._gateVision()) {
			return;
		}
		const plan = knoxImageAttachPlan({
			supportsImages: true,
			currentCount: this._images.length,
			incomingCount: files.length,
		});
		if (plan.block === 'maxReached') {
			this._notificationService.warn(localize('knox.maxImagesReached', "Maximum number of images reached."));
			return;
		}
		let added = 0;
		let failed = 0;
		for (const file of files.slice(0, plan.remaining)) {
			const ok = await this._addFromFile(file);
			if (ok) {
				added++;
			} else {
				failed++;
			}
		}
		if (failed && added) {
			this._notificationService.warn(localize('knox.imageUploadPartialSuccess', "Attached {0} of {1} images.", added, added + failed));
		} else if (added > 1) {
			this._notificationService.info(localize('knox.imageUploadSuccess', "Attached {0} images.", added));
		}
	}

	private async _addFromFile(file: File): Promise<boolean> {
		const block = knoxValidateImageFile({ mime: file.type, sizeBytes: file.size, name: file.name });
		if (block) {
			this._notificationService.error(localize('knox.imageSizeFormatError', "Image must be JPEG, PNG, GIF, SVG, or WebP and under 10 MB."));
			return false;
		}
		const buffer = new Uint8Array(await file.arrayBuffer());
		const mime = knoxIsAllowedMimeOrName(file.type, file.name);
		const dataUrl = await knoxDownsizeImageDataUrl(knoxBytesToDataUrl(buffer, mime));
		return this.add(dataUrl, file.name);
	}

	private async _addFromUri(uri: URI): Promise<void> {
		try {
			const file = await this._fileService.readFile(uri);
			const name = uri.path.split('/').pop();
			const block = knoxValidateImageFile({ mime: knoxMimeFromImageName(name), sizeBytes: file.value.byteLength, name });
			if (block) {
				this._notificationService.error(localize('knox.imageSizeFormatError', "Image must be JPEG, PNG, GIF, SVG, or WebP and under 10 MB."));
				return;
			}
			const mime = knoxMimeFromImageName(name) ?? 'image/png';
			const dataUrl = await knoxDownsizeImageDataUrl(knoxBytesToDataUrl(file.value.buffer, mime));
			this.add(dataUrl, name);
		} catch {
			this._notificationService.error(localize('knox.imageProcessingError', "Could not attach {0}.", uri.toString()));
		}
	}

	private _filesFromClipboard(event: ClipboardEvent): File[] {
		const items = event.clipboardData?.items;
		if (!items) {
			return [];
		}
		const files: File[] = [];
		for (const item of Array.from(items)) {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					files.push(file);
				}
			}
		}
		return files;
	}

	private _render(): void {
		const supports = knoxModelSupportsImages(this._chatService.defaultModel);
		this._row.classList.toggle('hidden', this._images.length === 0);
		this._attach.classList.add('hidden');
		this._warning.classList.toggle('hidden', supports || this._images.length === 0);
		clearNode(this._grid);
		this._itemDisposables.clear();
		for (const image of this._images) {
			this._renderThumb(image);
		}
	}

	private _renderThumb(image: IKnoxImageAttachment): void {
		const item = append(this._grid, $('.knox-image-thumb'));
		item.title = image.name ?? localize('knox.uploadedImage', "Uploaded image");
		const img = append(item, $<HTMLImageElement>('img'));
		img.src = image.src;
		img.alt = image.name ?? localize('knox.uploadedImage', "Uploaded image");
		this._itemDisposables.add(addDisposableListener(item, 'mouseenter', e => this._showPreview(e, image.src)));
		this._itemDisposables.add(addDisposableListener(item, 'mouseleave', () => this._hidePreview()));
		const remove = append(item, $<HTMLButtonElement>('button.knox-image-remove'));
		remove.type = 'button';
		remove.title = localize('knox.deleteImage', "Delete image");
		remove.setAttribute('aria-label', localize('knox.deleteImage', "Delete image"));
		remove.textContent = '×';
		this._itemDisposables.add(addDisposableListener(remove, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._images = this._images.filter(row => row.id !== image.id);
			this._render();
			this._onDidChange.fire();
		}));
	}

	private _showPreview(event: MouseEvent, src: string): void {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		this._preview.src = src;
		this._preview.classList.remove('hidden');
		const width = 300;
		const left = Math.min(Math.max(10, rect.left + rect.width / 2 - width / 2), getWindow(target).innerWidth - width - 10);
		const showBelow = rect.top < 230;
		this._preview.style.left = `${left}px`;
		this._preview.style.top = showBelow ? `${rect.bottom + 8}px` : `${Math.max(10, rect.top - 208)}px`;
	}

	private _hidePreview(): void {
		this._preview.classList.add('hidden');
	}
}

function knoxIsAllowedMimeOrName(mime: string, name: string): string {
	if (mime && mime !== 'image/jpg') {
		return mime === 'image/svg' ? 'image/svg+xml' : mime;
	}
	return knoxMimeFromImageName(name) ?? 'image/jpeg';
}
