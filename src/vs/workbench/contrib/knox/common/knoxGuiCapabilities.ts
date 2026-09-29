/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiModel } from './knoxGuiState.js';

/** Native GUI only configures KnoxChat; vision still uses model-name hints. */
export const KNOX_GUI_IMAGE_PROVIDERS = ['knoxchat'];

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
 * KnoxChat /v1/models `architecture.input_modalities`, then explicit caps,
 * then provider + model-name heuristics.
 */
export function knoxGuiModelSupportsImages(model: IKnoxGuiModel | undefined): boolean {
	if (!model) {
		return false;
	}
	if (providerOf(model) === 'knoxchat' || providerOf(model) === '') {
		for (const id of [model.model, model.title].filter((value): value is string => Boolean(value))) {
			const cached = knoxGuiFindCatalogModel(id);
			if (cached?.inputModalities) {
				return cached.inputModalities.includes('image');
			}
		}
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
	inputModalities?: string[];
	reasoning?: {
		supportedEfforts?: string[] | null;
		defaultEffort?: string;
		mandatory?: boolean;
	};
}

/** `core/llm/data/reasoningEffortOverrides.json` — used only when effort is advertised. */
const REASONING_EFFORT_SIDECAR: Record<string, IKnoxGuiReasoningEffortConfig> = {
	'anthropic/claude-sonnet-4.6': { allowed: ['low', 'medium', 'high'], default: 'high' },
	'anthropic/claude-sonnet-5': { allowed: ['low', 'medium', 'high', 'max', 'xhigh'], default: 'high' },
	'anthropic/claude-opus-4.6': { allowed: ['medium', 'high', 'max'], default: 'high' },
	'anthropic/claude-opus-4.7': { allowed: ['high', 'xhigh', 'max'], default: 'xhigh' },
	'anthropic/claude-opus-4.8': { allowed: ['high', 'xhigh', 'max'], default: 'xhigh' },
	'anthropic/claude-opus-5': { allowed: ['high', 'xhigh', 'max'], default: 'xhigh' },
	'anthropic/claude-fable-5': { allowed: ['low', 'medium', 'high', 'max'], default: 'high' },
	'openai/gpt-5.4': { allowed: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'none' },
	'openai/gpt-5.5': { allowed: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'high' },
	'openai/gpt-5.6-luna': { allowed: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'none' },
	'openai/gpt-5.6-terra': { allowed: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'medium' },
	'openai/gpt-5.6-sol': { allowed: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'high' },
};

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
		const architecture = rec.architecture && typeof rec.architecture === 'object' ? rec.architecture as Record<string, unknown> : undefined;
		const reasoning = rec.reasoning && typeof rec.reasoning === 'object' ? rec.reasoning as Record<string, unknown> : undefined;
		const efforts = reasoning?.supported_efforts === null
			? null
			: stringList(reasoning?.supported_efforts);
		entries.push({
			id,
			root,
			name,
			supportedParameters: stringList(rec.supported_parameters) ?? stringList(rec.supportedParameters),
			inputModalities: stringList(architecture?.input_modalities) ?? stringList(rec.input_modalities),
			reasoning: reasoning ? {
				supportedEfforts: efforts,
				defaultEffort: reasoning.default_effort != null ? String(reasoning.default_effort) : undefined,
				mandatory: reasoning.mandatory === true,
			} : undefined,
		});
	}
	return entries;
}

export function knoxGuiCatalogEntriesFromOverlayModels(
	models: Array<{ model: string; title?: string; supportedParameters?: string[]; supportsTools?: boolean; modalities?: string[] }>,
): IKnoxGuiModelCatalogEntry[] {
	return models.filter(model => model.model).map(model => ({
		id: model.model,
		name: model.title,
		supportedParameters: model.supportedParameters ?? (model.supportsTools ? ['tools'] : undefined),
		inputModalities: model.modalities,
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
 * KN-371: catalog / serialized params / explicit caps. `undefined` means the
 * /v1/models cache has not spoken yet — Agent stays the default tab until then.
 */
export function knoxGuiModelToolsSupportKnown(model: IKnoxGuiModel | undefined): boolean | undefined {
	if (!model) {
		return undefined;
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
	return undefined;
}

/** Optimistic Agent default: unknown is the previous tab's toolsSupported. */
export function knoxGuiResolveToolsSupported(known: boolean | undefined, previous: boolean): boolean {
	return known ?? previous;
}

/**
 * KN-371: port of `modelSupportsTools` against the /v1/models cache.
 * Catalog `supported_parameters` wins, then the serialized model, then explicit caps.
 * Provider name is not a tools signal. Unknown is false for capability badges.
 */
export function knoxGuiModelSupportsTools(model: IKnoxGuiModel | undefined): boolean {
	return knoxGuiModelToolsSupportKnown(model) === true;
}

function hasReasoningEffortParam(supportedParameters: string[] | undefined): boolean {
	return !!supportedParameters?.some(p => p === 'reasoning_effort' || p === 'reasoningEffort');
}

function catalogForModel(model: IKnoxGuiModel): IKnoxGuiModelCatalogEntry | undefined {
	for (const id of [model.model, model.title].filter((value): value is string => Boolean(value))) {
		const cached = knoxGuiFindCatalogModel(id);
		if (cached) {
			return cached;
		}
	}
	return undefined;
}

function configFromCatalogReasoning(reasoning: IKnoxGuiModelCatalogEntry['reasoning']): IKnoxGuiReasoningEffortConfig | null {
	if (!reasoning) {
		return null;
	}
	const allowed = reasoning.supportedEfforts === null
		? [...DEFAULT_REASONING_EFFORT_ALLOWED]
		: reasoning.supportedEfforts && reasoning.supportedEfforts.length
			? reasoning.supportedEfforts
			: null;
	if (!allowed) {
		return null;
	}
	const filtered = reasoning.mandatory ? allowed.filter(value => value !== 'none') : allowed;
	const preferred = reasoning.defaultEffort && filtered.includes(reasoning.defaultEffort)
		? reasoning.defaultEffort
		: filtered.includes(DEFAULT_REASONING_EFFORT)
			? DEFAULT_REASONING_EFFORT
			: filtered[0];
	return { allowed: filtered, default: preferred };
}

export function knoxGuiNormalizeReasoningModelId(value: string, provider?: string): string {
	const id = value.trim().toLowerCase();
	const modelProvider = provider?.trim().toLowerCase();
	if (!id) {
		return '';
	}
	if (id.includes('/')) {
		return id;
	}
	if (id.startsWith('gpt-') || modelProvider === 'openai') {
		return `openai/${id}`;
	}
	if (id.startsWith('claude-') || modelProvider === 'anthropic') {
		return `anthropic/${id}`;
	}
	return id;
}

/** Port of GUI `getReasoningModelKeys` for sticky effort prefs. */
export function knoxGuiGetReasoningModelKeys(model: IKnoxGuiModel | undefined): string[] {
	if (!model) {
		return [];
	}
	const keys: string[] = [];
	const add = (value?: string) => {
		if (value && !keys.includes(value)) {
			keys.push(value);
		}
	};
	add(model.model ? knoxGuiNormalizeReasoningModelId(model.model, model.provider) : undefined);
	add(model.model);
	add(model.title);
	if (model.title) {
		add(knoxGuiNormalizeReasoningModelId(model.title, model.provider));
	}
	return keys;
}

function supportsReasoningParams(supportedParameters: string[] | undefined): boolean {
	return !!supportedParameters?.some(p => p === 'reasoning' || p === 'reasoning_effort' || p === 'include_reasoning');
}

/** Port of `modelSupportsReasoning`: catalog first, then supported parameters, then capabilities. */
export function knoxGuiModelSupportsReasoning(model: IKnoxGuiModel | undefined): boolean {
	if (!model) {
		return false;
	}
	for (const id of [model.model, model.title].filter((id): id is string => Boolean(id))) {
		const cached = knoxGuiFindCatalogModel(id);
		if (cached) {
			return supportsReasoningParams(cached.supportedParameters);
		}
	}
	if (supportsReasoningParams(model.supportedParameters)) {
		return true;
	}
	return model.capabilities?.reasoning === true;
}

/** Port of `shouldShowThinkingPlaceholder`. */
export function knoxGuiShowsThinkingPlaceholder(model: IKnoxGuiModel | undefined): boolean {
	return !!model && (!!knoxGuiReasoningEffortConfig(model) || knoxGuiModelSupportsReasoning(model));
}

/**
 * Effort selector requires adjustable effort, matching getReasoningEffortConfig.
 * API `reasoning.supported_efforts` → sidecar JSON → gateway default.
 */
export function knoxGuiReasoningEffortConfig(model: IKnoxGuiModel | undefined): IKnoxGuiReasoningEffortConfig | null {
	if (!model) {
		return null;
	}
	const catalog = catalogForModel(model);
	const fromApi = configFromCatalogReasoning(catalog?.reasoning);
	if (fromApi) {
		return fromApi;
	}
	const advertised = hasReasoningEffortParam(model.supportedParameters)
		|| hasReasoningEffortParam(catalog?.supportedParameters)
		|| catalog?.reasoning?.supportedEfforts === null;
	if (!advertised) {
		return null;
	}
	for (const candidate of [model.model, model.title, catalog?.id, catalog?.root].filter((value): value is string => Boolean(value))) {
		const sidecar = REASONING_EFFORT_SIDECAR[knoxGuiNormalizeReasoningModelId(candidate, model.provider)]
			?? REASONING_EFFORT_SIDECAR[candidate.toLowerCase()];
		if (sidecar) {
			return { allowed: [...sidecar.allowed], default: sidecar.default };
		}
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
	for (const key of knoxGuiGetReasoningModelKeys(model)) {
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

/** `ModelSelect.tsx`: models with an empty API key go last, order otherwise kept. */
export function knoxGuiSortModelsByApiKey<T extends { apiKey?: string }>(models: readonly T[]): T[] {
	return [...models.filter(model => model.apiKey !== ''), ...models.filter(model => model.apiKey === '')];
}

/** Headless UI Listbox keys: arrows wrap-free, Home/End jump. `current` is -1 when focus is outside the list. */
export function knoxGuiListboxNextIndex(key: string, current: number, length: number): number | undefined {
	if (!length) {
		return undefined;
	}
	switch (key) {
		case 'ArrowDown':
			return current < 0 ? 0 : Math.min(current + 1, length - 1);
		case 'ArrowUp':
			return current < 0 ? length - 1 : Math.max(current - 1, 0);
		case 'Home':
			return 0;
		case 'End':
			return length - 1;
		default:
			return undefined;
	}
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
