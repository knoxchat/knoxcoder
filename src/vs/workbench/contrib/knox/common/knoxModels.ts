/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxModelDescription, IKnoxSerializedConfig, KnoxModelRole } from './knoxChatTypes.js';

/** GUI ModelsSection order, plus summarize from T5.4. */
export const KNOX_MODEL_ROLES: readonly KnoxModelRole[] = [
	'chat',
	'edit',
	'apply',
	'summarize',
	'viewRead',
	'realTimeSearch',
];

export function knoxModelRoleUsesChatFallback(role: KnoxModelRole): boolean {
	return role === 'chat' || role === 'apply' || role === 'edit';
}

export function knoxModelsForRole(
	config: IKnoxSerializedConfig | undefined,
	role: KnoxModelRole,
): IKnoxModelDescription[] {
	const byRole = config?.modelsByRole;
	if (byRole && Object.prototype.hasOwnProperty.call(byRole, role)) {
		return [...(byRole[role] ?? [])];
	}
	return (config?.models ?? []).filter(model => !model.roles || model.roles.includes(role));
}

export function knoxFindModelByTitle(
	models: readonly IKnoxModelDescription[] | undefined,
	title: string | null | undefined,
): IKnoxModelDescription | undefined {
	if (!title) {
		return undefined;
	}
	return models?.find(model => model.title === title);
}

export function knoxSelectedModelForRole(
	config: IKnoxSerializedConfig | undefined,
	role: KnoxModelRole,
	chatTitle?: string,
): IKnoxModelDescription | undefined {
	const selected = config?.selectedModelByRole?.[role] ?? undefined;
	if (selected) {
		return selected;
	}
	if (role === 'chat' && chatTitle) {
		return knoxFindModelByTitle(knoxModelsForRole(config, 'chat'), chatTitle)
			?? knoxFindModelByTitle(config?.models, chatTitle);
	}
	return undefined;
}

export function knoxFindModelForRole(
	config: IKnoxSerializedConfig | undefined,
	role: KnoxModelRole,
	title: string | null | undefined,
): IKnoxModelDescription | undefined {
	if (!title) {
		return undefined;
	}
	return knoxFindModelByTitle(knoxModelsForRole(config, role), title)
		?? knoxFindModelByTitle(config?.models, title)
		?? { title };
}

export interface IKnoxChatModelOption {
	value: string;
	title: string;
	apiKey?: string;
	missingApiKey: boolean;
}

export function knoxModelSelectTitle(model: IKnoxModelDescription | undefined): string {
	if (!model) {
		return '';
	}
	if (model.title) {
		return model.title;
	}
	if (model.model?.trim()) {
		return model.model;
	}
	return '';
}

export function knoxChatModelOptions(models: readonly IKnoxModelDescription[] | undefined): IKnoxChatModelOption[] {
	const chat = (models ?? []).filter(model => !model.roles || model.roles.includes('chat'));
	const options = chat.map(model => ({
		value: model.title,
		title: knoxModelSelectTitle(model) || model.title,
		apiKey: model.apiKey,
		missingApiKey: model.apiKey === '',
	}));
	const enabled = options.filter(option => !option.missingApiKey);
	const disabled = options.filter(option => option.missingApiKey);
	return [...enabled, ...disabled];
}

/**
 * Sync port of GUI `modelSupportsTools` without the KnoxChat /v1/models cache.
 * Prefer persisted `capabilities.tools` / `supportedParameters`, then provider heuristics.
 */
export function knoxModelSupportsTools(model: IKnoxModelDescription | undefined): boolean {
	if (!model) {
		return false;
	}
	if (model.capabilities?.tools !== undefined) {
		return model.capabilities.tools;
	}
	const params = model.supportedParameters ?? [];
	if (params.includes('tools') || params.includes('tool_choice') || params.includes('functions')) {
		return true;
	}
	const provider = (model.provider ?? '').toLowerCase();
	const id = (model.model ?? model.title ?? '').toLowerCase();
	if (provider === 'knoxchat') {
		return true;
	}
	if (provider === 'anthropic') {
		return ['claude-fable', 'claude-sonnet', 'claude-opus', 'claude-haiku'].some(part => id.startsWith(part) || id.includes(part));
	}
	if (provider === 'openai') {
		return id.startsWith('gpt-5')
			|| id.startsWith('o3')
			|| id.startsWith('gemini')
			|| id.startsWith('claude-sonnet')
			|| id.startsWith('claude-opus')
			|| id.startsWith('claude-haiku')
			|| id.startsWith('claude-fable');
	}
	return false;
}

export function knoxNextChatModelTitle(
	options: readonly IKnoxChatModelOption[],
	currentTitle: string | undefined,
	direction: 1 | -1,
): string | undefined {
	if (!options.length) {
		return undefined;
	}
	const currentIndex = options.findIndex(option => option.value === currentTitle);
	let nextIndex = currentIndex < 0
		? (direction === 1 ? 0 : options.length - 1)
		: (currentIndex + direction) % options.length;
	if (nextIndex < 0) {
		nextIndex = options.length - 1;
	}
	return options[nextIndex]?.value;
}
