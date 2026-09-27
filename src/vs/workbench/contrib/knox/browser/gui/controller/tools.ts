/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, parseAskQuestions } from './helpers.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { ASK_USER_TOOL_NAMES, FILE_EDIT_TOOL_NAMES, parseToolArgs } from '../../../common/knoxGuiChat.js';
import { mergeToolArguments, toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { IKnoxGuiToolCall, KnoxPermissionMode, KnoxToolSetting, nextToolSetting } from '../../../common/knoxGuiState.js';

export function cycleToolPermission(controller: KnoxGuiController, name: string): void {
	if (controller.store.state.sessionToolAllowlist.includes(name)) {
		controller.store.patch({ sessionToolAllowlist: controller.store.state.sessionToolAllowlist.filter(item => item !== name) });
		return;
	}
	controller.cycleToolSetting(name);
	if (controller.store.state.toolSettings[name] === 'allowedWithoutPermission') {
		controller.store.patch({ sessionToolAllowlist: controller.store.state.sessionToolAllowlist.filter(item => item !== name) });
	}
}

export function cycleToolSetting(controller: KnoxGuiController, name: string): void {
	const current = controller.store.state.toolSettings[name] ?? 'allowedWithoutPermission';
	controller.store.patch({ toolSettings: { ...controller.store.state.toolSettings, [name]: nextToolSetting(current) } });
	void controller.syncPendingTools();
}

export function applyToolPreset(controller: KnoxGuiController, preset: 'safe' | 'yolo'): void {
	const settings: Record<string, KnoxToolSetting> = { ...controller.store.state.toolSettings };
	for (const tool of controller.store.state.tools) {
		settings[tool.name] = preset === 'yolo' || tool.readonly ? 'allowedWithoutPermission' : 'allowedWithPermission';
	}
	controller.store.patch({ toolSettings: settings });
	void controller.syncPendingTools();
}

export function toggleToolGroup(controller: KnoxGuiController, group: string): void {
	const excluded = controller.store.state.toolGroupExcluded;
	controller.store.patch({
		toolGroupExcluded: excluded.includes(group) ? excluded.filter(item => item !== group): [...excluded, group],
	});
}

export function cancelTool(controller: KnoxGuiController, id: string): void {
	controller.patchTool(id, { status: 'canceled', output: 'Canceled' });
	controller.messenger.post('tools/cancel', { toolCallId: id });
	controller.streamCancel?.cancel();
	controller.store.setStreaming(false);
}

export function denyTool(controller: KnoxGuiController, id: string): void {
	controller.patchTool(id, { status: 'canceled', output: 'Denied' });
	controller.messenger.post('tools/cancel', { toolCallId: id });
}

export function answerAskUser(controller: KnoxGuiController, id: string, answers: Record<string, string>): void {
	const call = controller.findTool(id);
	if (!call) {
		return;
	}
	const parsed = { ...(call.parsedArgs ?? parseToolArgs(call.arguments)), answers };
	controller.patchTool(id, {
		answers,
		parsedArgs: parsed,
		arguments: JSON.stringify(parsed),
		status: 'generated',
	});
	void controller.approveTool(id);
}

export function shouldAutoApprove(controller: KnoxGuiController, call: IKnoxGuiToolCall): boolean {
	if (ASK_USER_TOOL_NAMES.has(call.name)) {
		return false;
	}
	if (controller.store.state.toolGroupExcluded.some(group => controller.store.state.tools.find(tool => tool.name === call.name && tool.group === group))) {
		return false;
	}
	const setting = controller.store.state.toolSettings[call.name] ?? 'allowedWithoutPermission';
	if (setting === 'disabled') {
		return false;
	}
	if (controller.store.state.sessionToolAllowlist.includes(call.name) || setting === 'allowedWithoutPermission') {
		return true;
	}
	if (controller.store.state.permissionMode === 'fullAuto') {
		return true;
	}
	return controller.store.state.permissionMode === 'acceptEdits' && FILE_EDIT_TOOL_NAMES.has(call.name);
}

export async function resolveTools(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[]): Promise<void> {
	for (const call of toolCalls) {
		const setting = controller.store.state.toolSettings[call.name] ?? 'allowedWithoutPermission';
		if (setting === 'disabled') {
			controller.denyTool(call.id);
		} else if (controller.shouldAutoApprove(call)) {
			await controller.approveTool(call.id);
		}
	}
}

export async function syncPendingTools(controller: KnoxGuiController): Promise<void> {
	for (const item of controller.store.state.history) {
		for (const call of item.toolCalls ?? []) {
			if (call.status !== 'generated') {
				continue;
			}
			if ((controller.store.state.toolSettings[call.name] ?? 'allowedWithoutPermission') === 'disabled') {
				controller.denyTool(call.id);
			} else if (controller.shouldAutoApprove(call)) {
				await controller.approveTool(call.id);
			}
		}
	}
}

export function mergeToolCalls(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[], raw: unknown[]): void {
	for (const callUnknown of raw) {
		const call = asRecord(callUnknown);
		if (!call) {
			continue;
		}
		const id = String(call.id ?? generateUuid());
		const incomingArgs = String(asRecord(call.function)?.arguments ?? call.arguments ?? '');
		const existing = toolCalls.find(item => item.id === id);
		const args = mergeToolArguments(existing?.arguments ?? '', incomingArgs);
		const parsed = parseToolArgs(args);
		const name = String(asRecord(call.function)?.name ?? call.name ?? existing?.name ?? 'tool');
		const next: IKnoxGuiToolCall = {
			id,
			name,
			arguments: args,
			status: existing && (existing.status === 'calling' || existing.status === 'done' || existing.status === 'canceled' || existing.status === 'errored')
				? existing.status
				: 'generating',
			parsedArgs: parsed,
			questions: parseAskQuestions(parsed),
			output: existing?.output,
			outputItems: existing?.outputItems,
			answers: existing?.answers,
		};
		if (existing) {
			Object.assign(existing, next);
		} else {
			toolCalls.push(next);
		}
	}
}

export function finalizeGeneratingTools(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[]): void {
	for (const call of toolCalls) {
		if (call.status === 'generating') {
			call.status = 'generated';
		}
	}
}

export function applyPartialToolOutput(controller: KnoxGuiController, id: string, value: unknown): void {
	const current = controller.findTool(id);
	if (!current || current.status === 'done' || current.status === 'canceled' || current.status === 'errored') {
		return;
	}
	const items = toolOutputItemsFromUnknown(value);
	controller.patchTool(id, { outputItems: items, output: toolOutputText(items) });
}

export function cancelInFlightTools(controller: KnoxGuiController): void {
	const history = controller.store.state.history.map(item => {
		if (!item.toolCalls?.length) {
			return item;
		}
		return {
			...item,
			toolCalls: item.toolCalls.map(call =>
				call.status === 'generating' || call.status === 'calling'
					? { ...call, status: 'canceled' as const }
					: call),
		};
	});
	controller.store.patch({ history });
}

export function findTool(controller: KnoxGuiController, id: string): IKnoxGuiToolCall | undefined {
	for (const item of controller.store.state.history) {
		const found = item.toolCalls?.find(call => call.id === id);
		if (found) {
			return found;
		}
	}
	return undefined;
}

export function patchTool(controller: KnoxGuiController, id: string, patch: Partial<IKnoxGuiToolCall>): void {
	const history = controller.store.state.history.map(item => {
		if (!item.toolCalls) {
			return item;
		}
		return { ...item, toolCalls: item.toolCalls.map(call => call.id === id ? { ...call, ...patch } : call) };
	});
	controller.store.patch({ history });
}

export function setPermissionMode(controller: KnoxGuiController, mode: KnoxPermissionMode): void {
	controller.store.setPermissionMode(mode);
	void controller.syncPendingTools();
}
