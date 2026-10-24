/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Image attach, drag-and-drop, and preview geometry. */

export function extractImageUrls(content: unknown): string[] {
	if (typeof content === 'string') {
		return [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const urls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}
		const rec = part as Record<string, unknown>;
		if (rec.type === 'imageUrl') {
			const imageUrl = rec.imageUrl && typeof rec.imageUrl === 'object' ? (rec.imageUrl as Record<string, unknown>).url : rec.url;
			if (typeof imageUrl === 'string') {
				urls.push(imageUrl);
			}
		}
	}
	return urls;
}

export function imagePreviewPosition(rect: DOMRect, viewportWidth: number, viewportHeight: number): { x: number; y: number; below: boolean } {
	const previewWidth = 324;
	const previewHeight = 224;
	let x = rect.left + rect.width / 2;
	let y = rect.top - 10;
	if (x - previewWidth / 2 < 10) {
		x = previewWidth / 2 + 10;
	} else if (x + previewWidth / 2 > viewportWidth - 10) {
		x = viewportWidth - previewWidth / 2 - 10;
	}
	let below = false;
	if (y - previewHeight < 10) {
		y = rect.bottom + 10;
		below = true;
	}
	void viewportHeight;
	return { x, y, below };
}

export function parseUriList(raw: string): string[] {
	return raw.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#') && (line.startsWith('file:') || line.startsWith('/')));
}

export function isDroppedImageFile(file: { type: string; name: string }): boolean {
	return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

/** `tiptap/imageUtils.ts`: accepted MIME types (SVG is listed as `image/svg`, so real `image/svg+xml` files are refused). */
export const KNOX_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg', 'image/webp'];
export const KNOX_IMAGE_MAX_MB = 10;
export const KNOX_IMAGE_RESOLUTION = 1024;
export const KNOX_IMAGE_JPEG_QUALITY = 0.7;

export function knoxGuiImageFileAccepted(file: { type: string; size: number; name?: string }): boolean {
	if (file.size / 1024 / 1024 >= KNOX_IMAGE_MAX_MB) {
		return false;
	}
	if (KNOX_IMAGE_TYPES.includes(file.type) || file.type === 'image/svg+xml') {
		return true;
	}
	// OS pickers often leave `type` empty; match the drop-path extension check.
	return !file.type && isDroppedImageFile({ type: file.type, name: file.name ?? '' });
}

/** `getDataUrlForFile`: scales to fit 1024×1024, up or down. */
export function knoxGuiImageTargetSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(KNOX_IMAGE_RESOLUTION / width, KNOX_IMAGE_RESOLUTION / height);
	return { width: width * scale, height: height * scale };
}

/** `handleMultipleImageFiles` summary toast. */
export function knoxGuiImageUploadToast(success: number, total: number, failed: number): { level: 'warning' | 'info'; key: string; params: Record<string, number> } | undefined {
	if (failed > 0) {
		return success > 0 ? { level: 'warning', key: 'imageUploadPartialSuccess', params: { success, total, failed } } : undefined;
	}
	return success > 1 ? { level: 'info', key: 'imageUploadSuccess', params: { count: success } } : undefined;
}

/** `TipTapEditor.tsx` drag handlers: only image items raise the overlay. */
export function knoxGuiDragHasImages(items: ReadonlyArray<{ type: string }>): boolean {
	return items.some(item => item.type.startsWith('image/'));
}

export const KNOX_DRAG_LEAVE_HIDE_MS = 1000;
