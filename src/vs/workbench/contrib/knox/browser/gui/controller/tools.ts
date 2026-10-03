/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { isAskUserToolName, parseToolArgs } from '../../../common/knoxGuiChat.js';
import { isSamePermissionTool, mergeStreamedToolCalls, resolveAskUserQuestions, toolOutputItemsFromUnknown, toolOutputText } from '../../../common/knoxGuiTools.js';
import { IKnoxGuiToolCall, KnoxPermissionMode, knoxGuiApplyToolPreset, nextPermissionMode, nextToolSetting } from '../../../common/knoxGuiState.js';
import { isAutonomousRunning, resolveAutonomousTool } from './stream.js';
import { isSharedTurnActive } from './sharedTurn.js';
import { KNOX_DENIED_TOOL_OUTPUT, KnoxGuiToolDecision, knoxGuiAskUserInvalidOutput, knoxGuiAskUserOutput, knoxGuiLocalAutoApprove, knoxGuiMissingToolOutput, knoxGuiToolIsSettled } from '../../../common/knoxGuiAgentRequest.js';

export function cycleToolPermission(controller: KnoxGuiController, name: string): void {
	const tools = controller.store.state.tools;
	const allowlist = controller.store.state.sessionToolAllowlist;
	if (allowlist.some(item => isSamePermissionTool(item, name, tools))) {
		controller.store.patch({ sessionToolAllowlist: allowlist.filter(item => !isSamePermissionTool(item, name, tools)) });
		return;
	}
	controller.cycleToolSetting(name);
	if (controller.store.state.toolSettings[name] === 'allowedWithoutPermission') {
		controller.store.patch({ sessionToolAllowlist: controller.store.state.sessionToolAllowlist.filter(item => !isSamePermissionTool(item, name, tools)) });
	}
}

export function cycleToolSetting(controller: KnoxGuiController, name: string): void {
	const current = controller.store.state.toolSettings[name] ?? 'allowedWithoutPermission';
	controller.store.patch({ toolSettings: { ...controller.store.state.toolSettings, [name]: nextToolSetting(current) } });
	void controller.syncPendingTools();
}

export function applyToolPreset(controller: KnoxGuiController, preset: 'safe' | 'yolo'): void {
	controller.store.patch({ toolSettings: knoxGuiApplyToolPreset(controller.store.state.toolSettings, controller.store.state.tools, preset) });
	void controller.syncPendingTools();
}

export function toggleToolGroup(controller: KnoxGuiController, group: string): void {
	const excluded = controller.store.state.toolGroupExcluded;
	controller.store.patch({
		toolGroupExcluded: excluded.includes(group) ? excluded.filter(item => item !== group) : [...excluded, group],
	});
}

export function cancelTool(controller: KnoxGuiController, id: string): void {
	if ((isAutonomousRunning(controller) || isSharedTurnActive(controller)) && controller.findTool(id)?.status === 'generated') {
		resolveAutonomousTool(controller, id, false);
		return;
	}
	controller.patchTool(id, { status: 'canceled', output: 'Canceled' });
	controller.messenger.post('tools/cancel', { toolCallId: id });
	controller.streamCancel?.cancel();
	controller.store.setStreaming(false);
}

/**
 * `runGuiAgentLoop.ts`: a denied call gets DENIED_TOOL_OUTPUT and the model
 * continues. Dismissing ask_user cancels it and ends the turn.
 */
export function denyTool(controller: KnoxGuiController, id: string): void {
	const call = controller.findTool(id);
	if (!call || knoxGuiToolIsSettled(call)) {
		return;
	}
	if (isSharedTurnActive(controller)) {
		// The loop tells the model the call was not approved and carries on by itself.
		controller.patchTool(id, { status: 'done', outputItems: [KNOX_DENIED_TOOL_OUTPUT], output: KNOX_DENIED_TOOL_OUTPUT.content });
		controller.messenger.post('brain/recordSoulEvent', { sessionId: controller.store.state.sessionId, kind: 'tool_denied', toolName: call.name, files: [], ok: false, policy: 'deny', summary: `User denied ${call.name}` });
		resolveAutonomousTool(controller, id, false);
		return;
	}
	if (isAutonomousRunning(controller)) {
		resolveAutonomousTool(controller, id, false);
		return;
	}
	if (isAskUserToolName(call.name)) {
		controller.patchTool(id, { status: 'canceled' });
		controller.store.setStreaming(false);
		return;
	}
	controller.patchTool(id, { status: 'done', outputItems: [KNOX_DENIED_TOOL_OUTPUT], output: KNOX_DENIED_TOOL_OUTPUT.content });
	controller.messenger.post('brain/recordSoulEvent', { sessionId: controller.store.state.sessionId, kind: 'tool_denied', toolName: call.name, files: [], ok: false, policy: 'deny', summary: `User denied ${call.name}` });
	void controller.maybeContinueTurn();
}

/** `answerAskUser.ts`: answers become the tool output locally; no `tools/call`. */
export function answerAskUser(controller: KnoxGuiController, id: string, answers: Record<string, string>): void {
	const call = controller.findTool(id);
	if (!call || call.status !== 'generated') {
		return;
	}
	const args = call.parsedArgs ?? parseToolArgs(call.arguments);
	const questions = resolveAskUserQuestions(call);
	const output = knoxGuiAskUserOutput(questions, answers);
	const sessionId = controller.store.state.sessionId;
	controller.messenger.post('brain/recordSoulEvent', { sessionId, kind: 'tool_success', toolName: call.name, files: [], ok: true, summary: output.content });
	controller.messenger.post('brain/store', {
		category: 'decision',
		title: `User decision: ${questions[0]?.prompt?.slice(0, 80) || 'ask_user'}`,
		content: output.content,
		keywords: 'ask-user,decision',
		importance: 0.7,
		session_id: sessionId,
	});
	const parsed = { ...args, answers };
	controller.patchTool(id, {
		answers,
		parsedArgs: parsed,
		status: 'done',
		outputItems: [output],
		output: output.content,
	});
	void controller.maybeContinueTurn();
}

/** `loop.ts`: a call to a disabled tool is answered as not available. */
function settleDisabledTool(controller: KnoxGuiController, call: IKnoxGuiToolCall): void {
	const item = knoxGuiMissingToolOutput(call.name);
	controller.patchTool(call.id, { status: 'done', outputItems: [item], output: item.content });
}

/**
 * `runGuiAgentLoop.ts` approveTool: hard policy deny first, then
 * `isToolAutoApproved`. Both run host-side; without the host handler the
 * local rules apply and no path/command policy is enforced.
 */
export async function evaluateToolDecision(controller: KnoxGuiController, call: IKnoxGuiToolCall): Promise<{ decision: KnoxGuiToolDecision; reason?: string }> {
	const state = controller.store.state;
	if (state.toolGroupExcluded.some(group => state.tools.find(tool => tool.name === call.name && tool.group === group))) {
		return { decision: 'ask' };
	}
	const args = call.parsedArgs ?? parseToolArgs(call.arguments);
	try {
		const result = await controller.messenger.request<{ hardDeny?: boolean; autoApproved?: boolean; reason?: string }>('knox/evaluateToolPolicy', {
			toolName: call.name,
			args,
			permissionMode: state.permissionMode,
			toolSettings: state.toolSettings,
			sessionAllowlist: state.sessionToolAllowlist,
		});
		if (result && typeof result.autoApproved === 'boolean') {
			if (result.hardDeny) {
				return { decision: 'deny', reason: result.reason };
			}
			return { decision: result.autoApproved && !isAskUserToolName(call.name) ? 'allow' : 'ask' };
		}
	} catch {
		// host without the handler
	}
	const allow = knoxGuiLocalAutoApprove({
		name: call.name,
		args,
		toolSettings: state.toolSettings,
		permissionMode: state.permissionMode,
		sessionAllowlist: state.sessionToolAllowlist,
	});
	return { decision: allow ? 'allow' : 'ask' };
}

function settlePolicyDenied(controller: KnoxGuiController, call: IKnoxGuiToolCall, reason: string | undefined): void {
	controller.patchTool(call.id, { status: 'done', outputItems: [KNOX_DENIED_TOOL_OUTPUT], output: KNOX_DENIED_TOOL_OUTPUT.content });
	controller.messenger.post('brain/recordSoulEvent', { sessionId: controller.store.state.sessionId, kind: 'tool_denied', toolName: call.name, files: [], ok: false, policy: 'deny', summary: reason || `Policy denied ${call.name}` });
}

/** Settles or runs one generated call; returns true when it was settled without running. */
async function resolveTool(controller: KnoxGuiController, call: IKnoxGuiToolCall): Promise<boolean> {
	if ((controller.store.state.toolSettings[call.name] ?? 'allowedWithoutPermission') === 'disabled') {
		settleDisabledTool(controller, call);
		return true;
	}
	if (isAskUserToolName(call.name)) {
		const questions = resolveAskUserQuestions(call);
		if (!questions.length) {
			const item = knoxGuiAskUserInvalidOutput();
			controller.patchTool(call.id, { status: 'done', outputItems: [item], output: item.content });
			return true;
		}
		if (!call.questions?.length) {
			controller.patchTool(call.id, { questions });
		}
	}
	const { decision, reason } = await controller.evaluateToolDecision(call);
	if (controller.findTool(call.id)?.status !== 'generated') {
		return false;
	}
	if (isAutonomousRunning(controller) || isSharedTurnActive(controller)) {
		if (decision !== 'ask') {
			resolveAutonomousTool(controller, call.id, decision === 'allow');
		}
		return false;
	}
	if (decision === 'deny') {
		settlePolicyDenied(controller, call, reason);
		return true;
	}
	if (decision === 'allow') {
		await controller.approveTool(call.id);
	}
	return false;
}

export async function resolveTools(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[]): Promise<void> {
	for (const call of toolCalls) {
		await resolveTool(controller, call);
	}
}

export async function syncPendingTools(controller: KnoxGuiController): Promise<void> {
	const pending = controller.store.state.history.flatMap(item => item.toolCalls ?? []).filter(call => call.status === 'generated');
	for (const call of pending) {
		if (await resolveTool(controller, call)) {
			await controller.maybeContinueTurn();
		}
	}
}

export function mergeToolCalls(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[], raw: unknown[]): void {
	mergeStreamedToolCalls(toolCalls, raw, {
		tools: controller.store.state.tools,
		nextId: generateUuid,
	});
}

export function finalizeGeneratingTools(controller: KnoxGuiController, toolCalls: IKnoxGuiToolCall[]): void {
	for (const call of toolCalls) {
		if (call.status === 'generating') {
			call.status = 'generated';
		}
		if (isAskUserToolName(call.name)) {
			const questions = resolveAskUserQuestions(call);
			if (questions.length) {
				call.questions = questions;
			}
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
				!knoxGuiToolIsSettled(call)
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

/** `ModeSelect.tsx` Shift+Tab: cycle, record a soul event, then re-evaluate pending calls. */
export function cyclePermissionMode(controller: KnoxGuiController): void {
	const next = nextPermissionMode(controller.store.state.permissionMode);
	controller.store.setPermissionMode(next);
	controller.messenger.post('brain/recordSoulEvent', {
		sessionId: controller.store.state.sessionId,
		kind: 'tool_success',
		files: [],
		ok: true,
		policy: next === 'default' ? 'ask' : 'allow',
		summary: `Permission mode → ${next}`,
	});
	void controller.syncPendingTools();
}
