/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAskUserQuestionsForGui } from '../../../common/knoxGuiTools.js';
import { IKnoxGuiAskQuestion, IKnoxGuiHistoryItem, IKnoxGuiModel } from '../../../common/knoxGuiState.js';

export const LANGUAGE_KEY = 'knox.gui.language';
export const BOOKMARK_KEY = 'knox.gui.bookmarkedSlash';
export const GIT_DIFF_EXPANDED_KEY = 'knox.gui.gitDiffPanelExpanded';
export const ACTIVITY_PANEL_EXPANDED_KEY = 'knox.gui.activityPanelExpanded';
export const MEMORY_BUILD_TIMEOUT_MS = 5000;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function textFromUnknown(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(part => {
			const rec = asRecord(part);
			if (rec && typeof rec.text === 'string') {
				return rec.text;
			}
			return typeof part === 'string' ? part : '';
		}).join('');
	}
	const rec = asRecord(value);
	if (rec && typeof rec.content === 'string') {
		return rec.content;
	}
	if (rec && typeof rec.text === 'string') {
		return rec.text;
	}
	return value == null ? '' : JSON.stringify(value);
}

export function thinkingFromUnknown(value: unknown): string | undefined {
	if (!Array.isArray(value)) {
		const rec = asRecord(value);
		return rec && typeof rec.thinking === 'string' ? rec.thinking : undefined;
	}
	const parts = value.map(part => {
		const rec = asRecord(part);
		if (rec && (rec.type === 'thinking' || rec.type === 'reasoning') && typeof rec.text === 'string') {
			return rec.text;
		}
		return '';
	}).filter(Boolean);
	return parts.length ? parts.join('') : undefined;
}

export function imagesFromUnknown(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const urls = value.map(part => {
		const rec = asRecord(part);
		if (!rec) {
			return '';
		}
		if (rec.type === 'image_url' || rec.type === 'image') {
			const nested = asRecord(rec.image_url);
			const url = nested && typeof nested.url === 'string' ? nested.url : rec.image_url ?? rec.imageUrl ?? rec.url;
			return typeof url === 'string' ? url : '';
		}
		return typeof rec.imageUrl === 'string' ? rec.imageUrl : '';
	}).filter(Boolean);
	return urls.length ? urls : undefined;
}

export function contextItemsFromRaw(value: unknown): IKnoxGuiHistoryItem['contextItems'] {
	const items: NonNullable<IKnoxGuiHistoryItem['contextItems']> = [];
	for (const item of asArray(value)) {
		const rec = asRecord(item);
		if (!rec) {
			continue;
		}
		items.push({
			name: String(rec.name ?? rec.description ?? 'context'),
			content: String(rec.content ?? ''),
			provider: rec.provider ? String(rec.provider) : undefined,
		});
	}
	return items.length ? items : undefined;
}

export function modelsFromUnknown(value: unknown): IKnoxGuiModel[] {
	return asArray(value).map(item => {
		const rec = asRecord(item) ?? {};
		const caps = asRecord(rec.capabilities);
		const supported = Array.isArray(rec.supportedParameters) ? rec.supportedParameters.map(String) : undefined;
		const uploadImage = caps?.uploadImage === true || caps?.images === true || caps?.image === true ? true
			: caps && (caps.uploadImage === false || caps.images === false) ? false
				: undefined;
		return {
			title: String(rec.title ?? ''),
			provider: rec.provider ? String(rec.provider) : undefined,
			model: rec.model ? String(rec.model) : undefined,
			apiKey: rec.apiKey === undefined ? undefined : String(rec.apiKey),
			capabilities: caps ? {
				tools: caps.tools === undefined ? undefined : Boolean(caps.tools),
				webSearch: caps.webSearch === true,
				images: uploadImage,
				uploadImage,
				reasoning: caps.reasoning === true,
			} : undefined,
			supportedParameters: supported,
		};
	}).filter(model => model.title);
}

export function parseAskQuestions(args: Record<string, unknown>): IKnoxGuiAskQuestion[] {
	return parseAskUserQuestionsForGui(args.questions);
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return Promise.race([
		promise,
		new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
	]);
}
