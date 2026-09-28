/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { LANGUAGE_KEY, asRecord, asArray, modelsFromUnknown } from './helpers.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { knoxGuiModelSupportsImages, knoxGuiModelToolsSupportKnown, knoxGuiModelSupportsWebSearch, knoxGuiReasoningEffortConfig, knoxGuiResolveReasoningEffort, knoxGuiResolveToolsSupported, knoxGuiShowsThinkingPlaceholder } from '../../../common/knoxGuiCapabilities.js';
import { postSetAgentMode, syncAgentTabWithModel } from './models.js';
import { draftSession, lastActiveSession, loadProfilePreferences } from './persistence.js';
import { knoxGuiResolveProfileId, knoxGuiStartupSession } from '../../../common/knoxGuiPersist.js';
import { agentProfileDefaults, agentProfileSharedConfig, formatPolicyLines, mergeReasoningEffortPrefs, parseYamlRules } from '../../../common/knoxGuiOverlays.js';
import { KNOX_GUI_HEARTBEAT_MS, KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { mergeContextProvidersWithDefaults, mergeSlashCommandsWithBuiltins } from '../../../common/knoxGuiInput.js';
import { IKnoxGuiContextProvider, IKnoxGuiModel, IKnoxGuiSlashCommand, IKnoxGuiState, IKnoxGuiTool, KnoxGuiLanguage, KnoxModelRole, MODEL_ROLES, knoxGuiIsDedicatedEditor } from '../../../common/knoxGuiState.js';

export async function setup(controller: KnoxGuiController): Promise<void> {
	try {
		const profile = await controller.messenger.request<Record<string, unknown>>('config/getSerializedProfileInfo', undefined);
		controller.applyConfig(profile);
		try {
			const listed = await controller.messenger.request<Record<string, unknown>>('config/listProfiles', undefined);
			controller.applyProfiles(listed);
		} catch {
			// optional; ExploreBlocksButton falls back to Explore until a local profile is known
		}
		if (knoxGuiIsDedicatedEditor(controller.store.state)) {
			controller.messenger.post('setGuiLanguage', { language: controller.store.state.language });
			void controller.loadMemoryMode();
			if (controller.store.state.lockedRoute === KnoxGuiRoute.Memory) {
				await controller.hydrateMemoryTab();
				await controller.loadMemory();
			} else {
				await controller.loadCheckpoints();
			}
			controller.startHeartbeat();
		} else {
			await controller.resolveWorkspaceDirectory();
			await controller.refreshHistorySessions();
			const startupId = knoxGuiStartupSession({
				workspace: controller.workspaceDirectory,
				lastActive: lastActiveSession(controller),
				sessions: controller.store.state.historySessions,
			});
			if (startupId !== undefined) {
				const overlay = controller.store.state.overlay;
				await controller.loadSession(startupId);
				const draft = draftSession(controller);
				if (draft?.history.length && draft.sessionId === controller.store.state.sessionId) {
					controller.store.patch({ history: draft.history, sessionTitle: draft.title || controller.store.state.sessionTitle });
				}
				controller.store.patch({ overlay });
			}
			controller.messenger.post('setGuiLanguage', { language: controller.store.state.language });
			controller.syncActiveSession();
			postSetAgentMode(controller);
			void controller.refreshGitDiff();
			void controller.refreshBackgroundJobs();
			void controller.loadMemoryMode();
			void controller.loadReasoningEffortPrefs();
			controller.startHeartbeat();
			controller.startGitPoll();
		}
	} catch {
		// Extension host not ready yet; UI still loads.
	}
	void controller.loadKnoxChatModels();
	controller.store.patch({ setupComplete: true });
}

export function applyConfig(controller: KnoxGuiController, payload: Record<string, unknown> | undefined): void {
	const top = asRecord(payload);
	const result = asRecord(top?.result) ?? top;
	const config = asRecord(result?.config) ?? asRecord(result);
	if (!config) {
		return;
	}
	const ui = asRecord(config.ui);
	const experimental = asRecord(config.experimental);
	const profileDefaults = agentProfileDefaults(String(experimental?.agentProfileSetting ?? experimental?.agentProfile ?? 'default'));
	const models = modelsFromUnknown(config.models);
	const modelsByRoleRaw = asRecord(config.modelsByRole);
	const selectedRaw = asRecord(config.selectedModelByRole);
	const modelsByRole = { chat: [], edit: [], apply: [], viewRead: [], realTimeSearch: [] } as Record<KnoxModelRole, IKnoxGuiModel[]>;
	const selectedModelByRole: Partial<Record<KnoxModelRole, string>> = {};
	for (const role of MODEL_ROLES) {
		modelsByRole[role] = modelsFromUnknown(modelsByRoleRaw?.[role]);
		const selected = asRecord(selectedRaw?.[role]);
		if (selected?.title) {
			selectedModelByRole[role] = String(selected.title);
		}
	}
	if (!modelsByRole.chat.length) {
		modelsByRole.chat = models;
	}
	const errorsSource = asArray(top?.configError ?? result?.errors ?? config.configError);
	const errors = errorsSource.map(error => {
		if (typeof error === 'string') {
			return { fatal: false, message: error };
		}
		const rec = asRecord(error) ?? {};
		return { fatal: Boolean(rec.fatal), message: String(rec.message ?? rec) };
	});
	const slashCommands: IKnoxGuiSlashCommand[] = asArray(config.slashCommands).map(item => {
		const rec = asRecord(item) ?? {};
		return {
			name: String(rec.name ?? rec.command ?? ''),
			description: String(rec.description ?? ''),
			prompt: rec.prompt ? String(rec.prompt): undefined,
		};
	}).filter(cmd => cmd.name);
	const rules = asArray(config.rules).map((item, index) => {
		if (typeof item === 'string') {
			return { title: `Rule ${index + 1}`, body: item, source: 'local' as const };
		}
		const rec = asRecord(item) ?? {};
		const uses = rec.uses ? String(rec.uses): (rec.name ? String(rec.name): undefined);
		const body = String(rec.rule ?? rec.body ?? rec.content ?? '');
		const source = uses ? 'uses' as const : (rec.inline === true ? 'inline' as const : 'local' as const);
		return { title: String(rec.name ?? rec.title ?? uses ?? `Rule ${index + 1}`), body, source, uses };
	}).filter(rule => rule.body);
	const tools: IKnoxGuiTool[] = asArray(config.tools).map(item => {
		const rec = asRecord(item) ?? {};
		const fn = asRecord(rec.function) ?? rec;
		return {
			name: String(fn.name ?? rec.name ?? ''),
			group: String(rec.group ?? 'tools'),
			description: fn.description ? String(fn.description): undefined,
			readonly: Boolean(rec.readonly),
			displayTitle: rec.displayTitle ? String(rec.displayTitle): undefined,
			wouldLikeTo: rec.wouldLikeTo ? String(rec.wouldLikeTo): undefined,
			isCurrently: rec.isCurrently ? String(rec.isCurrently): undefined,
			hasAlready: rec.hasAlready ? String(rec.hasAlready): undefined,
			faviconUrl: rec.faviconUrl ? String(rec.faviconUrl): undefined,
		};
	}).filter(tool => tool.name);
	const contextProviders: IKnoxGuiContextProvider[] = asArray(config.contextProviders).map(item => {
		const rec = asRecord(item) ?? {};
		const type: IKnoxGuiContextProvider['type'] = rec.type === 'submenu'
			? 'submenu'
			: rec.type === 'query'
				? 'query'
				: rec.type === 'normal'
					? 'normal'
					: undefined;
		return {
			title: String(rec.title ?? rec.name ?? ''),
			displayTitle: rec.displayTitle ? String(rec.displayTitle): undefined,
			description: rec.description ? String(rec.description): undefined,
			type,
			renderInlineAs: rec.renderInlineAs ? String(rec.renderInlineAs): undefined,
			category: rec.category ? String(rec.category): undefined,
		};
	}).filter(p => p.title);
	const defaultContext = asArray(experimental?.defaultContext).map(item => {
		if (typeof item === 'string') {
			return item;
		}
		const rec = asRecord(item);
		return String(rec?.name ?? rec?.title ?? '');
	}).filter(Boolean);
	const selectedChat = selectedModelByRole.chat ?? String(config.selectedModelTitle ?? models[0]?.title ?? controller.store.state.modelTitle ?? '');
	const selectedModel = [...modelsByRole.chat, ...models].find(model => model.title === selectedChat);
	const effortConfig = knoxGuiReasoningEffortConfig(selectedModel);
	const resolvedEffort = knoxGuiResolveReasoningEffort(selectedModel, controller.store.state.reasoningEffortByModel, controller.store.state.reasoningEffort);
	const policy = asRecord(experimental?.agentPolicy);
	const existingSettings = { ...controller.store.state.toolSettings };
	for (const tool of tools) {
		if (!existingSettings[tool.name]) {
			existingSettings[tool.name] = 'allowedWithoutPermission';
		}
	}
	controller.store.patch({
		models,
		modelsByRole,
		selectedModelByRole,
		modelTitle: selectedChat,
		slashCommands: mergeSlashCommandsWithBuiltins(slashCommands),
		rules,
		tools,
		toolSettings: existingSettings,
		contextProviders: mergeContextProvidersWithDefaults(contextProviders),
		defaultContext,
		profileId: top?.profileId ? String(top.profileId): controller.store.state.profileId,
		profileType: typeof top?.profileType === 'string' ? String(top.profileType) : (controller.store.state.profileType ?? (top?.profileId ? 'local' : undefined)),
		yamlRules: Array.isArray(top?.yamlRules) ? top.yamlRules : controller.store.state.yamlRules,
		showSessionTabs: Boolean(ui?.showSessionTabs),
		fontSize: typeof ui?.fontSize === 'number' ? ui.fontSize : controller.store.state.fontSize,
		codeWrap: ui?.codeWrap === true || ui?.codeBlockWrap === true,
		codeBlockToolbarPosition: ui?.codeBlockToolbarPosition === 'bottom' ? 'bottom' : 'top',
		showChatScrollbar: Boolean(ui?.showChatScrollbar),
		autoNameSessionTitles: config.disableSessionTitles === true || ui?.autoNameSession === false ? false : true,
		markdownFormatting: ui?.displayRawMarkdown === true || ui?.markdownFormatting === false ? false : true,
		agentProfile: String(experimental?.agentProfileSetting ?? experimental?.agentProfile ?? controller.store.state.agentProfile),
		agentMaxSteps: typeof experimental?.agentMaxSteps === 'number' ? experimental.agentMaxSteps : profileDefaults.maxSteps,
		agentDoomLoopThreshold: typeof experimental?.agentDoomLoopThreshold === 'number' ? experimental.agentDoomLoopThreshold : profileDefaults.doomLoopThreshold,
		agentViewSubdirectoryMaxFiles: typeof experimental?.agentViewSubdirectoryMaxFiles === 'number' ? experimental.agentViewSubdirectoryMaxFiles : controller.store.state.agentViewSubdirectoryMaxFiles,
		jevEnabled: asRecord(experimental?.jev)?.enabled === true || experimental?.jevEnabled === true,
		promptPath: typeof experimental?.promptPath === 'string' ? experimental.promptPath : controller.store.state.promptPath,
		webSearchSupported: knoxGuiModelSupportsWebSearch(selectedModel),
		imagesSupported: knoxGuiModelSupportsImages(selectedModel),
		toolsSupported: knoxGuiResolveToolsSupported(knoxGuiModelToolsSupportKnown(selectedModel), controller.store.state.toolsSupported),
		thinkingPlaceholder: knoxGuiShowsThinkingPlaceholder(selectedModel),
		reasoningEffort: resolvedEffort ?? controller.store.state.reasoningEffort,
		reasoningEfforts: effortConfig?.allowed ?? [],
		policy: {
			paths: formatPolicyLines(policy?.paths) || (typeof experimental?.agentPolicyPaths === 'string' ? experimental.agentPolicyPaths : controller.store.state.policy.paths),
			commands: formatPolicyLines(policy?.commands) || (typeof experimental?.agentPolicyCommands === 'string' ? experimental.agentPolicyCommands : controller.store.state.policy.commands),
			externalDirectory: policy?.externalDirectory === 'deny' || policy?.externalDirectory === 'allow' || experimental?.agentPolicyExternalDirectory === 'deny' || experimental?.agentPolicyExternalDirectory === 'allow'
				? String(policy?.externalDirectory ?? experimental?.agentPolicyExternalDirectory) as IKnoxGuiState['policy']['externalDirectory']
				: controller.store.state.policy.externalDirectory,
			sandboxDestructive: policy?.sandboxDestructive !== false && experimental?.agentPolicySandboxDestructive !== false,
		},
		configError: errors,
		fatalConfig: errors.some(error => error.fatal),
	});
	if (top && 'profileId' in top) {
		selectProfile(controller, top.profileId ? String(top.profileId) : null);
	}
	syncAgentTabWithModel(controller);
}

export function applyProfiles(controller: KnoxGuiController, payload: Record<string, unknown> | undefined): void {
	const rec = asRecord(payload) ?? {};
	const profiles = asArray(rec.profiles).map(asRecord).filter((profile): profile is Record<string, unknown> => Boolean(profile));
	controller.availableProfiles = profiles;
	const requested = rec.selectedProfileId != null && rec.selectedProfileId !== '' ? String(rec.selectedProfileId) : null;
	selectProfile(controller, requested);
}

/**
 * `profiles/thunks.ts` selectProfileThunk: an unknown or empty id falls back
 * to the first profile; a change is reported with `didChangeSelectedProfile`.
 * Before the profile list has loaded nothing happens.
 */
export function selectProfile(controller: KnoxGuiController, id: string | null): void {
	const profiles = controller.availableProfiles;
	if (!profiles) {
		return;
	}
	const newId = knoxGuiResolveProfileId(profiles.map(profile => String(profile.id ?? '')), id);
	const selected = profiles.find(profile => String(profile.id ?? '') === newId);
	const rawYaml = selected && typeof selected.rawYaml === 'string' ? selected.rawYaml : undefined;
	const profileType = selected && typeof selected.profileType === 'string'
		? String(selected.profileType)
		: (newId ? 'local' : undefined);
	const changed = (newId ?? null) !== (controller.store.state.profileId ?? null);
	const prefs = changed && newId ? loadProfilePreferences(controller, newId) : undefined;
	controller.store.patch({
		profileId: newId ?? undefined,
		profileType,
		yamlRules: parseYamlRules(rawYaml),
		...(prefs ? { bookmarkedSlash: prefs.bookmarkedSlashCommands, recentSlash: prefs.recentSlashCommands } : {}),
	});
	if (changed) {
		controller.messenger.post('didChangeSelectedProfile', { id: newId });
	}
}

export function startHeartbeat(controller: KnoxGuiController): void {
	controller.clearHeartbeat();
	const beat = () => {
		controller.messenger.post('knox/heartbeat', { t: Date.now() });
	};
	beat();
	controller.heartbeatTimer = setInterval(beat, KNOX_GUI_HEARTBEAT_MS);
	const onVisible = () => {
		if (document.visibilityState === 'visible') {
			beat();
		}
	};
	window.addEventListener('focus', beat);
	document.addEventListener('visibilitychange', onVisible);
	controller.heartbeatCleanup = () => {
		window.removeEventListener('focus', beat);
		document.removeEventListener('visibilitychange', onVisible);
	};
}

export function clearHeartbeat(controller: KnoxGuiController): void {
	if (controller.heartbeatTimer) {
		clearInterval(controller.heartbeatTimer);
		controller.heartbeatTimer = undefined;
	}
	controller.heartbeatCleanup?.();
	controller.heartbeatCleanup = undefined;
}

export async function setLanguage(controller: KnoxGuiController, language: KnoxGuiLanguage): Promise<void> {
	controller.store.setLanguage(language);
	controller.storageService.store(LANGUAGE_KEY, language, StorageScope.PROFILE, StorageTarget.USER);
	controller.messenger.post('setGuiLanguage', { language });
}

export async function updateSharedConfig(controller: KnoxGuiController, sharedConfig: Record<string, unknown>): Promise<void> {
	await controller.messenger.request('config/updateSharedConfig', sharedConfig);
}

export function applyAgentProfile(controller: KnoxGuiController, value: string): void {
	const shared = agentProfileSharedConfig(value);
	controller.store.patch({
		agentProfile: value,
		agentDoomLoopThreshold: typeof shared.agentDoomLoopThreshold === 'number' ? shared.agentDoomLoopThreshold : controller.store.state.agentDoomLoopThreshold,
	});
	void controller.updateSharedConfig(shared);
}

export async function loadMemoryMode(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/getConfig', undefined);
		const config = asRecord(asRecord(result)?.config) ?? asRecord(result);
		const mode = config?.memory_mode;
		if (typeof mode === 'string') {
			controller.store.patch({ memoryMode: mode });
		}
	} catch {
		// optional
	}
}

export async function loadReasoningEffortPrefs(controller: KnoxGuiController): Promise<void> {
	try {
		const prefs = await controller.messenger.request<Record<string, unknown>>('ui/getReasoningEffortPrefs', undefined);
		const rec = asRecord(prefs);
		const diskByModel = asRecord(rec?.byModel) ?? {};
		const mapped: Record<string, string> = {};
		for (const [key, value] of Object.entries(diskByModel)) {
			if (typeof value === 'string') {
				mapped[key] = value;
			}
		}
		const merged = mergeReasoningEffortPrefs(
			{ lastEffort: rec?.lastEffort ? String(rec.lastEffort): undefined, byModel: mapped },
			{ lastEffort: controller.store.state.reasoningEffort, byModel: controller.store.state.reasoningEffortByModel },
			controller.store.state.modelTitle,
		);
		controller.store.patch({
			reasoningEffortByModel: merged.byModel,
			reasoningEffort: merged.lastEffort ?? controller.store.state.reasoningEffort,
		});
		if (merged.shouldWriteDisk) {
			controller.messenger.post('ui/updateReasoningEffortPrefs', {
				lastEffort: controller.store.state.reasoningEffort,
				byModel: controller.store.state.reasoningEffortByModel,
			});
		}
	} catch {
		// optional
	}
}
