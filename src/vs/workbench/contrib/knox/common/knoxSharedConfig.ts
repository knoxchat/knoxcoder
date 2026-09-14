/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clamp } from '../../../../base/common/numbers.js';
import { IKnoxSerializedConfig } from './knoxChatTypes.js';
import { knoxParsePolicyLines } from './knoxToolPermissions.js';

export const KNOX_DEFAULT_UI_SETTINGS = {
	showSessionTabs: false,
	codeWrap: false,
	showChatScrollbar: false,
	displayRawMarkdown: false,
	disableSessionTitles: false,
} as const;

export const KNOX_DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES = 1000;
export const KNOX_MIN_VIEW_SUBDIRECTORY_MAX_FILES = 50;
export const KNOX_MAX_VIEW_SUBDIRECTORY_MAX_FILES = 20000;

export const KNOX_MIN_FONT_SIZE = 7;
export const KNOX_MAX_FONT_SIZE = 50;
export const KNOX_DEFAULT_FONT_SIZE = 14;

export type KnoxAgentProfileSetting = 'default' | 'systems' | 'rust' | 'auto';
export type KnoxResolvedAgentProfile = 'default' | 'systems' | 'rust';
export type KnoxAgentVerifyMode = 'diagnostics' | 'command' | 'off';

export const KNOX_AGENT_PROFILE_SETTINGS: readonly KnoxAgentProfileSetting[] = ['default', 'systems', 'rust', 'auto'];

export const KNOX_AGENT_PROFILE_DEFAULTS: Record<KnoxResolvedAgentProfile, {
	maxSteps: number;
	doomLoopThreshold: number;
	verifyMode: Exclude<KnoxAgentVerifyMode, 'off'>;
	verifyCommand: string;
}> = {
	default: { maxSteps: 0, doomLoopThreshold: 3, verifyMode: 'diagnostics', verifyCommand: '' },
	rust: { maxSteps: 0, doomLoopThreshold: 4, verifyMode: 'command', verifyCommand: 'cargo check --workspace --all-targets' },
	systems: { maxSteps: 0, doomLoopThreshold: 5, verifyMode: 'command', verifyCommand: 'make' },
};

export interface IKnoxSharedConfig {
	disableSessionTitles?: boolean;
	promptPath?: string;
	agentMaxSteps?: number;
	agentDoomLoopThreshold?: number;
	agentViewSubdirectoryMaxFiles?: number;
	agentProfile?: KnoxAgentProfileSetting;
	agentVerifyCommand?: string;
	agentVerifyMode?: KnoxAgentVerifyMode;
	agentVerifyMaxIterations?: number;
	agentPolicyPaths?: string;
	agentPolicyCommands?: string;
	agentPolicyExternalDirectory?: 'deny' | 'ask' | 'allow';
	agentPolicySandboxDestructive?: boolean;
	showSessionTabs?: boolean;
	codeBlockToolbarPosition?: 'top' | 'bottom';
	fontSize?: number;
	codeWrap?: boolean;
	displayRawMarkdown?: boolean;
	showChatScrollbar?: boolean;
}

export function isKnoxAgentProfileSetting(value: unknown): value is KnoxAgentProfileSetting {
	return value === 'default' || value === 'systems' || value === 'rust' || value === 'auto';
}

export function knoxResolveAgentProfileSetting(raw: unknown): KnoxAgentProfileSetting {
	return isKnoxAgentProfileSetting(raw) ? raw : 'default';
}

export function knoxResolvedAgentProfileForDefaults(raw: unknown): KnoxResolvedAgentProfile {
	const setting = knoxResolveAgentProfileSetting(raw);
	return setting === 'auto' ? 'default' : setting;
}

export function knoxClampFontSize(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return KNOX_DEFAULT_FONT_SIZE;
	}
	return clamp(Math.round(value), KNOX_MIN_FONT_SIZE, KNOX_MAX_FONT_SIZE);
}

export function knoxClampAgentMaxSteps(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}
	return clamp(Math.floor(value), 0, 1000);
}

export function knoxClampDoomLoopThreshold(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return KNOX_AGENT_PROFILE_DEFAULTS.default.doomLoopThreshold;
	}
	return clamp(Math.floor(value), 0, 20);
}

export function knoxClampViewSubdirectoryMaxFiles(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return KNOX_DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES;
	}
	return clamp(Math.floor(value), KNOX_MIN_VIEW_SUBDIRECTORY_MAX_FILES, KNOX_MAX_VIEW_SUBDIRECTORY_MAX_FILES);
}

export function knoxSharedConfigForAgentProfile(profile: KnoxAgentProfileSetting): IKnoxSharedConfig {
	if (profile === 'auto') {
		return { agentProfile: profile };
	}
	const defaults = KNOX_AGENT_PROFILE_DEFAULTS[profile];
	return {
		agentProfile: profile,
		agentDoomLoopThreshold: defaults.doomLoopThreshold,
		agentVerifyMode: defaults.verifyMode,
		agentVerifyCommand: defaults.verifyCommand,
	};
}

export function knoxReadUiBoolean(config: IKnoxSerializedConfig | undefined, key: keyof typeof KNOX_DEFAULT_UI_SETTINGS): boolean {
	if (key === 'disableSessionTitles') {
		return config?.disableSessionTitles ?? KNOX_DEFAULT_UI_SETTINGS.disableSessionTitles;
	}
	const ui = config?.ui;
	const value = ui?.[key];
	return typeof value === 'boolean' ? value : KNOX_DEFAULT_UI_SETTINGS[key];
}

export function knoxReadFontSize(config: IKnoxSerializedConfig | undefined): number {
	return knoxClampFontSize(config?.ui?.fontSize);
}

export function knoxReadAgentMaxSteps(config: IKnoxSerializedConfig | undefined): number {
	const profile = knoxResolvedAgentProfileForDefaults(config?.experimental?.agentProfile);
	const raw = config?.experimental?.agentMaxSteps;
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return knoxClampAgentMaxSteps(raw);
	}
	return KNOX_AGENT_PROFILE_DEFAULTS[profile].maxSteps;
}

export function knoxReadDoomLoopThreshold(config: IKnoxSerializedConfig | undefined): number {
	const profile = knoxResolvedAgentProfileForDefaults(config?.experimental?.agentProfile);
	const raw = config?.experimental?.agentDoomLoopThreshold;
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return knoxClampDoomLoopThreshold(raw);
	}
	return KNOX_AGENT_PROFILE_DEFAULTS[profile].doomLoopThreshold;
}

export function knoxReadViewSubdirectoryMaxFiles(config: IKnoxSerializedConfig | undefined): number {
	return knoxClampViewSubdirectoryMaxFiles(config?.experimental?.agentViewSubdirectoryMaxFiles);
}

/** Optimistic GUI `modifyAnyConfigWithSharedConfig` without importing Core. */
export function knoxApplySharedConfig(
	config: IKnoxSerializedConfig | undefined,
	shared: IKnoxSharedConfig,
): IKnoxSerializedConfig {
	const next: IKnoxSerializedConfig = {
		...config,
		ui: { ...config?.ui },
		experimental: { ...config?.experimental },
	};

	if (shared.codeBlockToolbarPosition !== undefined) {
		next.ui = { ...next.ui, codeBlockToolbarPosition: shared.codeBlockToolbarPosition };
	}
	if (shared.fontSize !== undefined) {
		next.ui = { ...next.ui, fontSize: knoxClampFontSize(shared.fontSize) };
	}
	if (shared.codeWrap !== undefined) {
		next.ui = { ...next.ui, codeWrap: shared.codeWrap };
	}
	if (shared.displayRawMarkdown !== undefined) {
		next.ui = { ...next.ui, displayRawMarkdown: shared.displayRawMarkdown };
	}
	if (shared.showChatScrollbar !== undefined) {
		next.ui = { ...next.ui, showChatScrollbar: shared.showChatScrollbar };
	}
	if (shared.showSessionTabs !== undefined) {
		next.ui = { ...next.ui, showSessionTabs: shared.showSessionTabs };
	}
	if (shared.disableSessionTitles !== undefined) {
		next.disableSessionTitles = shared.disableSessionTitles;
	}
	if (shared.promptPath !== undefined) {
		next.experimental = { ...next.experimental, promptPath: shared.promptPath };
	}
	if (shared.agentMaxSteps !== undefined) {
		next.experimental = { ...next.experimental, agentMaxSteps: knoxClampAgentMaxSteps(shared.agentMaxSteps) };
	}
	if (shared.agentDoomLoopThreshold !== undefined) {
		next.experimental = { ...next.experimental, agentDoomLoopThreshold: knoxClampDoomLoopThreshold(shared.agentDoomLoopThreshold) };
	}
	if (shared.agentViewSubdirectoryMaxFiles !== undefined) {
		next.experimental = {
			...next.experimental,
			agentViewSubdirectoryMaxFiles: knoxClampViewSubdirectoryMaxFiles(shared.agentViewSubdirectoryMaxFiles),
		};
	}
	if (shared.agentProfile !== undefined) {
		next.experimental = { ...next.experimental, agentProfile: shared.agentProfile };
	}
	if (shared.agentVerifyCommand !== undefined) {
		next.experimental = { ...next.experimental, agentVerifyCommand: shared.agentVerifyCommand };
	}
	if (shared.agentVerifyMode !== undefined) {
		next.experimental = { ...next.experimental, agentVerifyMode: shared.agentVerifyMode };
	}
	if (shared.agentVerifyMaxIterations !== undefined) {
		next.experimental = { ...next.experimental, agentVerifyMaxIterations: shared.agentVerifyMaxIterations };
	}

	const hasPolicyUpdate =
		shared.agentPolicyPaths !== undefined
		|| shared.agentPolicyCommands !== undefined
		|| shared.agentPolicyExternalDirectory !== undefined
		|| shared.agentPolicySandboxDestructive !== undefined;
	if (hasPolicyUpdate) {
		const current = next.experimental?.agentPolicy ?? {};
		next.experimental = {
			...next.experimental,
			agentPolicy: {
				...current,
				...(shared.agentPolicyPaths !== undefined ? { paths: knoxParsePolicyLines(shared.agentPolicyPaths) } : {}),
				...(shared.agentPolicyCommands !== undefined ? { commands: knoxParsePolicyLines(shared.agentPolicyCommands) } : {}),
				...(shared.agentPolicyExternalDirectory !== undefined ? { externalDirectory: shared.agentPolicyExternalDirectory } : {}),
				...(shared.agentPolicySandboxDestructive !== undefined ? { sandboxDestructive: shared.agentPolicySandboxDestructive } : {}),
			},
		};
	}

	return next;
}
