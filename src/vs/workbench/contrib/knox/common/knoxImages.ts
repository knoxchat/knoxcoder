/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import {
	IKnoxMessageContent,
	IKnoxMessagePart,
	IKnoxModelDescription,
	knoxMessageImageUrls,
} from './knoxChatTypes.js';

export const KNOX_MAX_IMAGES = 10;
export const KNOX_MAX_IMAGE_MB = 10;
export const KNOX_MAX_IMAGE_BYTES = KNOX_MAX_IMAGE_MB * 1024 * 1024;
export const KNOX_IMAGE_RESOLUTION = 1024;
export const KNOX_IMAGE_JPEG_QUALITY = 0.7;

export const KNOX_IMAGE_PROVIDERS = ['openai', 'anthropic', 'knoxchat'];
export const KNOX_IMAGE_MODELS = [
	'gemini',
	'gpt-4o',
	'gpt-4o-mini',
	'claude-3',
	'opus-4',
	'opus-5',
	'sonnet-4',
	'sonnet-5',
	'sonnet',
	'opus',
	'haiku',
	'pixtral',
];

export const KNOX_IMAGE_MIMES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/svg',
	'image/svg+xml',
	'image/webp',
]);

export const KNOX_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];

export type KnoxImageAttachBlock = 'noVision' | 'maxReached' | 'badType' | 'tooLarge';

export interface IKnoxImageAttachment {
	id: string;
	src: string;
	name?: string;
}

export interface IKnoxImageAttachPlan {
	remaining: number;
	block?: 'noVision' | 'maxReached';
}

export function knoxModelSupportsImages(model: IKnoxModelDescription | undefined): boolean {
	if (!model) {
		return false;
	}
	if (model.capabilities?.uploadImage !== undefined) {
		return model.capabilities.uploadImage;
	}
	const provider = (model.provider ?? '').toLowerCase();
	if (!KNOX_IMAGE_PROVIDERS.includes(provider)) {
		return false;
	}
	const lower = (model.model ?? '').toLowerCase();
	const title = model.title ?? '';
	return KNOX_IMAGE_MODELS.some(name => lower.includes(name) || title.includes(name));
}

export function knoxImageExtension(name: string | undefined): string {
	const match = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
	return match?.[1] ?? '';
}

export function knoxMimeFromImageName(name: string | undefined): string | undefined {
	switch (knoxImageExtension(name)) {
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'gif':
			return 'image/gif';
		case 'svg':
			return 'image/svg+xml';
		case 'webp':
			return 'image/webp';
		default:
			return undefined;
	}
}

export function knoxIsAllowedImageMime(mime: string | undefined): boolean {
	return !!mime && KNOX_IMAGE_MIMES.has(mime.toLowerCase());
}

export function knoxIsAllowedImageName(name: string | undefined): boolean {
	return KNOX_IMAGE_EXTENSIONS.includes(knoxImageExtension(name));
}

export function knoxValidateImageFile(args: { mime?: string; sizeBytes: number; name?: string }): KnoxImageAttachBlock | undefined {
	const mimeOk = knoxIsAllowedImageMime(args.mime) || knoxIsAllowedImageName(args.name);
	if (!mimeOk) {
		return 'badType';
	}
	if (args.sizeBytes >= KNOX_MAX_IMAGE_BYTES) {
		return 'tooLarge';
	}
	return undefined;
}

export function knoxImageAttachPlan(args: {
	supportsImages: boolean;
	currentCount: number;
	incomingCount: number;
	max?: number;
}): IKnoxImageAttachPlan {
	const max = args.max ?? KNOX_MAX_IMAGES;
	if (!args.supportsImages) {
		return { remaining: 0, block: 'noVision' };
	}
	const remaining = Math.max(0, max - args.currentCount);
	if (remaining <= 0 || args.incomingCount <= 0) {
		return { remaining, block: remaining <= 0 ? 'maxReached' : undefined };
	}
	return { remaining };
}

export function knoxCreateImageAttachment(src: string, name?: string): IKnoxImageAttachment {
	return {
		id: `img-${generateUuid()}`,
		src,
		name,
	};
}

export function knoxParseAddImageAttachment(data: unknown): IKnoxImageAttachment | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}
	const record = data as { imageUrl?: unknown; name?: unknown };
	if (typeof record.imageUrl !== 'string' || record.imageUrl.length === 0) {
		return undefined;
	}
	return knoxCreateImageAttachment(
		record.imageUrl,
		typeof record.name === 'string' ? record.name : undefined,
	);
}

export function knoxDataTransferHasImages(types: readonly string[]): boolean {
	return types.some(type => type.toLowerCase().startsWith('image/'));
}

export function knoxMessageContentWithImages(
	text: string,
	images: readonly IKnoxImageAttachment[],
): IKnoxMessageContent {
	if (!images.length) {
		return text;
	}
	const parts: IKnoxMessagePart[] = images.map(image => ({
		type: 'imageUrl',
		imageUrl: { url: image.src },
	}));
	if (text.length > 0) {
		parts.push({ type: 'text', text });
	}
	return parts;
}

export function knoxReuseImagesInContent(
	text: string,
	previous: IKnoxMessageContent | undefined,
): IKnoxMessageContent {
	const urls = knoxMessageImageUrls(previous);
	if (!urls.length) {
		return text;
	}
	return knoxMessageContentWithImages(text, urls.map(url => ({ id: url, src: url })));
}
