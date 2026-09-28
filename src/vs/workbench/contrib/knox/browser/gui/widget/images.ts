/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import { KNOX_IMAGE_JPEG_QUALITY, knoxGuiImageFileAccepted, knoxGuiImageTargetSize, knoxGuiImageUploadToast } from '../../../common/knoxGuiInput.js';

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image load failed'));
		img.src = src;
	});
}

async function downsize(file: File): Promise<string | undefined> {
	const objectUrl = URL.createObjectURL(file);
	try {
		const img = await loadImage(objectUrl);
		const size = knoxGuiImageTargetSize(img.width, img.height);
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return undefined;
		}
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/jpeg', KNOX_IMAGE_JPEG_QUALITY);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/** `imageUtils.ts:handleImageFile`: type and 10 MB checks, then a 1024px JPEG at 0.7. */
export async function processImageFile(widget: KnoxGuiWidget, file: File): Promise<string | undefined> {
	if (!knoxGuiImageFileAccepted(file)) {
		widget.controller.messenger.post('showToast', ['error', t(widget.controller.store.state, 'imageSizeFormatError')]);
		return undefined;
	}
	return downsize(file);
}

/** `imageUtils.ts:handleMultipleImageFiles`: files run in parallel, then one summary toast. */
export async function processImageFiles(widget: KnoxGuiWidget, files: readonly File[]): Promise<string[]> {
	let failed = 0;
	const results = await Promise.all(files.map(async file => {
		try {
			return await processImageFile(widget, file);
		} catch {
			failed++;
			return undefined;
		}
	}));
	const urls = results.filter((url): url is string => Boolean(url));
	const toast = knoxGuiImageUploadToast(urls.length, files.length, failed);
	if (toast) {
		widget.controller.messenger.post('showToast', [toast.level, t(widget.controller.store.state, toast.key, toast.params)]);
	}
	return urls;
}
