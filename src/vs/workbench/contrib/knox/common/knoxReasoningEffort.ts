/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxModelDescription } from './knoxChatTypes.js';

export interface IKnoxReasoningEffortConfig {
	allowed: string[];
	default: string;
}

export const KNOX_DEFAULT_REASONING_EFFORT_CONFIG: IKnoxReasoningEffortConfig = {
	allowed: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'minimal'],
	default: 'medium',
};

export const KNOX_REASONING_EFFORT_LEVELS = KNOX_DEFAULT_REASONING_EFFORT_CONFIG.allowed;

function normalizeReasoningModelId(value: string, provider?: string): string {
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

export function knoxReasoningModelKeys(model: IKnoxModelDescription | undefined): string[] {
	if (!model) {
		return [];
	}
	const keys: string[] = [];
	const add = (value?: string) => {
		if (value && !keys.includes(value)) {
			keys.push(value);
		}
	};
	const id = model.model || model.title;
	if (id) {
		add(normalizeReasoningModelId(id, model.provider) || id);
	}
	add(model.model);
	add(model.title);
	if (model.model) {
		add(normalizeReasoningModelId(model.model, model.provider));
	}
	if (model.title) {
		add(normalizeReasoningModelId(model.title, model.provider));
	}
	return keys;
}

interface IKnoxReasoningMetadata {
	supported_efforts?: string[] | null;
	default_effort?: string;
	mandatory?: boolean;
}

function reasoningFromModel(model: IKnoxModelDescription): IKnoxReasoningMetadata | undefined {
	const completion = model.completionOptions;
	if (!completion || typeof completion !== 'object') {
		return undefined;
	}
	const reasoning = completion['reasoning'];
	if (!reasoning || typeof reasoning !== 'object') {
		return undefined;
	}
	return reasoning as IKnoxReasoningMetadata;
}

export function knoxGetReasoningEffortConfig(model: IKnoxModelDescription | undefined): IKnoxReasoningEffortConfig | null {
	if (!model) {
		return null;
	}
	const params = model.supportedParameters ?? [];
	const reasoning = reasoningFromModel(model);
	const advertised = params.includes('reasoning_effort')
		|| (reasoning !== undefined && ('supported_efforts' in reasoning || Array.isArray(reasoning.supported_efforts)));
	if (!advertised) {
		return null;
	}

	let allowed: string[] | null = null;
	if (reasoning?.supported_efforts === null) {
		allowed = [...KNOX_DEFAULT_REASONING_EFFORT_CONFIG.allowed];
	} else if (Array.isArray(reasoning?.supported_efforts) && reasoning.supported_efforts.length) {
		allowed = [...reasoning.supported_efforts];
	} else if (params.includes('reasoning_effort')) {
		allowed = [...KNOX_DEFAULT_REASONING_EFFORT_CONFIG.allowed];
	}
	if (!allowed) {
		return null;
	}
	if (reasoning?.mandatory) {
		allowed = allowed.filter(value => value !== 'none');
	}
	if (!allowed.length) {
		return null;
	}
	const preferred = reasoning?.default_effort && allowed.includes(reasoning.default_effort)
		? reasoning.default_effort
		: allowed.includes(KNOX_DEFAULT_REASONING_EFFORT_CONFIG.default)
			? KNOX_DEFAULT_REASONING_EFFORT_CONFIG.default
			: allowed[0];
	return { allowed, default: preferred };
}

export function knoxResolveReasoningEffort(
	model: IKnoxModelDescription | undefined,
	stickyByModel?: Record<string, string> | null,
	legacySelectedEffort?: string | null,
): string | undefined {
	const config = knoxGetReasoningEffortConfig(model);
	if (!config) {
		return undefined;
	}
	for (const key of knoxReasoningModelKeys(model)) {
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

export function knoxParseReasoningEffortByModel(raw: string | undefined): Record<string, string> {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === 'string' && value) {
				out[key] = value;
			}
		}
		return out;
	} catch {
		return {};
	}
}
