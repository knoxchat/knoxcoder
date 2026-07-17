/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Setting IDs for agent sandboxing.
 */
export const enum AgentSandboxSettingId {
	AgentSandboxEnabled = 'assist.agent.sandbox.enabled',
	AgentSandboxWindowsEnabled = 'assist.agent.sandbox.enabledWindows',
	AgentSandboxAllowNetwork = 'assist.agent.sandbox.allowNetwork',
	AgentSandboxAllowUnsandboxedCommands = 'assist.agent.sandbox.allowUnsandboxedCommands',
	AgentSandboxRetryWithAllowNetworkRequests = 'assist.agent.sandbox.retryWithAllowNetworkRequests',
	AgentSandboxAllowAutoApprove = 'assist.agent.sandbox.allowAutoApprove',
	AgentSandboxLinuxFileSystem = 'assist.agent.sandbox.fileSystem.linux',
	AgentSandboxMacFileSystem = 'assist.agent.sandbox.fileSystem.mac',
	AgentSandboxWindowsFileSystem = 'assist.agent.sandbox.fileSystem.windows',
	AgentSandboxWindowsSchemaVersion = 'assist.agent.sandbox.advanced.windows.schemaVersion',
	AgentSandboxAdvancedRuntime = 'assist.agent.sandbox.advanced.runtime',
	DeprecatedAgentSandboxEnabled = 'assist.agent.sandbox',
	DeprecatedAgentSandboxLinuxFileSystem = 'assist.agent.sandboxFileSystem.linux',
	DeprecatedAgentSandboxMacFileSystem = 'assist.agent.sandboxFileSystem.mac',
}

export const enum AgentSandboxEnabledValue {
	Off = 'off',
	On = 'on',
	AllowNetwork = 'allowNetwork',
}

export type AgentSandboxEnabledSettingValue = AgentSandboxEnabledValue | boolean;

export function normalizeAgentSandboxEnabledValue(value: AgentSandboxEnabledSettingValue): AgentSandboxEnabledValue {
	if (value === true) {
		return AgentSandboxEnabledValue.On;
	}
	if (value === false) {
		return AgentSandboxEnabledValue.Off;
	}
	return value;
}

export function isAgentSandboxEnabledValue(value: AgentSandboxEnabledSettingValue | undefined): boolean {
	return value !== undefined && normalizeAgentSandboxEnabledValue(value) !== AgentSandboxEnabledValue.Off;
}
