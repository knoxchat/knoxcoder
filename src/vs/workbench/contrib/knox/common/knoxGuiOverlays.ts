/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppResourcePath, FileAccess } from '../../../../base/common/network.js';
import { isAskUserToolName } from './knoxGuiChat.js';
import { knoxGuiRedactSecrets } from './knoxGuiRedact.js';
import { toolPermissionDisplay } from './knoxGuiTools.js';
import {
	IKnoxGuiConfigError,
	IKnoxGuiContextProvider,
	IKnoxGuiHistorySession,
	IKnoxGuiPromptDraft,
	IKnoxGuiRule,
	IKnoxGuiSlashCommand,
	IKnoxGuiSuggestItem,
	IKnoxGuiTool,
	KnoxModelRole,
} from './knoxGuiState.js';
import { isSlashBookmarked } from './knoxGuiInput.js';

/** ModelsSection roles — not embed/autocomplete. */
export const MODEL_OVERLAY_ROLES: KnoxModelRole[] = ['chat', 'edit', 'apply', 'viewRead', 'realTimeSearch'];

export const MODEL_ROLE_LABEL_KEY: Record<KnoxModelRole, string> = {
	chat: 'chatRole',
	edit: 'editRole',
	apply: 'applyRole',
	viewRead: 'viewReadRole',
	realTimeSearch: 'realTimeSearchRole',
};

export const MODEL_ROLE_USED_FOR_KEY: Record<KnoxModelRole, string> = {
	chat: 'usedForChat',
	edit: 'usedForEdit',
	apply: 'usedForApply',
	viewRead: 'usedForViewRead',
	realTimeSearch: 'usedForRealTimeSearch',
};

export const CHAT_FALLBACK_ROLES: KnoxModelRole[] = ['chat', 'apply', 'edit'];

export const AGENT_PROFILE_DEFAULTS: Record<'default' | 'rust' | 'systems', {
	/** 0 = unlimited. */
	maxSteps: number;
	doomLoopThreshold: number;
	verifyMode: 'diagnostics' | 'command';
	verifyCommand: string;
}> = {
	default: { maxSteps: 0, doomLoopThreshold: 3, verifyMode: 'diagnostics', verifyCommand: '' },
	rust: { maxSteps: 0, doomLoopThreshold: 4, verifyMode: 'command', verifyCommand: 'cargo check --workspace --all-targets' },
	systems: { maxSteps: 0, doomLoopThreshold: 5, verifyMode: 'command', verifyCommand: 'make' },
};

/** `UserSettingsForm.tsx`: unset max steps / doom-loop fall back to the profile (`auto` uses default). */
export function agentProfileDefaults(profile: string): typeof AGENT_PROFILE_DEFAULTS['default'] {
	return AGENT_PROFILE_DEFAULTS[profile === 'rust' || profile === 'systems' ? profile : 'default'];
}

export interface IKnoxGuiAddModelInput {
	key: string;
	labelKey: string;
	placeholderKey?: string;
	required?: boolean;
	inputType?: 'text' | 'password' | 'number';
	defaultValue?: string | number;
	min?: number;
	max?: number;
	step?: number;
}

export interface IKnoxGuiPackageDimension {
	name: string;
	description: string;
	options: Record<string, Record<string, unknown>>;
}

export interface IKnoxGuiAddModelPackage {
	title: string;
	description?: string;
	params: { model: string; contextLength?: number; title: string; systemMessage?: string;[key: string]: unknown };
	provider?: string;
	category?: string;
	icon?: string;
	tags?: string[];
	browse?: boolean;
	providerOptions?: string[];
	dimensions?: IKnoxGuiPackageDimension[];
	supportsTools?: boolean;
	supportsReasoning?: boolean;
	supportsWebSearch?: boolean;
}

export interface IKnoxGuiAddModelProvider {
	id: string;
	title: string;
	provider: string;
	descriptionKey: string;
	longDescriptionKey?: string;
	apiKeyUrl?: string;
	icon?: string;
	tags?: string[];
	refPage?: string;
	collectInputFor: IKnoxGuiAddModelInput[];
	packages: IKnoxGuiAddModelPackage[];
	params?: Record<string, unknown>;
}

export interface IKnoxGuiKnoxChatModel {
	title: string;
	description?: string;
	model: string;
	contextLength: number;
	category: string;
	maxTokens?: number;
	supportsTools?: boolean;
	supportsReasoning?: boolean;
	supportsWebSearch?: boolean;
	supportsImageOutput?: boolean;
	/** Input modalities from `architecture.input_modalities`. */
	modalities?: string[];
	pricing?: IKnoxGuiModelPricing;
	supportedParameters?: string[];
}

/** USD per 1K tokens, as in `core/llm/knoxChatModels.ts` `ModelPricingFromApi`. */
export interface IKnoxGuiModelPricing {
	promptPer1k: number;
	completionPer1k: number;
}

function parsePricingNumber(raw: unknown): number | undefined {
	if (raw === null || raw === undefined || raw === '') {
		return undefined;
	}
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** `getModelPricingFromMetadata`: display-unit prices are $/1M, otherwise $/token. */
export function knoxChatModelPricing(pricing: unknown, inDisplayUnits: unknown): IKnoxGuiModelPricing | undefined {
	const rec = pricing && typeof pricing === 'object' ? pricing as Record<string, unknown> : undefined;
	const prompt = parsePricingNumber(rec?.prompt);
	const completion = parsePricingNumber(rec?.completion);
	if (prompt === undefined || completion === undefined) {
		return undefined;
	}
	const scale = (value: number) => inDisplayUnits === true ? value / 1000 : value * 1000;
	return { promptPer1k: scale(prompt), completionPer1k: scale(completion) };
}

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function openRouterTokenPriceSum(pricing: unknown): number {
	const rec = asObjectRecord(pricing);
	const prompt = parsePricingNumber(rec?.prompt);
	const completion = parsePricingNumber(rec?.completion);
	if (prompt === undefined || completion === undefined) {
		return Number.POSITIVE_INFINITY;
	}
	return prompt + completion;
}

/**
 * OpenRouter `GET /api/v1/models` lists both a canonical slug (typical provider
 * list price) and a `~*-latest` alias whose `pricing` is the floor / advertised
 * rate. Copy cheaper alias pricing onto the alias target so the picker badge
 * matches the models endpoint (and openrouter.ai) instead of the median list.
 */
export function applyOpenRouterAliasFloorPricing(models: unknown[]): unknown[] {
	const floorByTarget = new Map<string, unknown>();
	for (const item of models) {
		const rec = asObjectRecord(item);
		const target = asObjectRecord(rec?.alias_target);
		const slug = typeof target?.slug === 'string' ? target.slug : undefined;
		if (!rec || !slug || rec.pricing == null) {
			continue;
		}
		const existing = floorByTarget.get(slug);
		if (openRouterTokenPriceSum(rec.pricing) < openRouterTokenPriceSum(existing)) {
			floorByTarget.set(slug, rec.pricing);
		}
	}
	if (floorByTarget.size === 0) {
		return models;
	}
	return models.map(item => {
		const rec = asObjectRecord(item);
		const id = typeof rec?.id === 'string' ? rec.id : undefined;
		const floor = id ? floorByTarget.get(id) : undefined;
		if (!rec || floor === undefined) {
			return item;
		}
		if (openRouterTokenPriceSum(floor) >= openRouterTokenPriceSum(rec.pricing)) {
			return item;
		}
		return { ...rec, pricing: floor };
	});
}

function finitePositiveNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isUnlimitedContext(value: unknown): boolean {
	return value === -1 || value === Number.POSITIVE_INFINITY;
}

/** `getMetadataContextLength`: `top_provider` wins, `-1` means unlimited. */
export function knoxChatMetadataContextLength(metadata: Record<string, unknown>): number | undefined {
	const topProvider = metadata.top_provider && typeof metadata.top_provider === 'object' ? metadata.top_provider as Record<string, unknown> : undefined;
	const top = topProvider?.context_length;
	const root = metadata.context_length ?? metadata.contextLength;
	if (isUnlimitedContext(top) || isUnlimitedContext(root)) {
		return Number.POSITIVE_INFINITY;
	}
	return finitePositiveNumber(top) ?? finitePositiveNumber(root);
}

/** `getRecommendedMaxTokens`: API max completion tokens, capped to a quarter of a finite context. */
export function knoxChatRecommendedMaxTokens(metadata: Record<string, unknown>): number | undefined {
	const topProvider = metadata.top_provider && typeof metadata.top_provider === 'object' ? metadata.top_provider as Record<string, unknown> : undefined;
	const maxCompletion = finitePositiveNumber(topProvider?.max_completion_tokens) ?? finitePositiveNumber(metadata.max_completion_tokens);
	if (maxCompletion === undefined) {
		return undefined;
	}
	const contextLength = knoxChatMetadataContextLength(metadata);
	if (contextLength !== undefined && Number.isFinite(contextLength)) {
		return Math.min(maxCompletion, Math.floor(contextLength / 4));
	}
	return maxCompletion;
}

export function knoxChatPricingHasWebSearch(pricing: unknown): boolean {
	const rec = pricing && typeof pricing === 'object' ? pricing as Record<string, unknown> : undefined;
	return parsePricingNumber(rec?.web_search) !== undefined;
}

export function formatUsdAmount(value: number): string {
	if (!Number.isFinite(value)) {
		return '0';
	}
	if (Math.abs(value - Math.round(value)) < 1e-9) {
		return String(Math.round(value));
	}
	if (Math.abs(value) >= 1) {
		return value.toFixed(2).replace(/\.?0+$/, '');
	}
	// Keep up to 4 decimals for sub-dollar $/1M rates (e.g. OpenRouter 0.2475).
	return value.toFixed(4).replace(/\.?0+$/, '');
}

export function formatModelPricingPerMillion(pricing: IKnoxGuiModelPricing): { badge: string; title: string } {
	const prompt = formatUsdAmount(pricing.promptPer1k * 1000);
	const completion = formatUsdAmount(pricing.completionPer1k * 1000);
	return { badge: `$${prompt}/${completion}`, title: `$${prompt} / $${completion} per 1M tokens` };
}

const API_KEY_INPUT: IKnoxGuiAddModelInput = {
	key: 'apiKey',
	labelKey: 'apiKeyLabel',
	placeholderKey: 'enterApiKey',
	required: true,
	inputType: 'password',
};

const API_BASE_INPUT: IKnoxGuiAddModelInput = {
	key: 'apiBase',
	labelKey: 'apiBase',
	placeholderKey: 'apiBase',
	required: false,
	inputType: 'text',
	defaultValue: 'https://api.knoxstudio.ai/v1/',
};

/** Matches completionParamsInputs — nested keys merge via setPathValue. */
export const COMPLETION_PARAMS_INPUTS: IKnoxGuiAddModelInput[] = [
	{ key: 'contextLength', labelKey: 'contextLength', inputType: 'number', required: false },
	{ key: 'completionOptions.temperature', labelKey: 'temperature', inputType: 'number', required: false, min: 0, max: 1, step: 0.01 },
	{ key: 'completionOptions.topP', labelKey: 'topP', inputType: 'number', required: false, min: 0, max: 1, step: 0.01 },
	{ key: 'completionOptions.topK', labelKey: 'topK', inputType: 'number', required: false, min: 0, step: 1 },
	{ key: 'completionOptions.presencePenalty', labelKey: 'presencePenalty', inputType: 'number', required: false, min: 0, max: 1, step: 0.01 },
	{ key: 'completionOptions.frequencyPenalty', labelKey: 'frequencyPenalty', inputType: 'number', required: false, min: 0, max: 1, step: 0.01 },
];

export const KNOX_CHAT_FALLBACK_MODELS: IKnoxGuiKnoxChatModel[] = [{
	title: 'Knox MS',
	description: 'Knox Memory System Model (Unlimited Context)',
	model: 'knox/knox-ms',
	contextLength: Number.POSITIVE_INFINITY,
	category: 'KnoxStudio',
	maxTokens: 128000,
	modalities: ['text', 'image', 'file'],
	supportsTools: true,
	supportsReasoning: true,
	supportedParameters: ['tools', 'tool_choice', 'reasoning', 'reasoning_effort'],
}];

const KNOXCHAT_DEVELOPER_CATEGORY: Record<string, string> = {
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
	knox: 'KnoxStudio',
};

export const ADD_MODEL_PROVIDERS: IKnoxGuiAddModelProvider[] = [
	{
		id: 'knoxchat',
		title: 'KnoxStudio',
		provider: 'knoxchat',
		descriptionKey: 'accessModelsDescription',
		longDescriptionKey: 'knoxchatLongDescription',
		icon: 'knoxchat.png',
		tags: ['tagApiKeyRequired'],
		apiKeyUrl: 'https://knoxstudio.ai/keys',
		collectInputFor: [{ ...API_KEY_INPUT, required: false }, ...COMPLETION_PARAMS_INPUTS, API_BASE_INPUT],
		packages: [{
			title: 'KnoxStudio',
			description: 'Models from KnoxStudio',
			params: { title: 'KnoxStudio', model: 'openai/gpt-6-luna', contextLength: 1050000 },
		}],
		params: { contextLength: 128000 },
	},
	{
		id: 'openrouter',
		title: 'OpenRouter',
		provider: 'openrouter',
		descriptionKey: 'openrouterDescription',
		longDescriptionKey: 'openrouterLongDescription',
		icon: 'openrouter.svg',
		tags: ['tagApiKeyRequired'],
		apiKeyUrl: 'https://openrouter.ai/keys',
		collectInputFor: [
			{ ...API_KEY_INPUT, required: false },
			...COMPLETION_PARAMS_INPUTS,
			{ ...API_BASE_INPUT, defaultValue: 'https://openrouter.ai/api/v1/' },
		],
		packages: [{
			title: 'OpenRouter',
			description: 'Models from OpenRouter',
			params: { title: 'OpenRouter', model: 'openai/gpt-6-luna', contextLength: 1050000 },
		}],
		params: { contextLength: 128000 },
	},
	{
		id: 'openai',
		title: 'OpenAI',
		provider: 'openai',
		descriptionKey: 'openaiDescription',
		longDescriptionKey: 'openaiLongDescription',
		icon: 'openai.svg',
		tags: ['tagApiKeyRequired'],
		apiKeyUrl: 'https://platform.openai.com/account/api-keys',
		collectInputFor: [API_KEY_INPUT, ...COMPLETION_PARAMS_INPUTS],
		packages: [
			{ title: 'GPT-6.1 Sol', description: 'OpenAI\'s most capable model, with a 1M-token context window and image input.', providerOptions: ['openai'], browse: true, params: { title: 'GPT-6.1 Sol', model: 'gpt-6.1-sol', contextLength: 1050000, systemMessage: 'You are an expert software developer. You give helpful and concise responses.' } },
			{ title: 'GPT-6 Luna', description: 'A fast, low-cost model with a 1M-token context window and image input.', providerOptions: ['openai'], browse: true, params: { title: 'GPT-6 Luna', model: 'gpt-6-luna', contextLength: 1050000, systemMessage: 'You are an expert software developer. You give helpful and concise responses.' } },
			{ title: 'Autodetect', description: 'Automatically populate the model list by calling the /models endpoint of the server', params: { title: 'OpenAI', model: 'AUTODETECT' } },
		],
		params: { contextLength: 128000 },
	},
	{
		id: 'anthropic',
		title: 'Anthropic',
		provider: 'anthropic',
		descriptionKey: 'anthropicDescription',
		longDescriptionKey: 'anthropicLongDescription',
		icon: 'anthropic.svg',
		tags: ['tagApiKeyRequired'],
		refPage: 'anthropicllm',
		apiKeyUrl: 'https://console.anthropic.com/account/keys',
		collectInputFor: [API_KEY_INPUT, ...COMPLETION_PARAMS_INPUTS, { key: 'contextLength', labelKey: 'contextLength', inputType: 'number', required: false, defaultValue: 100000 }],
		packages: [
			{ title: 'Claude Sonnet 5.5', description: 'Anthropic\'s balanced model for coding and agents, with a 1M-token context window.', providerOptions: ['anthropic'], browse: true, params: { title: 'Claude Sonnet 5.5', model: 'claude-sonnet-5.5', contextLength: 1000000 } },
			{ title: 'Claude Opus 5.5', description: 'Anthropic\'s most capable model, with a 1M-token context window.', providerOptions: ['anthropic'], browse: true, params: { title: 'Claude Opus 5.5', model: 'claude-opus-5.5', contextLength: 1000000 } },
			{ title: 'Claude Haiku 4.5', description: 'The fastest Claude model: a compact model for near-instant responsiveness.', providerOptions: ['anthropic'], browse: true, params: { title: 'Claude Haiku 4.5', model: 'claude-haiku-4.5', contextLength: 200000 } },
		],
		params: { contextLength: 1000000 },
	},
];

const CATALOG_ONLY_ADD_MODEL_PROVIDERS = new Set(['knoxchat', 'openrouter']);

export function addModelPackagesByProvider(): Array<{ providerId: string; title: string; icon?: string; packages: IKnoxGuiAddModelPackage[] }> {
	return ADD_MODEL_PROVIDERS
		.filter(provider => !CATALOG_ONLY_ADD_MODEL_PROVIDERS.has(provider.id))
		.map(provider => ({ providerId: provider.id, title: provider.title, icon: provider.icon, packages: provider.packages }));
}

/** Curated browse-by-model list from `AddNewModel.tsx` `modelsByProvider`. */
const ADD_MODEL_BROWSE_ORDER: Record<string, string[]> = {
	openai: ['gpt-6.1-sol', 'gpt-6-luna'],
	anthropic: ['claude-sonnet-5.5', 'claude-opus-5.5', 'claude-haiku-4.5'],
};

export function addModelBrowseGroups(): Array<{ providerId: string; title: string; icon?: string; packages: IKnoxGuiAddModelPackage[] }> {
	return ADD_MODEL_PROVIDERS
		.filter(provider => !CATALOG_ONLY_ADD_MODEL_PROVIDERS.has(provider.id))
		.map(provider => {
			const byModel = new Map(provider.packages.map(pack => [pack.params.model, pack]));
			const packages = (ADD_MODEL_BROWSE_ORDER[provider.id] ?? provider.packages.filter(pack => pack.browse).map(pack => pack.params.model))
				.map(model => byModel.get(model))
				.filter((pack): pack is IKnoxGuiAddModelPackage => Boolean(pack));
			return {
				providerId: provider.id,
				title: provider.id === 'openai' ? 'Open AI' : provider.title,
				icon: provider.icon,
				packages,
			};
		})
		.filter(group => group.packages.length > 0);
}

export function addModelProviderById(id: string | undefined): IKnoxGuiAddModelProvider | undefined {
	return ADD_MODEL_PROVIDERS.find(provider => provider.id === id);
}

export function addModelRequiredSatisfied(provider: IKnoxGuiAddModelProvider, draft: Record<string, string>, oauthConnected: boolean): boolean {
	if (provider.id === 'knoxchat' || provider.id === 'openrouter') {
		return oauthConnected || Boolean(draft.apiKey?.trim());
	}
	return provider.collectInputFor.filter(input => input.required).every(input => Boolean((draft[input.key] ?? '').trim()));
}

/** Matches KnoxChatAccountPane in-progress states. */
export const KNOX_OAUTH_IN_PROGRESS_STATES = ['opening_browser', 'waiting_for_consent', 'exchanging'] as const;

export type KnoxGuiOAuthPane = 'in_progress' | 'connected' | 'disconnected';

/** KnoxChatAccountPane ERROR_KEYS. Cancel is silent. */
export const KNOX_OAUTH_ERROR_I18N_KEYS: Record<string, string> = {
	denied: 'oauthErrorDenied',
	state_mismatch: 'oauthErrorStateMismatch',
	port_in_use: 'oauthErrorPortInUse',
	timeout: 'oauthErrorTimeout',
	expired: 'oauthErrorExpired',
	bind_failed: 'oauthErrorPortInUse',
	open_browser: 'oauthErrorOpenBrowser',
	offline: 'oauthErrorOffline',
	tls: 'oauthErrorTls',
	exchange: 'oauthErrorExchange',
};

export function knoxGuiOAuthPane(state: string | undefined, connected: boolean): KnoxGuiOAuthPane {
	if (state && (KNOX_OAUTH_IN_PROGRESS_STATES as readonly string[]).includes(state)) {
		return 'in_progress';
	}
	return connected ? 'connected' : 'disconnected';
}

const OPENROUTER_OAUTH_ERROR_I18N_KEYS: Record<string, string> = {
	port_in_use: 'oauthErrorOpenRouterPortInUse',
	bind_failed: 'oauthErrorOpenRouterPortInUse',
	offline: 'oauthErrorOpenRouterOffline',
	tls: 'oauthErrorOpenRouterTls',
	exchange: 'oauthErrorOpenRouterExchange',
};

export function knoxGuiOAuthErrorI18nKey(state: string | undefined, error: string | undefined, source: 'knoxchat' | 'openrouter' = 'knoxchat'): string | undefined {
	if (state !== 'failed' || !error || error === 'cancelled') {
		return undefined;
	}
	if (source === 'openrouter') {
		return OPENROUTER_OAUTH_ERROR_I18N_KEYS[error] ?? KNOX_OAUTH_ERROR_I18N_KEYS[error];
	}
	return KNOX_OAUTH_ERROR_I18N_KEYS[error];
}

export function knoxGuiOAuthHandle(account: Record<string, unknown> | undefined, fallbackHandle?: unknown): string | undefined {
	const username = typeof account?.username === 'string' ? account.username.trim() : '';
	if (username) {
		return `@${username}`;
	}
	if (typeof account?.userId === 'number') {
		return `user ${account.userId}`;
	}
	if (fallbackHandle !== undefined && fallbackHandle !== null && String(fallbackHandle).trim()) {
		return String(fallbackHandle);
	}
	return undefined;
}

export function parseKnoxOAuthStatus(data: unknown): {
	oauthStatus?: string;
	oauthHandle?: string;
	oauthConnected: boolean;
	oauthError?: string;
} {
	const rec = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
	const account = rec?.account && typeof rec.account === 'object' && !Array.isArray(rec.account)
		? rec.account as Record<string, unknown>
		: undefined;
	const state = rec ? String(rec.state ?? rec.status ?? '') : undefined;
	const error = typeof rec?.error === 'string' ? rec.error : undefined;
	return {
		oauthStatus: state,
		oauthHandle: knoxGuiOAuthHandle(account, rec?.handle),
		oauthConnected: Boolean(account),
		oauthError: knoxGuiOAuthErrorI18nKey(state, error) ? error : undefined,
	};
}

export function knoxGuiOpenRouterOAuthHandle(account: Record<string, unknown> | undefined): string | undefined {
	const label = typeof account?.label === 'string' ? account.label.trim() : '';
	if (label) {
		return label;
	}
	const creator = typeof account?.creatorUserId === 'string' ? account.creatorUserId.trim() : '';
	if (creator) {
		return creator.length > 12 ? `${creator.slice(0, 8)}…` : creator;
	}
	return undefined;
}

export function knoxGuiOpenRouterKeySettingsUrl(keyHash: string): string {
	return `https://openrouter.ai/keys/${encodeURIComponent(keyHash)}`;
}

export function knoxGuiOpenRouterKeyLogsUrl(keyHash: string): string {
	return `https://openrouter.ai/logs?api_key_hash=${encodeURIComponent(keyHash)}`;
}

export function parseOpenRouterOAuthStatus(data: unknown): {
	openrouterOauthStatus?: string;
	openrouterOauthHandle?: string;
	openrouterOauthConnected: boolean;
	openrouterOauthError?: string;
	openrouterOauthKeyHash?: string;
} {
	const rec = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
	const account = rec?.account && typeof rec.account === 'object' && !Array.isArray(rec.account)
		? rec.account as Record<string, unknown>
		: undefined;
	const state = rec ? String(rec.state ?? rec.status ?? '') : undefined;
	const error = typeof rec?.error === 'string' ? rec.error : undefined;
	const keyHash = typeof account?.keyHash === 'string' ? account.keyHash.trim() : '';
	return {
		openrouterOauthStatus: state,
		openrouterOauthHandle: knoxGuiOpenRouterOAuthHandle(account),
		openrouterOauthConnected: Boolean(account),
		openrouterOauthError: knoxGuiOAuthErrorI18nKey(state, error, 'openrouter') ? error : undefined,
		openrouterOauthKeyHash: keyHash || undefined,
	};
}

/** lodash-style path set used by `updatedObj` for `completionOptions.temperature`. */
export function setPathValue(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
	const parts = path.split('.');
	if (parts.length === 1) {
		target[path] = value;
		return target;
	}
	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		const next = cursor[key];
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			cursor[key] = {};
		}
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[parts[parts.length - 1]] = value;
	return target;
}

export function mergeRecords(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	for (const [key, value] of Object.entries(source)) {
		const current = target[key];
		if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
			mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>);
		} else {
			target[key] = value;
		}
	}
	return target;
}

/** ModelCard → `_.merge({}, ...dimension.options[choice])`. */
export function mergeDimensionOptions(dimensions: IKnoxGuiPackageDimension[] | undefined, choices: string[] | undefined): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	if (!dimensions?.length) {
		return merged;
	}
	for (let i = 0; i < dimensions.length; i += 1) {
		const keys = Object.keys(dimensions[i].options);
		const choice = choices?.[i] ?? keys[0];
		if (!choice || !dimensions[i].options[choice]) {
			continue;
		}
		mergeRecords(merged, dimensions[i].options[choice]);
	}
	return merged;
}

export function knoxGuiProviderLogoUri(icon: string | undefined): string | undefined {
	if (!icon) {
		return undefined;
	}
	try {
		return FileAccess.asBrowserUri(`vs/workbench/contrib/knox/browser/media/logos/${icon}` as AppResourcePath).toString(true);
	} catch {
		return `vs/workbench/contrib/knox/browser/media/logos/${icon}`;
	}
}

export function buildAddModelPayload(
	provider: IKnoxGuiAddModelProvider,
	pack: IKnoxGuiAddModelPackage,
	draft: Record<string, string>,
	role?: KnoxModelRole,
	extras?: { dimensionChoices?: string[]; selectedProvider?: string; bulk?: boolean },
): { model: Record<string, unknown>; role?: KnoxModelRole } {
	const selected = extras?.selectedProvider ? addModelProviderById(extras.selectedProvider) : undefined;
	const model: Record<string, unknown> = {
		...provider.params,
		...pack.params,
		...mergeDimensionOptions(pack.dimensions, extras?.dimensionChoices),
		provider: selected?.provider ?? provider.provider,
		title: pack.params.title ?? pack.title,
		name: pack.params.title ?? pack.title,
	};
	for (const input of provider.collectInputFor) {
		const raw = draft[input.key];
		if (raw === undefined || raw === '') {
			continue;
		}
		if ((provider.id === 'knoxchat' || provider.id === 'openrouter') && input.key === 'apiKey' && !raw.trim()) {
			continue;
		}
		setPathValue(model, input.key, input.inputType === 'number' ? Number(raw) : raw);
	}
	if (role) {
		model.roles = extras?.bulk && role === 'chat' ? ['chat', 'edit', 'apply'] : [role];
	}
	return { model, role };
}

export function categorizeKnoxChatModel(model: { id?: string; name?: string; title?: string; developer?: string; owned_by?: string; tokenizer?: string }): string {
	const developer = (model.developer || model.owned_by || '').toLowerCase();
	if (developer && KNOXCHAT_DEVELOPER_CATEGORY[developer]) {
		return KNOXCHAT_DEVELOPER_CATEGORY[developer];
	}
	const idAndName = `${model.id ?? ''} ${model.name ?? model.title ?? ''}`.toLowerCase();
	const tokenizer = (model.tokenizer ?? '').toLowerCase();
	if (idAndName.includes('openai') || idAndName.includes('gpt') || tokenizer.includes('gpt')) {
		return 'OpenAI';
	}
	if (idAndName.includes('claude') || idAndName.includes('anthropic') || tokenizer.includes('claude')) {
		return 'Anthropic';
	}
	if (idAndName.includes('llama') || idAndName.includes('meta') || tokenizer.includes('llama')) {
		return 'Meta';
	}
	if (idAndName.includes('gemini') || idAndName.includes('palm') || idAndName.includes('google') || idAndName.includes('gemma')) {
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
		return 'KnoxStudio';
	}
	return 'Other';
}

export function groupKnoxChatModels<T extends { category?: string; title: string }>(models: T[]): Array<{ category: string; models: T[] }> {
	const grouped: Record<string, T[]> = {};
	for (const model of models) {
		const category = model.category || 'Other';
		(grouped[category] ??= []).push(model);
	}
	return Object.keys(grouped)
		.sort((a, b) => {
			if (a === 'Other' || a === 'Other Models') {
				return 1;
			}
			if (b === 'Other' || b === 'Other Models') {
				return -1;
			}
			return a.localeCompare(b);
		})
		.map(category => ({ category, models: grouped[category] }));
}

export function knoxChatModelMatchesQuery(
	model: { title: string; model?: string; category?: string; description?: string; modalities?: string[] },
	query: string,
): boolean {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!tokens.length) {
		return true;
	}
	const haystack = [model.title, model.model, model.category, model.description, ...(model.modalities ?? [])]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	return tokens.every(token => haystack.includes(token));
}

export function filterKnoxChatModels<T extends { title: string; model?: string; category?: string; description?: string; modalities?: string[] }>(models: T[], query: string): T[] {
	if (!query.trim()) {
		return models;
	}
	return models.filter(model => knoxChatModelMatchesQuery(model, query));
}

export function mergeReasoningEffortPrefs(
	disk: { lastEffort?: string; byModel?: Record<string, string> },
	local: { lastEffort?: string; byModel?: Record<string, string> },
	modelTitle?: string,
): { lastEffort?: string; byModel: Record<string, string>; shouldWriteDisk: boolean } {
	const diskByModel = disk.byModel ?? {};
	const localByModel = local.byModel ?? {};
	const diskEmpty = !disk.lastEffort && Object.keys(diskByModel).length === 0;
	const localHasData = Boolean(local.lastEffort) || Object.keys(localByModel).length > 0;
	const byModel = { ...diskByModel, ...localByModel };
	const lastEffort = local.lastEffort ?? disk.lastEffort;
	const forModel = modelTitle ? byModel[modelTitle] : undefined;
	return {
		lastEffort: forModel ?? lastEffort,
		byModel,
		shouldWriteDisk: diskEmpty && localHasData,
	};
}

export function reasoningEffortLabelKey(effort: string): string {
	const map: Record<string, string> = {
		none: 'reasoningEffortLevelNone',
		minimal: 'reasoningEffortLevelMinimal',
		low: 'reasoningEffortLevelLow',
		medium: 'reasoningEffortLevelMedium',
		high: 'reasoningEffortLevelHigh',
		xhigh: 'reasoningEffortLevelXHigh',
		'x-high': 'reasoningEffortLevelXHigh',
		max: 'reasoningEffortLevelMax',
	};
	return map[effort.toLowerCase()] ?? '';
}

export const MEMORY_CYCLE_PHASES = [
	{ id: 'sensory_input', labelKey: 'memoryPhaseSensory' },
	{ id: 'encoding', labelKey: 'memoryPhaseEncoding' },
	{ id: 'working_memory', labelKey: 'memoryPhaseWorking' },
	{ id: 'consolidation', labelKey: 'memoryPhaseConsolidation' },
	{ id: 'long_term_storage', labelKey: 'memoryPhaseLongTerm' },
	{ id: 'retrieval', labelKey: 'memoryPhaseRetrieval' },
	{ id: 'sleep_consolidation', labelKey: 'memoryPhaseSleep' },
	{ id: 'output_generation', labelKey: 'memoryPhaseOutput' },
] as const;

export const MEMORY_TAB_IDS = ['overview', 'memories', 'sessions', 'graph', 'settings'] as const;
export type KnoxMemoryTabId = typeof MEMORY_TAB_IDS[number];

export function isMemoryTabId(value: unknown): value is KnoxMemoryTabId {
	return typeof value === 'string' && (MEMORY_TAB_IDS as readonly string[]).includes(value);
}

export const HISTORY_DATE_SECTIONS = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlierConversations'] as const;
export type KnoxHistoryDateSection = typeof HISTORY_DATE_SECTIONS[number];

export interface IKnoxHistoryDateGroup {
	header: KnoxHistoryDateSection | 'pinned';
	sessions: IKnoxGuiHistorySession[];
}

export function parseHistoryDate(date: string): Date {
	let parsed = new Date(date);
	if (isNaN(parsed.getTime())) {
		parsed = new Date(parseInt(date, 10));
	}
	return parsed;
}

function startOfLocalDay(now: number): number {
	const date = new Date(now);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function addLocalDays(start: number, days: number): number {
	const date = new Date(start);
	date.setDate(date.getDate() + days);
	return date.getTime();
}

/** Calendar buckets used by History.tsx / Cursor conversation history. */
export function historyDateSection(time: number, now = Date.now()): KnoxHistoryDateSection {
	if (isNaN(time)) {
		return 'earlierConversations';
	}
	const todayStart = startOfLocalDay(now);
	if (time >= todayStart) {
		return 'today';
	}
	if (time >= addLocalDays(todayStart, -1)) {
		return 'yesterday';
	}
	if (time >= addLocalDays(todayStart, -7)) {
		return 'thisWeek';
	}
	if (time >= addLocalDays(todayStart, -30)) {
		return 'thisMonth';
	}
	return 'earlierConversations';
}

export function formatSessionDate(date: Date, compact = false): string {
	if (isNaN(date.getTime())) {
		return '';
	}
	return date.toLocaleString(undefined, {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		year: compact ? '2-digit' : 'numeric',
	});
}

export function workspaceBasename(workspaceDirectory: string | undefined): string {
	if (!workspaceDirectory) {
		return '';
	}
	const trimmed = workspaceDirectory.replace(/\/+$/, '').replace(/^file:\/\//, '');
	const parts = trimmed.split(/[/\\]/);
	return parts[parts.length - 1] || trimmed;
}

const MINISEARCH_SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

function miniSearchTerms(text: string): string[] {
	return text.split(MINISEARCH_SPACE_OR_PUNCTUATION).map(term => term.toLowerCase()).filter(Boolean);
}

/**
 * MiniSearch `search(query, { fuzzy: 0.1, prefix: true })` over a text field:
 * OR of query terms, each matching a field term by prefix or within
 * `round(0.1 * length)` edits (max 6).
 */
export function fuzzyTitleMatch(title: string, query: string): boolean {
	const queryTerms = miniSearchTerms(query);
	if (!queryTerms.length) {
		return !query.trim();
	}
	const titleTerms = miniSearchTerms(title);
	return queryTerms.some(term => {
		const maxDistance = Math.min(6, Math.round(term.length * 0.1));
		return titleTerms.some(candidate => candidate === term || candidate.startsWith(term) || (maxDistance > 0 && Math.abs(candidate.length - term.length) <= maxDistance && levenshtein(candidate, term) <= maxDistance));
	});
}

function levenshtein(a: string, b: string): number {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dp: number[] = new Array(rows * cols).fill(0);
	for (let i = 0; i < rows; i++) {
		dp[i * cols] = i;
	}
	for (let j = 0; j < cols; j++) {
		dp[j] = j;
	}
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i * cols + j] = Math.min(
				dp[(i - 1) * cols + j] + 1,
				dp[i * cols + j - 1] + 1,
				dp[(i - 1) * cols + j - 1] + cost,
			);
		}
	}
	return dp[a.length * cols + b.length];
}

export function historySessionMatchesQuery(session: IKnoxGuiHistorySession, query: string): boolean {
	if (!query.trim()) {
		return true;
	}
	if (fuzzyTitleMatch(session.title, query)) {
		return true;
	}
	const workspace = workspaceBasename(session.workspaceDirectory);
	return Boolean(workspace) && fuzzyTitleMatch(workspace, query);
}

export function filterHistorySessions(sessions: IKnoxGuiHistorySession[], query: string): IKnoxGuiHistorySession[] {
	const matched = sessions.filter(session => historySessionMatchesQuery(session, query));
	return matched.sort((a, b) => parseHistoryDate(b.date).getTime() - parseHistoryDate(a.date).getTime());
}

export function groupHistoryByDate(sessions: IKnoxGuiHistorySession[], now = Date.now()): IKnoxHistoryDateGroup[] {
	const buckets: Record<KnoxHistoryDateSection, IKnoxGuiHistorySession[]> = {
		today: [],
		yesterday: [],
		thisWeek: [],
		thisMonth: [],
		earlierConversations: [],
	};
	const pinned: IKnoxGuiHistorySession[] = [];
	for (const session of sessions) {
		if (session.pinned) {
			pinned.push(session);
			continue;
		}
		buckets[historyDateSection(parseHistoryDate(session.date).getTime(), now)].push(session);
	}
	const groups: IKnoxHistoryDateGroup[] = HISTORY_DATE_SECTIONS
		.filter(header => buckets[header].length)
		.map(header => ({ header, sessions: buckets[header] }));
	return pinned.length ? [{ header: 'pinned', sessions: pinned }, ...groups] : groups;
}

export function toggleHistorySelection(selected: readonly string[], id: string, on: boolean): string[] {
	if (on) {
		return selected.includes(id) ? [...selected] : [...selected, id];
	}
	return selected.filter(item => item !== id);
}

export function selectHistoryIdRange(orderedIds: readonly string[], fromId: string, toId: string): string[] {
	const startIndex = orderedIds.indexOf(fromId);
	const endIndex = orderedIds.indexOf(toId);
	if (startIndex < 0 && endIndex < 0) {
		return [];
	}
	if (startIndex < 0) {
		return [toId];
	}
	if (endIndex < 0) {
		return [fromId];
	}
	const start = Math.min(startIndex, endIndex);
	const end = Math.max(startIndex, endIndex);
	return orderedIds.slice(start, end + 1);
}

export function applyHistoryRowSelection(
	selected: readonly string[],
	orderedIds: readonly string[],
	id: string,
	shift: boolean,
	anchorId: string | null,
): { selected: string[]; anchorId: string } {
	if (shift && anchorId) {
		return { selected: selectHistoryIdRange(orderedIds, anchorId, id), anchorId };
	}
	return { selected: toggleHistorySelection(selected, id, !selected.includes(id)), anchorId: id };
}

export function sortPromptsBookmarkedFirst(commands: IKnoxGuiSlashCommand[], bookmarked: string[]): IKnoxGuiSlashCommand[] {
	return [...commands].sort((a, b) => {
		const aBookmarked = isSlashBookmarked(bookmarked, a.name);
		const bBookmarked = isSlashBookmarked(bookmarked, b.name);
		if (aBookmarked && !bBookmarked) {
			return -1;
		}
		if (!aBookmarked && bBookmarked) {
			return 1;
		}
		return 0;
	});
}

export function formatPromptCommandName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return '';
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function promptDraftIsValid(draft: IKnoxGuiPromptDraft | undefined): boolean {
	return Boolean(draft?.name.trim() && draft.description.trim() && draft.prompt.trim());
}

export function promptSlashName(command: string): string {
	return command.startsWith('/') ? command : `/${command}`;
}

export function emptyPromptDraft(): IKnoxGuiPromptDraft {
	return { name: '', description: '', prompt: '', existing: false };
}

export function promptDraftFromCommand(command: IKnoxGuiSlashCommand): IKnoxGuiPromptDraft {
	return { name: command.name, description: command.description, prompt: command.prompt ?? '', existing: true };
}

/** AddPromptDialog uses `!!existingPrompt`, not whether fields are filled. */
export function promptDraftIsEditing(draft: IKnoxGuiPromptDraft | undefined): boolean {
	return Boolean(draft?.existing);
}

/** AtMentionDropdown injects `config/newPromptFile` when submenu title is exactly this. */
export const PROMPT_FILE_SUBMENU_TITLE = '.prompt file';
export const NEW_PROMPT_FILE_ACTION_ID = 'config/newPromptFile';

export function isPromptFileMentionSubmenu(title?: string, id?: string): boolean {
	return [title, id].some(value => (value ?? '').trim() === PROMPT_FILE_SUBMENU_TITLE);
}

export function newPromptFileMentionAction(labels: { title: string; description: string }): IKnoxGuiSuggestItem {
	return {
		id: NEW_PROMPT_FILE_ACTION_ID,
		label: labels.title,
		description: labels.description,
		itemType: 'action',
	};
}

export function isNewPromptFileMentionAction(item: { id?: string; itemType?: string }): boolean {
	return item.itemType === 'action' && item.id === NEW_PROMPT_FILE_ACTION_ID;
}

export function appendNewPromptFileMentionAction(
	items: IKnoxGuiSuggestItem[],
	submenuTitle: string | undefined,
	submenuId: string | undefined,
	labels: { title: string; description: string },
): IKnoxGuiSuggestItem[] {
	if (!isPromptFileMentionSubmenu(submenuTitle, submenuId) || items.some(isNewPromptFileMentionAction)) {
		return items;
	}
	return [...items, newPromptFileMentionAction(labels)];
}

export type KnoxRuleCardKind = 'local' | 'inline' | 'uses';

/** Matches ExploreBlocksButton blockTypeTranslations. */
export const EXPLORE_BLOCK_TYPE_KEYS: Record<string, string> = {
	rules: 'rules',
	prompts: 'prompts',
	models: 'models',
	tools: 'tools',
	promptTemplates: 'promptTemplates',
	examples: 'examples',
	aiFunctions: 'aiFunctions',
};

export function ruleCardTitleKey(rule: IKnoxGuiRule): { key: string; title?: string } {
	if (rule.source === 'uses' && rule.uses) {
		return { key: '', title: rule.uses };
	}
	if (rule.source === 'inline') {
		return { key: 'inlineRule' };
	}
	return { key: 'locallyDefinedRule' };
}

/** SquarePen opens config only for locally defined rules (RulesSection). */
export function ruleCardOpensProfile(rule: IKnoxGuiRule): boolean {
	return rule.source !== 'inline' && rule.source !== 'uses';
}

function yamlRuleUses(yaml: unknown): string | undefined {
	if (!yaml || typeof yaml !== 'object') {
		return undefined;
	}
	const uses = (yaml as { uses?: unknown }).uses;
	return typeof uses === 'string' && uses ? uses : undefined;
}

/**
 * Port of RulesSection mergedRules: yaml string → inline, yaml `{ uses }` → package title,
 * yaml object without uses is hidden, missing yaml index → locally defined.
 */
export function mergeRuleCards(unrolled: IKnoxGuiRule[], yamlRules?: unknown[]): IKnoxGuiRule[] {
	return unrolled.flatMap((rule, index) => {
		if (!yamlRules) {
			if (rule.source === 'uses' && !rule.uses) {
				return [];
			}
			return [rule];
		}
		const yaml = yamlRules[index];
		if (yaml === undefined) {
			return [{ ...rule, source: 'local' as const, uses: undefined }];
		}
		if (typeof yaml === 'string') {
			return [{ ...rule, source: 'inline' as const, uses: undefined }];
		}
		const uses = yamlRuleUses(yaml);
		if (!uses) {
			return [];
		}
		return [{ ...rule, source: 'uses' as const, uses, title: uses }];
	}).filter(rule => rule.body);
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.replace(/\s+#.*$/, '').trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Lightweight `rules:` list extract from profile rawYaml (parseConfigYaml counterpart). */
export function parseYamlRules(rawYaml: string | undefined): unknown[] | undefined {
	if (!rawYaml) {
		return undefined;
	}
	const lines = rawYaml.replace(/\r\n/g, '\n').split('\n');
	let i = 0;
	while (i < lines.length && !/^rules:\s*(?:#.*)?$/.test(lines[i]) && !/^rules:\s*\[/.test(lines[i])) {
		i++;
	}
	if (i >= lines.length) {
		return undefined;
	}
	const inline = lines[i].match(/^rules:\s*(\[.+\])\s*(?:#.*)?$/);
	if (inline) {
		try {
			const parsed = JSON.parse(inline[1].replace(/'/g, '"'));
			return Array.isArray(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	i++;
	const rules: unknown[] = [];
	while (i < lines.length) {
		const line = lines[i];
		if (line.length && !/^\s/.test(line) && !/^\s*#/.test(line)) {
			break;
		}
		const item = line.match(/^\s*-\s+(.*)$/);
		if (!item) {
			i++;
			continue;
		}
		const rest = item[1].trim();
		const usesInline = rest.match(/^uses:\s*(.+)$/);
		if (usesInline) {
			rules.push({ uses: unquoteYamlScalar(usesInline[1]) });
			i++;
			continue;
		}
		if (!rest || /^\w+:/.test(rest)) {
			const obj: Record<string, string> = {};
			if (rest) {
				const kv = rest.match(/^(\w+):\s*(.*)$/);
				if (kv) {
					obj[kv[1]] = unquoteYamlScalar(kv[2]);
				}
			}
			i++;
			while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*-/.test(lines[i])) {
				const kv = lines[i].match(/^\s+(\w+):\s*(.*)$/);
				if (kv) {
					obj[kv[1]] = unquoteYamlScalar(kv[2]);
				}
				i++;
			}
			rules.push(obj);
			continue;
		}
		rules.push(unquoteYamlScalar(rest));
		i++;
	}
	return rules;
}

export function exploreBlocksIsLocal(profileType: string | undefined): boolean {
	return profileType === 'local';
}

export function exploreBlocksButton(profileType: string | undefined, blockType: string): {
	isLocal: boolean;
	icon: 'plus' | 'share-2';
	actionKey: 'add' | 'explore';
	blockKey: string;
} {
	const isLocal = exploreBlocksIsLocal(profileType);
	return {
		isLocal,
		icon: isLocal ? 'plus' : 'share-2',
		actionKey: isLocal ? 'add' : 'explore',
		blockKey: EXPLORE_BLOCK_TYPE_KEYS[blockType] ?? blockType,
	};
}

export function groupToolsByGroup(tools: IKnoxGuiTool[]): Array<[string, IKnoxGuiTool[]]> {
	const groups = new Map<string, IKnoxGuiTool[]>();
	for (const tool of tools) {
		const list = groups.get(tool.group) ?? [];
		list.push(tool);
		groups.set(tool.group, list);
	}
	return [...groups.entries()];
}

export function duplicateToolNames(tools: IKnoxGuiTool[]): Record<string, boolean> {
	const counts: Record<string, number> = {};
	for (const tool of tools) {
		counts[tool.name] = (counts[tool.name] ?? 0) + 1;
	}
	return Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, count > 1]));
}

export const DEFAULT_AGENT_TOOL_POLICY_TEXT = {
	paths: 'deny ~/.ssh/**\ndeny ~/.gnupg/**\ndeny ~/.aws/**',
	commands: 'deny rm -rf *\ndeny rm -fr *',
} as const;

/** `core/tools/toolPolicy.formatPolicyLines` — string or `{ action, pattern }[]`. */
export function formatPolicyLines(rules: unknown): string {
	if (typeof rules === 'string') {
		return rules.replace(/\r\n/g, '\n').trim();
	}
	if (!Array.isArray(rules)) {
		return '';
	}
	return rules.map(rule => {
		if (typeof rule === 'string') {
			return rule.trim();
		}
		if (!rule || typeof rule !== 'object') {
			return '';
		}
		const rec = rule as { action?: unknown; pattern?: unknown };
		const action = typeof rec.action === 'string' ? rec.action : '';
		const pattern = typeof rec.pattern === 'string' ? rec.pattern : '';
		return action && pattern ? `${action} ${pattern}` : '';
	}).filter(Boolean).join('\n');
}

export function policyEditorText(value: unknown, fallback: string): string {
	return formatPolicyLines(value) || fallback;
}

export function pendingGeneratedToolName(history: Array<{ toolCalls?: Array<{ name: string; status: string }> }>): string | undefined {
	for (const item of history) {
		const call = item.toolCalls?.find(tool => tool.status === 'generated' && !isAskUserToolName(tool.name));
		if (call) {
			return call.name;
		}
	}
	return undefined;
}

export function toolPermissionBadgeKey(display: ReturnType<typeof toolPermissionDisplay>): string {
	if (display === 'requiresApproval') {
		return 'toolRequiresApproval';
	}
	if (display === 'sessionAlways') {
		return 'toolAlwaysThisSession';
	}
	if (display === 'autoApprove') {
		return 'toolAutoApprove';
	}
	return 'toolDisabled';
}

export function agentProfileSharedConfig(value: string): Record<string, unknown> {
	if (value === 'auto') {
		return { agentProfile: value };
	}
	const profile = value === 'rust' || value === 'systems' ? value : 'default';
	const next = AGENT_PROFILE_DEFAULTS[profile];
	return {
		agentProfile: value,
		agentDoomLoopThreshold: next.doomLoopThreshold,
		agentVerifyMode: next.verifyMode,
		agentVerifyCommand: next.verifyCommand,
	};
}

export function sortConfigErrors(errors: IKnoxGuiConfigError[]): IKnoxGuiConfigError[] {
	return [...errors].sort((a, b) => Number(b.fatal) - Number(a.fatal));
}

export function batchDiffTotals(files: Array<{ numDiffs: number; selected: boolean }>): { selected: number; diffs: number } {
	return {
		selected: files.filter(file => file.selected).length,
		diffs: files.reduce((sum, file) => sum + file.numDiffs, 0),
	};
}

export function splitFilePath(filepath: string): { fileName: string; dirPath: string } {
	const normalized = filepath.replace(/\\/g, '/');
	const slash = normalized.lastIndexOf('/');
	if (slash < 0) {
		return { fileName: normalized, dirPath: '' };
	}
	return { fileName: normalized.slice(slash + 1), dirPath: normalized.slice(0, slash) };
}

export function contextProviderInsertId(provider: IKnoxGuiContextProvider): string {
	return provider.title;
}

export function modelUsesChatFallback(role: KnoxModelRole, models: unknown[]): boolean {
	return models.length === 0 && CHAT_FALLBACK_ROLES.includes(role);
}

export function sessionExportFilename(title: string, now = new Date()): string {
	const safeTitle = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 50) || 'session';
	const timestamp = now.toISOString().split('T')[0];
	return `${timestamp}_${safeTitle}.md`;
}

export function formatSessionExportMarkdown(session: {
	title: string;
	workspaceDirectory?: string;
	history: Array<{ role: string; content: string }>;
}, now = new Date(), t: (key: string) => string = key => ({
	knoxSessionTranscript: 'Knox session transcript',
	exported: 'Exported',
	sessionLabel: 'Session',
	workspaceLabel: 'Workspace',
	userRole: 'User',
	assistantRole: 'Assistant',
	noMessagesInSession: 'No messages in this session.',
}[key] ?? key)): string {
	let content = `### [Knox](https://knox.chat) ${t('knoxSessionTranscript')}\n ${t('exported')}: ${now.toLocaleString()}`;
	content += `\n\n**${t('sessionLabel')}:** ${session.title}`;
	if (session.workspaceDirectory) {
		content += `\n**${t('workspaceLabel')}:** ${workspaceBasename(session.workspaceDirectory)}`;
	}
	if (session.history.length) {
		for (const item of session.history) {
			const quoted = knoxGuiRedactSecrets(item.content).replace(/^/gm, '> ');
			const role = t(item.role === 'user' ? 'userRole' : 'assistantRole');
			content += `\n\n#### _${role}_\n\n${quoted}`;
		}
	} else {
		content += `\n\n_${t('noMessagesInSession')}_`;
	}
	return content;
}
