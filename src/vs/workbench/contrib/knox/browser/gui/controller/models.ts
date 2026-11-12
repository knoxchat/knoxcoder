/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { knoxGuiCatalogEntriesFromOverlayModels, knoxGuiChatPickerModels, knoxGuiFindConnectedCatalogModel, knoxGuiGetReasoningModelKeys, knoxGuiModelSupportsImages, knoxGuiModelToolsSupportKnown, knoxGuiModelSupportsToolsFromSupportedParameters, knoxGuiModelSupportsWebSearch, knoxGuiNextModelTitle, knoxGuiParseModelCatalog, knoxGuiReasoningEffortConfig, knoxGuiResolveReasoningEffort, knoxGuiResolveToolsSupported, knoxGuiSeedModelCatalog, knoxGuiShowsThinkingPlaceholder } from '../../../common/knoxGuiCapabilities.js';
import { knoxGuiIsSessionTabMode, knoxGuiResolveSessionMode, knoxGuiSessionModeIsAgent } from '../../../common/knoxGuiAgentMode.js';
import { addModelProviderById, applyOpenRouterAliasFloorPricing, buildAddModelPayload, categorizeKnoxChatModel, KNOX_CHAT_FALLBACK_MODELS, knoxChatMetadataContextLength, knoxChatModelPricing, knoxChatPricingHasWebSearch, knoxChatRecommendedMaxTokens, knoxGuiUniqueYamlModelName, parseKnoxOAuthStatus, parseOpenRouterOAuthStatus, type IKnoxGuiAddModelPackage } from '../../../common/knoxGuiOverlays.js';
import { KNOX_OPEN_SETTINGS_COMMAND_ID, knoxGuiSettingsTab, type KnoxGuiSettingsTab } from '../../../common/knoxGuiChrome.js';
import { KnoxGuiOverlay, KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiModel, IKnoxGuiState, KnoxChatMode, KnoxModelRole, MODEL_ROLES, knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';

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
 * Session stays Agent. Models without tools stream a tool-free turn; leftover
 * Chat from persist is migrated here.
 */
export function syncAgentTabWithModel(controller: KnoxGuiController): void {
	if (controller.store.state.mode === 'edit') {
		return;
	}
	const next = knoxGuiResolveSessionMode({
		mode: controller.store.state.mode,
		toolsSupported: controller.store.state.toolsSupported,
	});
	if (next !== controller.store.state.mode) {
		setMode(controller, next);
	}
}

export function selectModel(controller: KnoxGuiController, _role: KnoxModelRole, title: string | null): void {
	const selectedModelByRole = { ...controller.store.state.selectedModelByRole };
	for (const actionRole of MODEL_ROLES) {
		if (title) {
			selectedModelByRole[actionRole] = title;
		} else {
			delete selectedModelByRole[actionRole];
		}
	}
	controller.store.patch({
		selectedModelByRole,
		modelTitle: title ?? controller.store.state.modelTitle,
	});
	controller.messenger.post('config/updateSelectedModel', { profileId: controller.store.state.profileId, role: 'chat', title });
	if (title) {
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
	return knoxGuiChatPickerModels(controller.store.state);
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
	if (overlay === 'models') {
		controller.messenger.post('config/refreshProfiles', undefined);
	}
}

export function setSettingsTab(controller: KnoxGuiController, tab: string): void {
	const next: KnoxGuiSettingsTab = knoxGuiSettingsTab(tab);
	controller.store.patch({ settingsTab: next });
	if (next === 'models') {
		controller.messenger.post('config/refreshProfiles', undefined);
		if (knoxGuiIsDedicatedEditor(controller.store.state)) {
			loadAddModelCatalogs(controller);
		}
	}
}

export function openSettingsOverlay(controller: KnoxGuiController): void {
	controller.store.setOverlay('settings');
}

export function loadAddModelCatalogs(controller: KnoxGuiController): void {
	void controller.loadOAuthStatus();
	void controller.loadOpenRouterOAuthStatus();
	void controller.loadKnoxChatModels();
	void controller.loadOpenRouterModels();
}

export function openAddModel(controller: KnoxGuiController, _role: KnoxModelRole = 'chat', _options?: { bulk?: boolean }): void {
	controller.store.patch({
		addModelRole: 'chat',
		addModelBulk: true,
		addModelDraft: {},
		addModelSelectedModel: undefined,
	});
	controller.setSettingsTab('models');
	if (controller.store.state.lockedRoute === KnoxGuiRoute.Config) {
		return;
	}
	void controller.commandService.executeCommand(KNOX_OPEN_SETTINGS_COMMAND_ID);
}

export function closeAddModelModal(controller: KnoxGuiController): void {
	controller.store.patch({ addModelRole: undefined, addModelSelectedModel: undefined, addModelDraft: {}, addModelBulk: false });
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
			maxTokens: knoxChatRecommendedMaxTokens(rec) ?? (rec.max_tokens !== undefined && rec.max_tokens !== null ? Number(rec.max_tokens) : (completion?.maxTokens !== undefined && completion.maxTokens !== null ? Number(completion.maxTokens) : undefined)),
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

function addModelResponseTitle(returned: unknown, fallback: string): string {
	if (typeof returned === 'string' && returned.trim()) {
		return returned.trim();
	}
	const rec = returned && typeof returned === 'object' ? returned as { title?: unknown } : undefined;
	if (typeof rec?.title === 'string' && rec.title.trim()) {
		return rec.title.trim();
	}
	return fallback;
}

const addModelConnecting = new Set<string>();

function catalogConnectKey(provider: string, modelId: string): string {
	return `${provider}\0${modelId}`;
}

function rememberConnectedCatalogModel(controller: KnoxGuiController, connected: IKnoxGuiModel): void {
	if (knoxGuiFindConnectedCatalogModel(controller.store.state, connected.provider, connected.model)) {
		return;
	}
	const next = [...knoxGuiChatPickerModels(controller.store.state), connected];
	controller.store.patch({
		models: next,
		modelsByRole: { ...controller.store.state.modelsByRole, chat: next },
	});
}

function finishAddConfiguredModel(controller: KnoxGuiController, title: string): void {
	controller.selectModel('chat', title);
	controller.store.patch({ addModelDraft: {}, addModelRole: undefined, addModelSelectedModel: undefined, addModelBulk: false });
	if (!knoxGuiIsDedicatedEditor(controller.store.state)) {
		controller.store.navigate('/');
	}
}

export async function addConfiguredModel(controller: KnoxGuiController, providerId: string, pack: IKnoxGuiAddModelPackage, extras?: { dimensionChoices?: string[]; selectedProvider?: string }): Promise<void> {
	const provider = addModelProviderById(providerId);
	if (!provider) {
		return;
	}
	const { model } = buildAddModelPayload(provider, pack, controller.store.state.addModelDraft, 'chat', {
		...extras,
		bulk: true,
	});
	const catalogProvider = String(model.provider ?? provider.provider);
	const catalogModelId = String(model.model ?? pack.params.model ?? '');
	const existing = knoxGuiFindConnectedCatalogModel(controller.store.state, catalogProvider, catalogModelId);
	if (existing) {
		controller.selectModel('chat', existing.title);
		return;
	}
	const connectingKey = catalogModelId ? catalogConnectKey(catalogProvider, catalogModelId) : '';
	if (connectingKey && addModelConnecting.has(connectingKey)) {
		return;
	}
	if (connectingKey) {
		addModelConnecting.add(connectingKey);
	}
	try {
		const fallbackTitle = knoxGuiUniqueYamlModelName(
			controller.store.state.models.map(item => item.title).filter(Boolean),
			String(model.title ?? pack.title),
			catalogProvider,
		);
		model.title = fallbackTitle;
		model.name = fallbackTitle;
		if (catalogModelId) {
			rememberConnectedCatalogModel(controller, {
				title: fallbackTitle,
				provider: catalogProvider,
				model: catalogModelId,
			});
		}
		let title = fallbackTitle;
		try {
			const returned = await controller.messenger.request<unknown>('config/addModel', { model, role: 'chat' });
			title = addModelResponseTitle(returned, fallbackTitle);
		} catch {
			// Host still received the add. Select locally so the picker switches even without a reply.
		}
		finishAddConfiguredModel(controller, title);
	} finally {
		if (connectingKey) {
			addModelConnecting.delete(connectingKey);
		}
	}
}
