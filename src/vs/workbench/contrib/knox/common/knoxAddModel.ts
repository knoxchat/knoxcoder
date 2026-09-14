/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxModelDescription, KnoxModelRole } from './knoxChatTypes.js';

export const KNOX_CHAT_PROVIDER = 'knoxchat';
export const KNOX_CHAT_PROVIDER_TITLE = 'KnoxChat';
export const KNOX_CHAT_API_KEY_URL = 'https://knox.chat/keys';
export const KNOX_CHAT_API_BASE = 'https://api.knox.chat/v1/';
export const KNOX_CHAT_MS_MODEL_ID = 'knox/knox-ms';

export interface IKnoxModelInputField {
	key: string;
	label: string;
	inputType: 'text' | 'number' | 'password';
	placeholder?: string;
	defaultValue?: string | number;
	required?: boolean;
}

export interface IKnoxModelPricing {
	promptPer1k: number;
	completionPer1k: number;
	image?: number;
	cacheReadPer1k?: number;
	cacheWritePer1k?: number;
	webSearch?: number;
}

export interface IKnoxModelCapabilities {
	tools: boolean;
	uploadImage: boolean;
	imageOutput: boolean;
	reasoning: boolean;
	webSearch: boolean;
}

export interface IKnoxModelPackage {
	title: string;
	description: string;
	providerOptions?: string[];
	params: Record<string, unknown> & {
		title?: string;
		model?: string;
		contextLength?: number;
		completionOptions?: { maxTokens?: number };
		capabilities?: Partial<IKnoxModelCapabilities>;
		supportedParameters?: string[];
		inputModalities?: string[];
		outputModalities?: string[];
		provider?: string;
	};
	category?: string;
	maxTokens?: number;
	modalities?: string[];
	supportsTools?: boolean;
	supportsReasoning?: boolean;
	supportsWebSearch?: boolean;
	supportsImageOutput?: boolean;
	pricing?: IKnoxModelPricing;
}

export type IKnoxCatalogModel = IKnoxModelPackage & {
	category: string;
	params: IKnoxModelPackage['params'] & { title: string; model: string; contextLength: number };
};

export interface IKnoxProviderInfo {
	id: string;
	title: string;
	provider: string;
	description: string;
	longDescription?: string;
	apiKeyUrl?: string;
	packages: IKnoxModelPackage[];
	collectInputFor: IKnoxModelInputField[];
}

export interface IKnoxAddModelDialogOptions {
	modelRole?: KnoxModelRole;
	bulkAdd?: boolean;
}

export type KnoxExperimentalModelRole = 'chat' | 'inlineEdit' | 'applyCodeBlock' | 'summarize' | 'viewRead' | 'realTimeSearch';

export interface IKnoxListedChatModel {
	id: string;
	name: string;
	description?: string;
	context_length?: number;
	developer?: string;
	owned_by?: string;
	supported_parameters?: string[];
	pricing?: {
		prompt?: string | null;
		completion?: string | null;
		image?: string | null;
		input_cache_read?: string | null;
		input_cache_write?: string | null;
		web_search?: string | null;
	};
	pricing_in_display_units?: boolean;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
		tokenizer?: string | null;
	};
	top_provider?: {
		context_length?: number;
		max_completion_tokens?: number | null;
	};
	max_completion_tokens?: number | null;
	provider_info?: { provider_name?: string | null } | null;
}

const DEVELOPER_CATEGORY: Record<string, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
	meta: 'Meta',
	'meta-llama': 'Meta',
	qwen: 'Qwen',
	deepseek: 'DeepSeek',
	mistralai: 'Mistral',
	mistral: 'Mistral',
	xai: 'xAI',
	'x-ai': 'xAI',
	cohere: 'Cohere',
	perplexity: 'Perplexity',
	moonshotai: 'MoonshotAI',
	minimax: 'MiniMax',
	stepfun: 'StepFun',
	nvidia: 'NVIDIA',
	xiaomi: 'Xiaomi',
	'z-ai': 'ChatGLM',
	knox: 'KnoxChat',
};

export const KNOX_PROVIDERS: Record<string, IKnoxProviderInfo> = {
	knoxchat: {
		id: KNOX_CHAT_PROVIDER,
		title: KNOX_CHAT_PROVIDER_TITLE,
		provider: KNOX_CHAT_PROVIDER,
		description: 'Access models from KnoxChat',
		longDescription: 'KnoxChat routes chat, apply, and edit through your Knox account.',
		apiKeyUrl: KNOX_CHAT_API_KEY_URL,
		packages: [],
		collectInputFor: [{
			key: 'apiKey',
			label: 'API Key',
			inputType: 'text',
			placeholder: `Enter your ${KNOX_CHAT_PROVIDER_TITLE} API Key`,
			required: true,
		}],
	},
};

export const KNOX_CHAT_FALLBACK_MODELS: IKnoxCatalogModel[] = [{
	title: 'Knox MS',
	description: 'Knox Memory System Model (Unlimited Context)',
	category: 'KnoxChat',
	params: {
		title: 'Knox MS',
		model: KNOX_CHAT_MS_MODEL_ID,
		contextLength: Number.POSITIVE_INFINITY,
		completionOptions: { maxTokens: 128000 },
		capabilities: {
			tools: true,
			uploadImage: true,
			reasoning: true,
			webSearch: false,
			imageOutput: false,
		},
		provider: KNOX_CHAT_PROVIDER,
	},
	maxTokens: 128000,
	modalities: ['text', 'image', 'file'],
	supportsTools: true,
	supportsReasoning: true,
}];

export function knoxParseListedChatModels(value: unknown): IKnoxListedChatModel[] {
	const list = Array.isArray(value)
		? value
		: (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
			? (value as { data: unknown[] }).data
			: []);
	return list
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map(item => parseListedModel(item))
		.filter(item => item.id.length > 0);
}

export function knoxCategorizeListedModel(model: {
	id?: string;
	name?: string;
	developer?: string;
	owned_by?: string;
	architecture?: { tokenizer?: string | null };
	provider_info?: { provider_name?: string | null } | null;
}): string {
	const developer = (
		model.developer
		|| model.owned_by
		|| model.provider_info?.provider_name
		|| ''
	).toLowerCase();
	if (developer && DEVELOPER_CATEGORY[developer]) {
		return DEVELOPER_CATEGORY[developer];
	}
	const idAndName = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
	const tokenizer = model.architecture?.tokenizer?.toLowerCase() || '';
	if (idAndName.includes('openai') || idAndName.includes('gpt') || tokenizer.includes('gpt')) {
		return 'OpenAI';
	}
	if (idAndName.includes('claude') || idAndName.includes('anthropic') || tokenizer.includes('claude')) {
		return 'Anthropic';
	}
	if (idAndName.includes('llama') || idAndName.includes('meta') || tokenizer.includes('llama')) {
		return 'Meta';
	}
	if (
		idAndName.includes('gemini')
		|| idAndName.includes('palm')
		|| idAndName.includes('google')
		|| idAndName.includes('gemma')
		|| tokenizer.includes('gemini')
		|| tokenizer.includes('gemma')
	) {
		return 'Google';
	}
	if (idAndName.includes('glm') || tokenizer.includes('glm')) {
		return 'ChatGLM';
	}
	if (idAndName.includes('qwen') || tokenizer.includes('qwen')) {
		return 'Qwen';
	}
	if (idAndName.includes('deepseek') || tokenizer.includes('deepseek')) {
		return 'DeepSeek';
	}
	if (idAndName.includes('mistral') || tokenizer.includes('mistral')) {
		return 'Mistral';
	}
	if (idAndName.includes('cohere') || tokenizer.includes('cohere')) {
		return 'Cohere';
	}
	if (idAndName.includes('perplexity') || idAndName.includes('sonar')) {
		return 'Perplexity';
	}
	if (idAndName.includes('grok') || idAndName.includes('x-ai')) {
		return 'xAI';
	}
	if (idAndName.includes('knox')) {
		return 'KnoxChat';
	}
	return 'Other';
}

export function knoxListedModelToPackage(model: IKnoxListedChatModel): IKnoxCatalogModel {
	const enriched = deriveListedModelParams(model);
	const contextLength = enriched.contextLength ?? 180000;
	return {
		title: model.name,
		description: model.description || `Model ID: ${model.id}`,
		category: knoxCategorizeListedModel(model),
		params: {
			title: model.name,
			model: model.id,
			contextLength,
			...(enriched.maxTokens !== undefined ? { completionOptions: { maxTokens: enriched.maxTokens } } : {}),
			capabilities: enriched.capabilities,
			supportedParameters: model.supported_parameters,
			inputModalities: enriched.inputModalities,
			outputModalities: enriched.outputModalities,
			provider: KNOX_CHAT_PROVIDER,
		},
		maxTokens: enriched.maxTokens,
		modalities: enriched.inputModalities,
		supportsTools: enriched.capabilities.tools,
		supportsReasoning: enriched.capabilities.reasoning,
		supportsWebSearch: enriched.capabilities.webSearch,
		supportsImageOutput: enriched.capabilities.imageOutput,
		pricing: enriched.pricing,
	};
}

export function knoxMergeKnoxChatCatalog(listed: readonly IKnoxListedChatModel[]): IKnoxCatalogModel[] {
	const apiModels = listed.map(knoxListedModelToPackage);
	return knoxUniqueCatalogModels([...apiModels, ...KNOX_CHAT_FALLBACK_MODELS]);
}

export function knoxUniqueCatalogModels(models: readonly IKnoxCatalogModel[]): IKnoxCatalogModel[] {
	return models.filter((model, index, self) =>
		index === self.findIndex(item => catalogModelId(item) === catalogModelId(model)));
}

export function knoxFilterCatalogBySearch(models: readonly IKnoxCatalogModel[], search: string): IKnoxCatalogModel[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return [...models];
	}
	return models.filter(model => catalogModelId(model).toLowerCase().includes(term));
}

export function knoxGroupModelPackages(packages: readonly IKnoxModelPackage[]): { title: string; packages: IKnoxModelPackage[] }[] {
	const groups = new Map<string, IKnoxModelPackage[]>();
	for (const pkg of packages) {
		const title = pkg.category ?? 'Other';
		const list = groups.get(title) ?? [];
		list.push(pkg);
		groups.set(title, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => compareCatalogCategories(a, b))
		.map(([title, grouped]) => ({ title, packages: grouped }));
}

export function knoxCatalogModelId(model: IKnoxModelPackage): string {
	return catalogModelId(model);
}

export function knoxConnectDisabled(apiKey: string | undefined): boolean {
	return (apiKey ?? '').trim() === '';
}

export function knoxModelRoleToExperimentalRole(role?: KnoxModelRole): KnoxExperimentalModelRole | undefined {
	if (!role) {
		return undefined;
	}
	if (role === 'edit') {
		return 'inlineEdit';
	}
	if (role === 'apply') {
		return 'applyCodeBlock';
	}
	return role;
}

export function knoxAddModelRoles(options?: IKnoxAddModelDialogOptions): KnoxModelRole[] | undefined {
	if (options?.bulkAdd && options.modelRole === 'chat') {
		return ['chat', 'edit', 'apply'];
	}
	if (options?.modelRole) {
		return [options.modelRole];
	}
	return undefined;
}

export function knoxBuildKnoxChatAddModelPayload(
	pkg: IKnoxModelPackage,
	apiKey: string,
	options?: IKnoxAddModelDialogOptions,
): IKnoxModelDescription {
	const roles = knoxAddModelRoles(options);
	const key = apiKey.trim();
	const model: Record<string, unknown> = {
		...pkg.params,
		provider: KNOX_CHAT_PROVIDER,
		title: String(pkg.params.title ?? pkg.title),
		name: String(pkg.params.title ?? pkg.title),
		...(key ? { apiKey: key } : {}),
		...(roles ? { roles } : {}),
	};
	return model as unknown as IKnoxModelDescription;
}

export function knoxBuildAddModelPayload(
	pkg: IKnoxModelPackage,
	provider: IKnoxProviderInfo,
	form: Record<string, string>,
): IKnoxModelDescription {
	const model: Record<string, unknown> = {
		...pkg.params,
		...providerParamsFromForm(provider, form),
		provider: provider.provider,
		title: String(pkg.params.title ?? pkg.title),
		name: String(pkg.params.title ?? pkg.title),
	};
	return model as unknown as IKnoxModelDescription;
}

export function knoxProviderRequiredMissing(provider: IKnoxProviderInfo, form: Record<string, string>): boolean {
	return provider.collectInputFor.some(field => {
		if (!field.required) {
			return false;
		}
		const value = form[field.key] ?? (field.defaultValue != null ? String(field.defaultValue) : '');
		return value.trim() === '';
	});
}

export function knoxFormatTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens < 0) {
		return '0';
	}
	const suffixes = ['', 'k', 'm', 'b', 't'] as const;
	let scaled = tokens;
	let unitIndex = 0;
	while (scaled >= 1000 && unitIndex < suffixes.length - 1) {
		scaled /= 1000;
		unitIndex += 1;
	}
	if (unitIndex === 0) {
		return String(Math.round(scaled));
	}
	const rounded = scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled);
	if (rounded >= 1000 && unitIndex < suffixes.length - 1) {
		return `1.0${suffixes[unitIndex + 1]}`;
	}
	const text = scaled < 10 && rounded < 10 ? rounded.toFixed(1) : String(rounded);
	return `${text}${suffixes[unitIndex]}`;
}

export function knoxFormatContextBadge(contextLength: number | undefined): string {
	if (contextLength === undefined || !Number.isFinite(contextLength)) {
		return '∞';
	}
	return knoxFormatTokenCount(contextLength);
}

export function knoxFormatModelPricingPerMillion(
	pricing: Pick<IKnoxModelPricing, 'promptPer1k' | 'completionPer1k'>,
): { badge: string; title: string } {
	const prompt = formatUsdAmount(pricing.promptPer1k * 1000);
	const completion = formatUsdAmount(pricing.completionPer1k * 1000);
	return {
		badge: `$${prompt}/${completion}`,
		title: `$${prompt} / $${completion} per 1M tokens`,
	};
}

export function knoxDisplayModalities(modalities: readonly string[] | undefined): string[] {
	return (modalities ?? []).filter(modality => modality !== 'text');
}

function parseListedModel(item: Record<string, unknown>): IKnoxListedChatModel {
	const architecture = asRecord(item.architecture);
	const topProvider = asRecord(item.top_provider);
	const pricing = asRecord(item.pricing);
	const providerInfo = asRecord(item.provider_info);
	return {
		id: String(item.id ?? item.model ?? ''),
		name: String(item.name ?? item.id ?? item.model ?? ''),
		description: typeof item.description === 'string' ? item.description : undefined,
		context_length: asNumber(item.context_length),
		developer: typeof item.developer === 'string' ? item.developer : undefined,
		owned_by: typeof item.owned_by === 'string' ? item.owned_by : undefined,
		supported_parameters: Array.isArray(item.supported_parameters)
			? item.supported_parameters.filter((value): value is string => typeof value === 'string')
			: undefined,
		pricing: pricing ? {
			prompt: asNullableString(pricing.prompt),
			completion: asNullableString(pricing.completion),
			image: asNullableString(pricing.image),
			input_cache_read: asNullableString(pricing.input_cache_read),
			input_cache_write: asNullableString(pricing.input_cache_write),
			web_search: asNullableString(pricing.web_search),
		} : undefined,
		pricing_in_display_units: item.pricing_in_display_units === true,
		architecture: architecture ? {
			input_modalities: asStringArray(architecture.input_modalities),
			output_modalities: asStringArray(architecture.output_modalities),
			tokenizer: typeof architecture.tokenizer === 'string' ? architecture.tokenizer : null,
		} : undefined,
		top_provider: topProvider ? {
			context_length: asNumber(topProvider.context_length),
			max_completion_tokens: asNumber(topProvider.max_completion_tokens) ?? null,
		} : undefined,
		max_completion_tokens: asNumber(item.max_completion_tokens) ?? null,
		provider_info: providerInfo ? {
			provider_name: typeof providerInfo.provider_name === 'string' ? providerInfo.provider_name : null,
		} : undefined,
	};
}

function deriveListedModelParams(model: IKnoxListedChatModel): {
	contextLength: number | undefined;
	maxTokens: number | undefined;
	capabilities: IKnoxModelCapabilities;
	inputModalities?: string[];
	outputModalities?: string[];
	pricing?: IKnoxModelPricing;
} {
	const contextLength = listedContextLength(model);
	const maxCompletion = finitePositiveNumber(model.top_provider?.max_completion_tokens)
		?? finitePositiveNumber(model.max_completion_tokens);
	let maxTokens = maxCompletion;
	if (maxTokens !== undefined && contextLength !== undefined && Number.isFinite(contextLength)) {
		maxTokens = Math.min(maxTokens, Math.floor(contextLength / 4));
	}
	return {
		contextLength: contextLength !== undefined && Number.isFinite(contextLength)
			? contextLength
			: contextLength === Number.POSITIVE_INFINITY
				? Number.POSITIVE_INFINITY
				: 180000,
		maxTokens,
		capabilities: {
			tools: supportsAnyParameter(model.supported_parameters, ['tools', 'tool_choice']),
			uploadImage: model.architecture?.input_modalities?.includes('image') === true,
			imageOutput: model.architecture?.output_modalities?.includes('image') === true,
			reasoning: supportsAnyParameter(model.supported_parameters, ['reasoning', 'reasoning_effort', 'include_reasoning']),
			webSearch: supportsAnyParameter(model.supported_parameters, ['web_search', 'web_search_options'])
				|| parsePricingNumber(model.pricing?.web_search) !== undefined,
		},
		inputModalities: model.architecture?.input_modalities,
		outputModalities: model.architecture?.output_modalities,
		pricing: listedPricing(model),
	};
}

function listedContextLength(model: IKnoxListedChatModel): number | undefined {
	const top = model.top_provider?.context_length;
	const root = model.context_length;
	if (isUnlimitedContext(top) || isUnlimitedContext(root)) {
		return Number.POSITIVE_INFINITY;
	}
	return finitePositiveNumber(top) ?? finitePositiveNumber(root);
}

function listedPricing(model: IKnoxListedChatModel): IKnoxModelPricing | undefined {
	const prompt = parsePricingNumber(model.pricing?.prompt);
	const completion = parsePricingNumber(model.pricing?.completion);
	if (prompt === undefined || completion === undefined) {
		return undefined;
	}
	const scale = (value: number) => model.pricing_in_display_units ? value / 1000 : value * 1000;
	const image = parsePricingNumber(model.pricing?.image);
	const cacheRead = parsePricingNumber(model.pricing?.input_cache_read);
	const cacheWrite = parsePricingNumber(model.pricing?.input_cache_write);
	const webSearch = parsePricingNumber(model.pricing?.web_search);
	return {
		promptPer1k: scale(prompt),
		completionPer1k: scale(completion),
		...(image !== undefined ? { image } : {}),
		...(cacheRead !== undefined ? { cacheReadPer1k: scale(cacheRead) } : {}),
		...(cacheWrite !== undefined ? { cacheWritePer1k: scale(cacheWrite) } : {}),
		...(webSearch !== undefined ? { webSearch } : {}),
	};
}

function catalogModelId(model: IKnoxModelPackage): string {
	return String(model.params.model ?? '');
}

function compareCatalogCategories(a: string, b: string): number {
	if (a === 'Other Models' || a === 'Other') {
		return 1;
	}
	if (b === 'Other Models' || b === 'Other') {
		return -1;
	}
	return a.localeCompare(b);
}

function providerParamsFromForm(provider: IKnoxProviderInfo, form: Record<string, string>): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	for (const field of provider.collectInputFor) {
		const raw = form[field.key];
		if (raw === undefined || raw === '') {
			if (field.defaultValue !== undefined) {
				params[field.key] = field.inputType === 'number' ? Number(field.defaultValue) : field.defaultValue;
			}
			continue;
		}
		params[field.key] = field.inputType === 'number' ? Number(raw) : raw;
	}
	return params;
}

function formatUsdAmount(value: number): string {
	if (!Number.isFinite(value)) {
		return '0';
	}
	if (Math.abs(value - Math.round(value)) < 1e-9) {
		return String(Math.round(value));
	}
	if (Math.abs(value) >= 0.01) {
		return value.toFixed(2).replace(/\.?0+$/, '');
	}
	return value.toFixed(4).replace(/\.?0+$/, '');
}

function supportsAnyParameter(supported: string[] | undefined, parameters: string[]): boolean {
	if (!supported?.length) {
		return false;
	}
	const params = new Set(supported);
	return parameters.some(parameter => params.has(parameter));
}

function finitePositiveNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isUnlimitedContext(value: unknown): boolean {
	return value === -1 || value === Number.POSITIVE_INFINITY;
}

function parsePricingNumber(raw: string | null | undefined): number | undefined {
	if (raw == null || raw === '') {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0 || value === -1) {
		return undefined;
	}
	return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (value === null) {
		return null;
	}
	return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}
