/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { knoxGuiCatalogEntriesFromOverlayModels, knoxGuiGetReasoningModelKeys, knoxGuiModelSupportsImages, knoxGuiModelToolsSupportKnown, knoxGuiModelSupportsToolsFromSupportedParameters, knoxGuiModelSupportsWebSearch, knoxGuiNextModelTitle, knoxGuiParseModelCatalog, knoxGuiReasoningEffortConfig, knoxGuiResolveReasoningEffort, knoxGuiResolveToolsSupported, knoxGuiSeedModelCatalog, knoxGuiShowsThinkingPlaceholder } from '../../../common/knoxGuiCapabilities.js';
import { knoxGuiIsSessionTabMode, knoxGuiSessionModeIsAgent } from '../../../common/knoxGuiAgentMode.js';
import { addModelProviderById, applyOpenRouterAliasFloorPricing, buildAddModelPayload, categorizeKnoxChatModel, KNOX_CHAT_FALLBACK_MODELS, knoxChatMetadataContextLength, knoxChatModelPricing, knoxChatPricingHasWebSearch, knoxChatRecommendedMaxTokens, parseKnoxOAuthStatus, parseOpenRouterOAuthStatus, type IKnoxGuiAddModelPackage } from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiOverlay } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiModel, IKnoxGuiState, KnoxChatMode, KnoxModelRole } from '../../../common/knoxGuiState.js';

/** `thunks/setSessionMode.ts`: no switch while streaming; entering edit saves and opens a new session. */
export function setMode(controller: KnoxGuiController, mode: KnoxChatMode): void {
	if (controller.store.state.mode === mode || controller.store.state.isStreaming) {
		return;
	}
	if (controller.store.state.mode === 'edit' && mode !== 'edit') {
		void controller.exitEditMode(mode);
		return;
	}
	const previous = controller.store.state.mode;
	controller.store.setMode(mode);
	if (mode === 'edit' && knoxGuiIsSessionTabMode(previous)) {
		controller.store.patch({ editReturnMode: previous });
	}
	if (mode === 'edit' && controller.store.state.history.length) {
		void controller.newSession({ generateTitle: false });
		return;
	}
	postSetAgentMode(controller);
}

/** Keep AgentModeManager on the same boolean as GUI `session.mode === "agent"`. */
export function postSetAgentMode(controller: KnoxGuiController): void {
	controller.messenger.post('setAgentMode', {
		active: knoxGuiSessionModeIsAgent(controller.store.state.mode),
		sessionId: controller.store.state.sessionId,
	});
}

/**
 * React ModeSelect: only leave Agent when the selected model is known not to
 * support tools. Unknown (catalog still loading) keeps the Agent default.
 */
export function syncAgentTabWithModel(controller: KnoxGuiController): void {
	if (!knoxGuiSessionModeIsAgent(controller.store.state.mode)) {
		return;
	}
	const title = controller.store.state.modelTitle;
	const selected = controller.chatModels().find(model => model.title === title)
		?? controller.store.state.models.find(model => model.title === title);
	if (knoxGuiModelToolsSupportKnown(selected) === false) {
		setMode(controller, 'chat');
	}
}

export function selectModel(controller: KnoxGuiController, role: KnoxModelRole, title: string | null): void {
	const selectedModelByRole = { ...controller.store.state.selectedModelByRole };
	if (title) {
		selectedModelByRole[role] = title;
	} else {
		delete selectedModelByRole[role];
	}
	controller.store.patch({
		selectedModelByRole,
		modelTitle: role === 'chat' ? (title ?? controller.store.state.modelTitle) : controller.store.state.modelTitle,
	});
	controller.messenger.post('config/updateSelectedModel', { profileId: controller.store.state.profileId, role, title });
	if (role === 'chat' && title) {
		const selected = controller.chatModels().find(model => model.title === title);
		const effort = knoxGuiResolveReasoningEffort(selected, controller.store.state.reasoningEffortByModel, controller.store.state.reasoningEffort);
		controller.store.patch({
			imagesSupported: knoxGuiModelSupportsImages(selected),
			webSearchSupported: knoxGuiModelSupportsWebSearch(selected),
			toolsSupported: knoxGuiResolveToolsSupported(knoxGuiModelToolsSupportKnown(selected), controller.store.state.toolsSupported),
			thinkingPlaceholder: knoxGuiShowsThinkingPlaceholder(selected),
			reasoningEfforts: knoxGuiReasoningEffortConfig(selected)?.allowed ?? [],
			reasoningEffort: effort,
		});
		if (effort) {
			controller.setReasoningEffort(effort);
		}
		syncAgentTabWithModel(controller);
	}
}

export function cycleChatModel(controller: KnoxGuiController, direction: 1 | -1): void {
	const next = knoxGuiNextModelTitle(controller.chatModels(), controller.store.state.modelTitle, direction);
	if (next && next !== controller.store.state.modelTitle) {
		controller.selectModel('chat', next);
	}
}

export function deleteModel(controller: KnoxGuiController, title: string): void {
	controller.messenger.post('config/deleteModel', { title });
}

export function chatModels(controller: KnoxGuiController): IKnoxGuiModel[] {
	return controller.store.state.modelsByRole.chat.length ? controller.store.state.modelsByRole.chat : controller.store.state.models;
}

/** Recompute Agent-tab tools support after the /v1/models catalog arrives (KN-371). */
export function patchSelectedModelCapabilities(controller: KnoxGuiController): void {
	const title = controller.store.state.modelTitle;
	const selected = controller.chatModels().find(model => model.title === title)
		?? controller.store.state.models.find(model => model.title === title);
	if (!selected) {
		return;
	}
	controller.store.patch({
		imagesSupported: knoxGuiModelSupportsImages(selected),
		webSearchSupported: knoxGuiModelSupportsWebSearch(selected),
		toolsSupported: knoxGuiResolveToolsSupported(knoxGuiModelToolsSupportKnown(selected), controller.store.state.toolsSupported),
	});
	syncAgentTabWithModel(controller);
}

export function setReasoningEffort(controller: KnoxGuiController, effort: string): void {
	const selected = controller.chatModels().find(model => model.title === controller.store.state.modelTitle)
		?? controller.store.state.models.find(model => model.title === controller.store.state.modelTitle);
	const byModel = { ...controller.store.state.reasoningEffortByModel };
	for (const key of knoxGuiGetReasoningModelKeys(selected)) {
		byModel[key] = effort;
	}
	if (!selected && controller.store.state.modelTitle) {
		byModel[controller.store.state.modelTitle] = effort;
	}
	controller.store.patch({ reasoningEffort: effort, reasoningEffortByModel: byModel });
	controller.messenger.post('ui/updateReasoningEffortPrefs', { lastEffort: effort, byModel });
}

export function setOverlay(controller: KnoxGuiController, overlay: KnoxGuiOverlay): void {
	controller.store.setOverlay(overlay);
	if (controller.store.state.overlay === 'history') {
		void controller.refreshHistorySessions();
	}
	if (overlay === 'models') {
		controller.messenger.post('config/refreshProfiles', undefined);
	}
}

export function openSettingsOverlay(controller: KnoxGuiController): void {
	controller.store.setOverlay('settings');
}

export function openAddModel(controller: KnoxGuiController, role: KnoxModelRole = 'chat', options?: { bulk?: boolean }): void {
	controller.store.patch({
		addModelRole: role,
		addModelModal: true,
		addModelBulk: options?.bulk === true,
		addModelDraft: {},
		addModelSelectedModel: undefined,
	});
	void controller.loadOAuthStatus();
	void controller.loadOpenRouterOAuthStatus();
	void controller.loadKnoxChatModels();
	void controller.loadOpenRouterModels();
}

export function closeAddModelModal(controller: KnoxGuiController): void {
	controller.store.patch({ addModelModal: false, addModelRole: undefined, addModelSelectedModel: undefined, addModelDraft: {}, addModelBulk: false });
}

export function applyOAuthStatus(controller: KnoxGuiController, data: unknown): void {
	const next = parseKnoxOAuthStatus(data);
	controller.store.patch(next);
	if (next.oauthConnected) {
		void controller.loadKnoxChatModels();
	}
}

export function applyOpenRouterOAuthStatus(controller: KnoxGuiController, data: unknown): void {
	const next = parseOpenRouterOAuthStatus(data);
	controller.store.patch(next);
	if (next.openrouterOauthConnected) {
		void controller.loadOpenRouterModels();
	}
}

export async function loadOAuthStatus(controller: KnoxGuiController): Promise<void> {
	try {
		const status = await controller.messenger.request<Record<string, unknown>>('knoxchat/oauth/status', undefined);
		controller.applyOAuthStatus(status);
	} catch {
		// optional
	}
}

export async function loadOpenRouterOAuthStatus(controller: KnoxGuiController): Promise<void> {
	try {
		const status = await controller.messenger.request<Record<string, unknown>>('openrouter/oauth/status', undefined);
		controller.applyOpenRouterOAuthStatus(status);
	} catch {
		// optional
	}
}

export function startOpenRouterOAuth(controller: KnoxGuiController): void {
	controller.messenger.post('openrouter/oauth/start', undefined);
}

export function cancelOpenRouterOAuth(controller: KnoxGuiController): void {
	controller.messenger.post('openrouter/oauth/cancel', undefined);
}

export function signOutOpenRouterOAuth(controller: KnoxGuiController): void {
	controller.messenger.post('openrouter/oauth/signOut', undefined);
}

function mapCatalogRawToGuiModels(raw: unknown[]): IKnoxGuiState['knoxChatModels'] {
	return raw.map(item => {
		const rec = asRecord(item) ?? {};
		const architecture = asRecord(rec.architecture);
		const id = String(rec.id ?? rec.model ?? rec.name ?? '');
		const title = String(rec.name ?? rec.title ?? rec.id ?? '');
		const capabilities = asRecord(rec.capabilities);
		const completion = asRecord(rec.completionOptions);
		const supportedParameters = Array.isArray(rec.supported_parameters)
			? rec.supported_parameters.map(String)
			: Array.isArray(rec.supportedParameters)
				? rec.supportedParameters.map(String)
				: undefined;
		const toolsFromParams = knoxGuiModelSupportsToolsFromSupportedParameters(supportedParameters);
		const webFromParams = (supportedParameters ?? []).includes('web_search') || (supportedParameters ?? []).includes('web_search_options');
		const reasoningFromParams = (supportedParameters ?? []).includes('reasoning') || (supportedParameters ?? []).includes('reasoning_effort') || (supportedParameters ?? []).includes('include_reasoning');
		return {
			title,
			description: rec.description ? String(rec.description) : (id ? `Model ID: ${id}` : undefined),
			model: id,
			contextLength: knoxChatMetadataContextLength(rec) ?? 180000,
			category: categorizeKnoxChatModel({
				id,
				name: title,
				title,
				developer: rec.developer ? String(rec.developer) : undefined,
				owned_by: rec.owned_by ? String(rec.owned_by) : undefined,
				tokenizer: architecture?.tokenizer ? String(architecture.tokenizer) : undefined,
			}),
			maxTokens: knoxChatRecommendedMaxTokens(rec) ?? (rec.max_tokens != null ? Number(rec.max_tokens) : (completion?.maxTokens != null ? Number(completion.maxTokens) : undefined)),
			supportsTools: capabilities?.tools === true || toolsFromParams,
			supportsReasoning: capabilities?.reasoning === true || reasoningFromParams,
			supportsWebSearch: capabilities?.webSearch === true || webFromParams || knoxChatPricingHasWebSearch(rec.pricing),
			supportsImageOutput: capabilities?.imageOutput === true || asArray(architecture?.output_modalities).includes('image'),
			modalities: Array.isArray(architecture?.input_modalities) ? architecture.input_modalities.map(String) : undefined,
			pricing: knoxChatModelPricing(rec.pricing, rec.pricing_in_display_units),
			supportedParameters,
		};
	}).filter(model => model.title);
}

export async function loadKnoxChatModels(controller: KnoxGuiController): Promise<void> {
	controller.store.patch({ knoxChatModelsLoading: true });
	try {
		const result = await controller.messenger.request<unknown>('knoxchat/listModels', undefined);
		const raw = asArray(asRecord(result)?.data ?? result);
		const catalog = knoxGuiParseModelCatalog(raw);
		knoxGuiSeedModelCatalog(catalog.length ? catalog : knoxGuiCatalogEntriesFromOverlayModels(KNOX_CHAT_FALLBACK_MODELS));
		const models = mapCatalogRawToGuiModels(raw);
		const seen = new Set<string>();
		const unique = [...models, ...KNOX_CHAT_FALLBACK_MODELS].filter(model => {
			if (seen.has(model.model)) {
				return false;
			}
			seen.add(model.model);
			return true;
		});
		controller.store.patch({ knoxChatModels: unique.length ? unique : [...KNOX_CHAT_FALLBACK_MODELS], knoxChatModelsLoading: false });
		patchSelectedModelCapabilities(controller);
	} catch {
		knoxGuiSeedModelCatalog(knoxGuiCatalogEntriesFromOverlayModels(KNOX_CHAT_FALLBACK_MODELS));
		controller.store.patch({ knoxChatModels: [...KNOX_CHAT_FALLBACK_MODELS], knoxChatModelsLoading: false });
		patchSelectedModelCapabilities(controller);
	}
}

export async function loadOpenRouterModels(controller: KnoxGuiController): Promise<void> {
	controller.store.patch({ openrouterModelsLoading: true });
	try {
		const result = await controller.messenger.request<unknown>('openrouter/listModels', undefined);
		const raw = applyOpenRouterAliasFloorPricing(asArray(asRecord(result)?.data ?? result));
		const catalog = knoxGuiParseModelCatalog(raw);
		if (catalog.length) {
			knoxGuiSeedModelCatalog(catalog);
		}
		const models = mapCatalogRawToGuiModels(raw);
		const seen = new Set<string>();
		const unique = models.filter(model => {
			if (!model.model || seen.has(model.model)) {
				return false;
			}
			seen.add(model.model);
			return true;
		});
		controller.store.patch({
			openrouterModels: unique,
			openrouterModelsLoading: false,
			openrouterSelectedModel: unique.some(model => model.model === controller.store.state.openrouterSelectedModel)
				? controller.store.state.openrouterSelectedModel
				: unique[0]?.model,
		});
		patchSelectedModelCapabilities(controller);
	} catch {
		controller.store.patch({ openrouterModels: [], openrouterModelsLoading: false });
		patchSelectedModelCapabilities(controller);
	}
}

export async function addConfiguredModel(controller: KnoxGuiController, providerId: string, pack: IKnoxGuiAddModelPackage, extras?: { dimensionChoices?: string[]; selectedProvider?: string }): Promise<void> {
	const provider = addModelProviderById(providerId);
	if (!provider) {
		return;
	}
	const { model, role } = buildAddModelPayload(provider, pack, controller.store.state.addModelDraft, controller.store.state.addModelRole, {
		...extras,
		bulk: controller.store.state.addModelBulk,
	});
	controller.messenger.post('config/addModel', { model, role });
	if (controller.store.state.addModelRole) {
		controller.selectModel(controller.store.state.addModelRole, String(model.title ?? pack.title));
	} else {
		controller.selectModel('chat', String(model.title ?? pack.title));
	}
	const wasModal = controller.store.state.addModelModal;
	controller.store.patch({ addModelDraft: {}, addModelRole: undefined, addModelModal: false, addModelSelectedModel: undefined, addModelBulk: false });
	if (!wasModal) {
		controller.store.navigate('/');
	}
}
