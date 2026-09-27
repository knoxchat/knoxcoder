/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiModel } from './knoxGuiState.js';

/** Matches llm/autodetect PROVIDER_SUPPORTS_IMAGES. */
export const KNOX_GUI_IMAGE_PROVIDERS = ['openai', 'anthropic', 'knoxchat'];

/** Matches llm/autodetect MODEL_SUPPORTS_IMAGES, plus grok (KnoxChat vision). */
export const KNOX_GUI_IMAGE_MODEL_HINTS = [
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
	'grok',
];

/** Matches llm/reasoningEffortConfig DEFAULT_REASONING_EFFORT_CONFIG. */
export const DEFAULT_REASONING_EFFORT_ALLOWED = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'minimal'];
export const DEFAULT_REASONING_EFFORT = 'medium';

export interface IKnoxGuiReasoningEffortConfig {
	allowed: string[];
	default: string;
}

function providerOf(model: IKnoxGuiModel | undefined): string {
	return (model?.provider ?? '').toLowerCase();
}

function modelIdOf(model: IKnoxGuiModel | undefined): string {
	return (model?.model || model?.title || '').toLowerCase();
}

/**
 * Port of InputToolbar `modelSupportsImages`:
 * explicit uploadImage/images caps, then provider + model-name heuristics.
 * Native has no KnoxChat /v1/models cache, so name hints include grok.
 */
export function knoxGuiModelSupportsImages(model: IKnoxGuiModel | undefined): boolean {
	if (!model) {
		return false;
	}
	const caps = model.capabilities;
	if (caps?.uploadImage !== undefined) {
		return caps.uploadImage;
	}
	if (caps?.images !== undefined) {
		return caps.images;
	}
	if (!KNOX_GUI_IMAGE_PROVIDERS.includes(providerOf(model)) && providerOf(model) !== '') {
		return false;
	}
	const id = modelIdOf(model);
	const title = (model.title ?? '').toLowerCase();
	return KNOX_GUI_IMAGE_MODEL_HINTS.some(hint => id.includes(hint) || title.includes(hint));
}

/**
 * Port of `modelSupportsWebSearch`: trust supportedParameters and
 * explicit true caps. Explicit false is treated as unknown, not a hide.
 */
export function knoxGuiModelSupportsWebSearch(model: IKnoxGuiModel | undefined): boolean {
	if (!model) {
		return false;
	}
	const supported = model.supportedParameters ?? [];
	if (supported.includes('web_search') || supported.includes('web_search_options')) {
		return true;
	}
	return model.capabilities?.webSearch === true;
}

/** KN-371: GUI snapshot of Core's KnoxChat /v1/models cache (KN-253). */
export interface IKnoxGuiModelCatalogEntry {
	id: string;
	root?: string;
	name?: string;
	supportedParameters?: string[];
}

let knoxGuiModelCatalog: IKnoxGuiModelCatalogEntry[] = [];

export function knoxGuiResetModelCatalogForTests(): void {
	knoxGuiModelCatalog = [];
}

export function knoxGuiSeedModelCatalog(entries: IKnoxGuiModelCatalogEntry[]): void {
	if (!entries.length) {
		return;
	}
	knoxGuiModelCatalog = entries;
}

export function knoxGuiFindCatalogModel(modelId: string): IKnoxGuiModelCatalogEntry | undefined {
	if (!modelId || !knoxGuiModelCatalog.length) {
		return undefined;
	}
	return knoxGuiModelCatalog.find(entry => entry.id === modelId || entry.root === modelId);
}

/** Port of `modelSupportsToolsFromSupportedParameters`. */
export function knoxGuiModelSupportsToolsFromSupportedParameters(supportedParameters: string[] | undefined): boolean {
	if (!supportedParameters?.length) {
		return false;
	}
	return supportedParameters.includes('tools') || supportedParameters.includes('tool_choice');
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || !value.length) {
		return undefined;
	}
	return value.map(item => String(item));
}

export function knoxGuiParseModelCatalog(raw: unknown): IKnoxGuiModelCatalogEntry[] {
	const items = Array.isArray(raw) ? raw : [];
	const entries: IKnoxGuiModelCatalogEntry[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const rec = item as Record<string, unknown>;
		const id = String(rec.id ?? rec.model ?? rec.name ?? '');
		if (!id) {
			continue;
		}
		const root = rec.root != null && rec.root !== '' ? String(rec.root) : undefined;
		const name = rec.name != null ? String(rec.name) : (rec.title != null ? String(rec.title) : undefined);
		entries.push({
			id,
			root,
			name,
			supportedParameters: stringList(rec.supported_parameters) ?? stringList(rec.supportedParameters),
		});
	}
	return entries;
}

export function knoxGuiCatalogEntriesFromOverlayModels(
	models: Array<{ model: string; title?: string; supportedParameters?: string[]; supportsTools?: boolean }>,
): IKnoxGuiModelCatalogEntry[] {
	return models.filter(model => model.model).map(model => ({
		id: model.model,
		name: model.title,
		supportedParameters: model.supportedParameters ?? (model.supportsTools ? ['tools'] : undefined),
	}));
}

function knoxGuiCatalogToolsSupport(model: IKnoxGuiModel): boolean | undefined {
	const ids = [model.model, model.title].filter((id): id is string => Boolean(id));
	for (const id of ids) {
		const cached = knoxGuiFindCatalogModel(id);
		if (cached) {
			return knoxGuiModelSupportsToolsFromSupportedParameters(cached.supportedParameters);
		}
	}
	return undefined;
}

/**
 * KN-371: port of `modelSupportsTools` against the /v1/models cache.
 * Catalog `supported_parameters` wins, then the serialized model, then explicit caps.
 * Provider name (knoxchat/openai/anthropic) is not a tools signal.
 */
export function knoxGuiModelSupportsTools(model: IKnoxGuiModel | undefined): boolean {
	if (!model) {
		return false;
	}
	const fromCatalog = knoxGuiCatalogToolsSupport(model);
	if (fromCatalog !== undefined) {
		return fromCatalog;
	}
	if (knoxGuiModelSupportsToolsFromSupportedParameters(model.supportedParameters)) {
		return true;
	}
	if (model.capabilities?.tools !== undefined) {
		return model.capabilities.tools;
	}
	return false;
}

function hasReasoningEffortParam(model: IKnoxGuiModel): boolean {
	const supported = model.supportedParameters ?? [];
	return supported.includes('reasoning_effort') || supported.includes('reasoningEffort');
}

/**
 * Effort selector requires adjustable effort, matching getReasoningEffortConfig.
 */
export function knoxGuiReasoningEffortConfig(model: IKnoxGuiModel | undefined): IKnoxGuiReasoningEffortConfig | null {
	if (!model || !hasReasoningEffortParam(model)) {
		return null;
	}
	return {
		allowed: [...DEFAULT_REASONING_EFFORT_ALLOWED],
		default: DEFAULT_REASONING_EFFORT,
	};
}

export function knoxGuiResolveReasoningEffort(
	model: IKnoxGuiModel | undefined,
	stickyByModel?: Record<string, string> | null,
	legacySelectedEffort?: string | null,
): string | undefined {
	const config = knoxGuiReasoningEffortConfig(model);
	if (!config || !model) {
		return undefined;
	}
	const keys = [model.title, model.model].filter((key): key is string => Boolean(key));
	for (const key of keys) {
		const sticky = stickyByModel?.[key];
		if (sticky && config.allowed.includes(sticky)) {
			return sticky;
		}
	}
	const stickyEmpty = !stickyByModel || Object.keys(stickyByModel).length === 0;
	if (stickyEmpty && legacySelectedEffort && config.allowed.includes(legacySelectedEffort)) {
		return legacySelectedEffort;
	}
	return config.default;
}

export function knoxGuiModelSelectTitle(model: IKnoxGuiModel | undefined): string {
	if (!model) {
		return '';
	}
	if (model.title) {
		return model.title;
	}
	if (model.model?.trim()) {
		return model.provider ? `${model.provider} - ${model.model}` : model.model;
	}
	return model.provider ?? '';
}

export function knoxGuiNextModelTitle(models: IKnoxGuiModel[], currentTitle: string | undefined, direction: 1 | -1): string | undefined {
	if (!models.length) {
		return undefined;
	}
	const currentIndex = models.findIndex(model => model.title === currentTitle);
	let nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction) % models.length;
	if (nextIndex < 0) {
		nextIndex = models.length - 1;
	}
	return models[nextIndex]?.title;
}
