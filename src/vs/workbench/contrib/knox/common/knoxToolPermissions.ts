/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IKnoxAgentPolicy,
	IKnoxPolicyRule,
	IKnoxTool,
	IKnoxToolCallState,
	KnoxExternalDirectoryMode,
	KnoxPolicyAction,
} from './knoxChatTypes.js';
import { KnoxBuiltInToolName, resolveBuiltInToolName } from './knoxToolNames.js';

export type KnoxToolSetting = 'allowedWithPermission' | 'allowedWithoutPermission' | 'disabled';
export type KnoxToolGroupSetting = 'include' | 'exclude';
export type KnoxToolPermissionPreset = 'safe' | 'yolo';
export type KnoxToolPermissionDisplay = 'disabled' | 'autoApprove' | 'sessionAlways' | 'requiresApproval';

/** Fallback for unknown tools — auto-approve (users can switch to ask-first). */
export const KNOX_DEFAULT_TOOL_SETTING: KnoxToolSetting = 'allowedWithoutPermission';

export const KNOX_DEFAULT_AGENT_TOOL_POLICY: Required<IKnoxAgentPolicy> = {
	paths: [
		{ pattern: '~/.ssh/**', action: 'deny' },
		{ pattern: '~/.gnupg/**', action: 'deny' },
		{ pattern: '~/.aws/**', action: 'deny' },
	],
	commands: [
		{ pattern: 'rm -rf *', action: 'deny' },
		{ pattern: 'rm -fr *', action: 'deny' },
	],
	externalDirectory: 'ask',
	sandboxDestructive: true,
};

export const KNOX_FILE_EDIT_TOOLS = new Set<string>([
	KnoxBuiltInToolName.CreateNewFile,
	KnoxBuiltInToolName.EditFile,
	KnoxBuiltInToolName.WriteFile,
	KnoxBuiltInToolName.ApplyPatch,
	KnoxBuiltInToolName.GenerateTests,
	'composite_smart_edit',
]);

const READ_WITHOUT_PERMISSION = new Set<string>([
	KnoxBuiltInToolName.ReadFile,
	KnoxBuiltInToolName.ReadCurrentlyOpenFile,
	KnoxBuiltInToolName.ViewSubdirectory,
	KnoxBuiltInToolName.Glob,
	KnoxBuiltInToolName.ViewRepoMap,
	KnoxBuiltInToolName.ExactSearch,
	KnoxBuiltInToolName.ViewDiff,
	KnoxBuiltInToolName.Lsp,
	KnoxBuiltInToolName.Skill,
	KnoxBuiltInToolName.Memory,
	KnoxBuiltInToolName.MemoryGraph,
	KnoxBuiltInToolName.MemorySessions,
	KnoxBuiltInToolName.MemoryManage,
	KnoxBuiltInToolName.MemoryLearn,
	KnoxBuiltInToolName.AwaitShell,
	KnoxBuiltInToolName.PtyRead,
	KnoxBuiltInToolName.GitStatus,
	KnoxBuiltInToolName.GitDiff,
	KnoxBuiltInToolName.GitLog,
	KnoxBuiltInToolName.GitBlame,
	KnoxBuiltInToolName.Kconfig,
	KnoxBuiltInToolName.Plan,
]);

const ASK_FIRST = new Set<string>([
	KnoxBuiltInToolName.CreateNewFile,
	KnoxBuiltInToolName.EditFile,
	KnoxBuiltInToolName.WriteFile,
	KnoxBuiltInToolName.ApplyPatch,
	KnoxBuiltInToolName.RunTerminalCommand,
	KnoxBuiltInToolName.Build,
	KnoxBuiltInToolName.PtyStart,
	KnoxBuiltInToolName.PtySend,
	KnoxBuiltInToolName.SearchWeb,
	KnoxBuiltInToolName.GenerateTests,
	KnoxBuiltInToolName.Task,
	KnoxBuiltInToolName.AskUser,
	KnoxBuiltInToolName.GitCommit,
	KnoxBuiltInToolName.GitBisect,
	KnoxBuiltInToolName.Qemu,
	KnoxBuiltInToolName.Debug,
	KnoxBuiltInToolName.WorkspaceCheckpoint,
]);

export function knoxResolvePermissionToolName(name: string | undefined | null): string {
	return resolveBuiltInToolName(name) || name?.trim() || '';
}

export function knoxIsSamePermissionTool(
	left: string | undefined | null,
	right: string | undefined | null,
): boolean {
	const a = knoxResolvePermissionToolName(left);
	const b = knoxResolvePermissionToolName(right);
	return a.length > 0 && a === b;
}

export function knoxDefaultSettingForTool(_toolName: string, _readonly?: boolean): KnoxToolSetting {
	return KNOX_DEFAULT_TOOL_SETTING;
}

export function knoxSafeSettingForTool(toolName: string, readonly?: boolean): KnoxToolSetting {
	if (READ_WITHOUT_PERMISSION.has(toolName) || readonly) {
		return 'allowedWithoutPermission';
	}
	if (ASK_FIRST.has(toolName)) {
		return 'allowedWithPermission';
	}
	return 'allowedWithPermission';
}

function builtInCatalog(): Array<{ name: string; readonly?: boolean }> {
	return Object.values(KnoxBuiltInToolName).map(name => ({
		name,
		readonly: READ_WITHOUT_PERMISSION.has(name),
	}));
}

export function knoxBuildToolSettingsForPreset(
	tools: Array<{ name: string; readonly?: boolean }>,
	preset: KnoxToolPermissionPreset,
): Record<string, KnoxToolSetting> {
	const settings: Record<string, KnoxToolSetting> = {};
	for (const tool of tools) {
		settings[tool.name] = preset === 'yolo'
			? 'allowedWithoutPermission'
			: knoxSafeSettingForTool(tool.name, tool.readonly);
	}
	return settings;
}

export function knoxBuiltInSafeToolSettings(): Record<string, KnoxToolSetting> {
	return knoxBuildToolSettingsForPreset(builtInCatalog(), 'safe');
}

export function knoxBuiltInAutoApproveToolSettings(): Record<string, KnoxToolSetting> {
	return knoxBuildToolSettingsForPreset(builtInCatalog(), 'yolo');
}

export function knoxApplyPresetToExistingSettings(
	current: Record<string, KnoxToolSetting>,
	tools: readonly IKnoxTool[],
	preset: KnoxToolPermissionPreset,
): Record<string, KnoxToolSetting> {
	const catalog = tools.map(tool => ({
		name: tool.function.name,
		readonly: tool.readonly,
	}));
	const next = knoxBuildToolSettingsForPreset(catalog, preset);
	for (const [name, setting] of Object.entries(current)) {
		if (!(name in next)) {
			next[name] = preset === 'yolo' ? 'allowedWithoutPermission' : setting;
		}
	}
	return next;
}

export function knoxCycleToolSetting(setting: KnoxToolSetting | undefined): KnoxToolSetting {
	switch (setting) {
		case 'allowedWithPermission':
			return 'allowedWithoutPermission';
		case 'allowedWithoutPermission':
			return 'disabled';
		case 'disabled':
			return 'allowedWithPermission';
		default:
			return KNOX_DEFAULT_TOOL_SETTING;
	}
}

export function knoxToggleToolGroupSetting(setting: KnoxToolGroupSetting | undefined): KnoxToolGroupSetting {
	return setting === 'include' || setting === undefined ? 'exclude' : 'include';
}

export function knoxEnsureToolSetting(
	settings: Record<string, KnoxToolSetting>,
	tool: IKnoxTool,
): Record<string, KnoxToolSetting> {
	const name = tool.function.name;
	if (settings[name] !== undefined) {
		return settings;
	}
	return { ...settings, [name]: knoxDefaultSettingForTool(name, tool.readonly) };
}

export function knoxGetToolPermissionDisplay(params: {
	toolName: string;
	toolSettings: Record<string, KnoxToolSetting>;
	sessionAllowlist?: readonly string[];
}): KnoxToolPermissionDisplay {
	const toolName = knoxResolvePermissionToolName(params.toolName);
	const setting = params.toolSettings[toolName] ?? KNOX_DEFAULT_TOOL_SETTING;
	if (setting === 'disabled') {
		return 'disabled';
	}
	if (setting === 'allowedWithoutPermission') {
		return 'autoApprove';
	}
	if (params.sessionAllowlist?.some(allowed => knoxIsSamePermissionTool(allowed, toolName))) {
		return 'sessionAlways';
	}
	return 'requiresApproval';
}

export function knoxParseTools(raw: unknown): IKnoxTool[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const tools: IKnoxTool[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		const fn = record.function;
		if (!fn || typeof fn !== 'object') {
			continue;
		}
		const name = (fn as { name?: unknown }).name;
		if (typeof name !== 'string' || !name) {
			continue;
		}
		tools.push({
			type: record.type === 'function' ? 'function' : undefined,
			function: {
				name,
				description: typeof (fn as { description?: unknown }).description === 'string'
					? (fn as { description: string }).description
					: undefined,
			},
			displayTitle: typeof record.displayTitle === 'string' ? record.displayTitle : undefined,
			wouldLikeTo: typeof record.wouldLikeTo === 'string' ? record.wouldLikeTo : undefined,
			isCurrently: typeof record.isCurrently === 'string' ? record.isCurrently : undefined,
			hasAlready: typeof record.hasAlready === 'string' ? record.hasAlready : undefined,
			readonly: record.readonly === true,
			uri: typeof record.uri === 'string' ? record.uri : undefined,
			faviconUrl: typeof record.faviconUrl === 'string' ? record.faviconUrl : undefined,
			group: typeof record.group === 'string' && record.group ? record.group : 'Built-in',
		});
	}
	return tools;
}

export function knoxToolsByGroup(tools: readonly IKnoxTool[]): Array<[string, IKnoxTool[]]> {
	const byGroup = new Map<string, IKnoxTool[]>();
	for (const tool of tools) {
		const group = tool.group || 'Built-in';
		const list = byGroup.get(group) ?? [];
		list.push(tool);
		byGroup.set(group, list);
	}
	return [...byGroup.entries()];
}

export function knoxDuplicateToolNames(tools: readonly IKnoxTool[]): Record<string, boolean> {
	const counts: Record<string, number> = {};
	for (const tool of tools) {
		const name = tool.function.name;
		counts[name] = (counts[name] ?? 0) + 1;
	}
	const duplicates: Record<string, boolean> = {};
	for (const [name, count] of Object.entries(counts)) {
		duplicates[name] = count > 1;
	}
	return duplicates;
}

export function knoxFormatToolName(tool: IKnoxTool | string): string {
	if (typeof tool !== 'string' && tool.displayTitle) {
		return tool.displayTitle;
	}
	const functionName = typeof tool === 'string' ? tool : tool.function.name;
	return functionName
		.replace(/^builtin_/, '')
		.split('_')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function knoxCategorizedToolName(tool: IKnoxTool | string): string {
	const functionName = typeof tool === 'string' ? tool : tool.function.name;
	const formattedName = knoxFormatToolName(tool);
	let category = '[Tool]';
	if (functionName.includes('memory')) {
		category = '[Memory]';
	} else if (functionName.includes('file') || functionName.includes('directory') || functionName.includes('map')) {
		category = '[Files]';
	} else if (functionName.includes('search')) {
		category = '[Search]';
	} else if (functionName.includes('terminal') || functionName.includes('command')) {
		category = '[Terminal]';
	} else if (functionName.includes('diff')) {
		category = '[Diff]';
	} else if (functionName.includes('web')) {
		category = '[Web]';
	}
	return `${category} ${formattedName}`;
}

export function knoxParsePolicyLine(line: string): IKnoxPolicyRule | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return null;
	}
	const match = trimmed.match(/^(allow|ask|deny)\s+(.+)$/i);
	if (!match) {
		return null;
	}
	return {
		action: match[1].toLowerCase() as KnoxPolicyAction,
		pattern: match[2].trim(),
	};
}

export function knoxFormatPolicyLines(rules: readonly IKnoxPolicyRule[] | undefined): string {
	return (rules ?? []).map(rule => `${rule.action} ${rule.pattern}`).join('\n');
}

export function knoxParsePolicyLines(text: string | undefined): IKnoxPolicyRule[] {
	if (!text) {
		return [];
	}
	const rules: IKnoxPolicyRule[] = [];
	for (const line of text.split('\n')) {
		const rule = knoxParsePolicyLine(line);
		if (rule) {
			rules.push(rule);
		}
	}
	return rules;
}

export function knoxParseAgentPolicy(raw: unknown): IKnoxAgentPolicy | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const policy: IKnoxAgentPolicy = {};
	const paths = knoxParsePolicyRuleList(record.paths);
	if (paths) {
		policy.paths = paths;
	}
	const commands = knoxParsePolicyRuleList(record.commands);
	if (commands) {
		policy.commands = commands;
	}
	if (record.externalDirectory === 'deny' || record.externalDirectory === 'ask' || record.externalDirectory === 'allow') {
		policy.externalDirectory = record.externalDirectory;
	}
	if (typeof record.sandboxDestructive === 'boolean') {
		policy.sandboxDestructive = record.sandboxDestructive;
	}
	return policy;
}

function knoxParsePolicyRuleList(raw: unknown): IKnoxPolicyRule[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const rules: IKnoxPolicyRule[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const pattern = (item as { pattern?: unknown }).pattern;
		const action = (item as { action?: unknown }).action;
		if (typeof pattern !== 'string' || !pattern) {
			continue;
		}
		if (action !== 'allow' && action !== 'ask' && action !== 'deny') {
			continue;
		}
		rules.push({ pattern, action });
	}
	return rules;
}

export function knoxPolicyEditorState(policy: IKnoxAgentPolicy | undefined): {
	paths: string;
	commands: string;
	externalDirectory: KnoxExternalDirectoryMode;
	sandboxDestructive: boolean;
} {
	return {
		paths: knoxFormatPolicyLines(policy?.paths) || knoxFormatPolicyLines(KNOX_DEFAULT_AGENT_TOOL_POLICY.paths),
		commands: knoxFormatPolicyLines(policy?.commands) || knoxFormatPolicyLines(KNOX_DEFAULT_AGENT_TOOL_POLICY.commands),
		externalDirectory: policy?.externalDirectory ?? KNOX_DEFAULT_AGENT_TOOL_POLICY.externalDirectory,
		sandboxDestructive: policy?.sandboxDestructive ?? KNOX_DEFAULT_AGENT_TOOL_POLICY.sandboxDestructive,
	};
}

export function knoxParseStoredToolSettings(raw: string | undefined): Record<string, KnoxToolSetting> {
	if (!raw) {
		return knoxBuiltInAutoApproveToolSettings();
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return knoxBuiltInAutoApproveToolSettings();
		}
		const settings: Record<string, KnoxToolSetting> = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (value === 'allowedWithPermission' || value === 'allowedWithoutPermission' || value === 'disabled') {
				settings[name] = value;
			}
		}
		return { ...knoxBuiltInAutoApproveToolSettings(), ...settings };
	} catch {
		return knoxBuiltInAutoApproveToolSettings();
	}
}

export function knoxParseStoredToolGroupSettings(raw: string | undefined): Record<string, KnoxToolGroupSetting> {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		const settings: Record<string, KnoxToolGroupSetting> = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (value === 'include' || value === 'exclude') {
				settings[name] = value;
			}
		}
		return settings;
	} catch {
		return {};
	}
}

export function knoxIsToolAutoApproved(params: {
	toolName: string;
	toolSettings: Record<string, KnoxToolSetting>;
	permissionMode: 'default' | 'acceptEdits' | 'fullAuto';
	sessionAllowlist?: readonly string[];
}): boolean {
	const toolName = knoxResolvePermissionToolName(params.toolName);
	const setting = params.toolSettings[toolName] ?? params.toolSettings[params.toolName] ?? KNOX_DEFAULT_TOOL_SETTING;
	if (setting === 'disabled') {
		return false;
	}
	if (toolName === KnoxBuiltInToolName.AskUser) {
		return false;
	}
	if (params.sessionAllowlist?.some(allowed => knoxIsSamePermissionTool(allowed, toolName))) {
		return true;
	}
	if (params.permissionMode === 'fullAuto') {
		return true;
	}
	if (params.permissionMode === 'acceptEdits' && KNOX_FILE_EDIT_TOOLS.has(toolName)) {
		return true;
	}
	return setting === 'allowedWithoutPermission';
}

/** True when the pending generated tool should run with no Deny/Always/Approve UI. */
export function knoxIsCurrentToolAutoApproved(params: {
	toolCall: IKnoxToolCallState | undefined;
	toolSettings: Record<string, KnoxToolSetting>;
	permissionMode: 'default' | 'acceptEdits' | 'fullAuto';
	sessionAllowlist?: readonly string[];
}): boolean {
	if (!params.toolCall || params.toolCall.status !== 'generated') {
		return false;
	}
	const toolName = knoxResolvePermissionToolName(params.toolCall.toolCall.function.name);
	if (!toolName || toolName === KnoxBuiltInToolName.AskUser) {
		return false;
	}
	return knoxIsToolAutoApproved({
		toolName,
		toolSettings: params.toolSettings,
		permissionMode: params.permissionMode,
		sessionAllowlist: params.sessionAllowlist,
	});
}

export function knoxShouldShowPermissionButtons(params: {
	pending: IKnoxToolCallState | undefined;
	targetName?: string;
	toolSettings: Record<string, KnoxToolSetting>;
	permissionMode: 'default' | 'acceptEdits' | 'fullAuto';
	sessionAllowlist?: readonly string[];
}): boolean {
	const pendingName = knoxResolvePermissionToolName(params.pending?.toolCall.function.name);
	const targetName = knoxResolvePermissionToolName(params.targetName) || pendingName;
	const isPending = params.pending?.status === 'generated'
		&& pendingName.length > 0
		&& knoxIsSamePermissionTool(pendingName, targetName)
		&& pendingName !== KnoxBuiltInToolName.AskUser;
	if (!isPending || !params.pending) {
		return false;
	}
	return !knoxIsCurrentToolAutoApproved({
		toolCall: params.pending,
		toolSettings: params.toolSettings,
		permissionMode: params.permissionMode,
		sessionAllowlist: params.sessionAllowlist,
	});
}
