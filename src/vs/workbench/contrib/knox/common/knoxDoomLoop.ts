/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getHistoryToolStates } from './knoxChatHistory.js';
import { IKnoxChatHistoryItem, IKnoxToolCallState } from './knoxChatTypes.js';
import { KnoxBuiltInToolName } from './knoxToolNames.js';
import { DEFAULT_DOOM_LOOP_THRESHOLD, resolveDoomLoopThreshold } from './knoxAgentMaxSteps.js';

export { DEFAULT_DOOM_LOOP_THRESHOLD, resolveDoomLoopThreshold };

export const REBUILD_TOOL_NAMES = new Set<string>([
	KnoxBuiltInToolName.RunTerminalCommand,
	KnoxBuiltInToolName.Build,
	KnoxBuiltInToolName.AwaitShell,
	KnoxBuiltInToolName.Qemu,
	KnoxBuiltInToolName.PtyRead,
]);

const MUTATING_TOOL_NAMES = new Set<string>([
	KnoxBuiltInToolName.EditFile,
	KnoxBuiltInToolName.WriteFile,
	KnoxBuiltInToolName.ApplyPatch,
	KnoxBuiltInToolName.CreateNewFile,
]);

export function isRebuildToolName(name: string): boolean {
	return REBUILD_TOOL_NAMES.has(name);
}

export type KnoxDoomLoopKind = 'repeat' | 'fail_streak';

export interface IKnoxDoomLoopHit {
	kind: KnoxDoomLoopKind;
	threshold: number;
	count: number;
	fingerprint?: string;
	toolName?: string;
}

export interface IKnoxDoomLoopCall {
	name: string;
	args?: unknown;
	output?: string;
	items?: Array<{ name?: string; icon?: string; content?: string }>;
	ok?: boolean;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(item => stableStringify(item)).join(',')}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function canonicalizeToolArgs(args: unknown): string {
	if (args == null) {
		return '{}';
	}
	if (typeof args === 'string') {
		const trimmed = args.trim();
		if (!trimmed) {
			return '{}';
		}
		try {
			return canonicalizeToolArgs(JSON.parse(trimmed));
		} catch {
			return trimmed;
		}
	}
	if (typeof args !== 'object') {
		return String(args);
	}
	return stableStringify(args);
}

export function fingerprintToolCallNameArgs(name: string, args?: unknown): string {
	return `${name}::${canonicalizeToolArgs(args)}`;
}

export function fingerprintToolCall(state: Pick<IKnoxToolCallState, 'toolCall' | 'parsedArgs'>): string {
	return fingerprintToolCallNameArgs(
		state.toolCall.function.name,
		state.parsedArgs ?? state.toolCall.function.arguments,
	);
}

/**
 * Stable fingerprint of compiler/oops errors so a new gcc/RIP is not "the same make".
 */
export function diagnosticSignature(text: string): string {
	const errors: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const gcc = line.match(/^(.+?):(\d+)(?::(\d+))?:\s+(?:fatal error|error):\s+(.*)$/i);
		if (gcc) {
			errors.push(`${gcc[1]}:${gcc[2]}:error:${(gcc[4] ?? '').replace(/\s+/g, ' ').trim()}`);
		}
	}
	const rip = text.match(/RIP:\s+\S+:([^+/\s]+)/);
	if (rip?.[1]) {
		errors.push(`oops:RIP ${rip[1]}`);
	}
	return errors.length ? errors.join('|') : 'ok';
}

function callOutputText(call: IKnoxDoomLoopCall): string {
	if (call.output) {
		return call.output;
	}
	return (call.items ?? []).map(item => item.content ?? '').join('\n');
}

export function fingerprintRebuildCall(call: IKnoxDoomLoopCall): string {
	return `${fingerprintToolCallNameArgs(call.name, call.args)}::${diagnosticSignature(callOutputText(call))}`;
}

export function isFailedToolOutput(
	items?: Array<{ name?: string; icon?: string; content?: string }> | null,
	ok?: boolean,
): boolean {
	if (ok === false) {
		return true;
	}
	return (items ?? []).some(item => {
		if (item.name === 'Tool Call Error' || item.icon === 'problems') {
			return true;
		}
		const content = item.content ?? '';
		return content.includes('Tool call "') && content.includes(' failed');
	});
}

export function isFailedToolCall(state: IKnoxToolCallState): boolean {
	return isFailedToolOutput(state.output);
}

function isFailedDoomCall(call: IKnoxDoomLoopCall): boolean {
	if (isFailedToolOutput(call.items, call.ok)) {
		return true;
	}
	const content = callOutputText(call);
	return content.includes('Tool call "') && content.includes(' failed');
}

function toolStateToCall(state: IKnoxToolCallState): IKnoxDoomLoopCall {
	return {
		name: state.toolCall.function.name,
		args: state.parsedArgs ?? state.toolCall.function.arguments,
		output: (state.output ?? []).map(item => item.content ?? '').join('\n'),
		items: state.output,
	};
}

export function collectTurnToolCalls(history: readonly IKnoxChatHistoryItem[]): IKnoxToolCallState[] {
	let lastUser = -1;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].message.role === 'user') {
			lastUser = i;
			break;
		}
	}

	const settled: IKnoxToolCallState[] = [];
	for (let i = lastUser + 1; i < history.length; i++) {
		for (const state of getHistoryToolStates(history[i])) {
			if (state.status === 'done' || state.status === 'canceled') {
				settled.push(state);
			}
		}
	}
	return settled;
}

function detectRebuildRepeat(calls: IKnoxDoomLoopCall[], threshold: number): IKnoxDoomLoopHit | null {
	let streak = 0;
	let lastFp: string | undefined;
	let lastName: string | undefined;

	for (const call of calls) {
		if (MUTATING_TOOL_NAMES.has(call.name)) {
			streak = 0;
			lastFp = undefined;
			continue;
		}
		if (!isRebuildToolName(call.name)) {
			continue;
		}
		const fingerprint = fingerprintRebuildCall(call);
		if (fingerprint === lastFp) {
			streak += 1;
		} else {
			streak = 1;
			lastFp = fingerprint;
		}
		lastName = call.name;
		if (streak >= threshold) {
			return {
				kind: 'repeat',
				threshold,
				count: streak,
				fingerprint,
				toolName: lastName,
			};
		}
	}

	return null;
}

export function detectDoomLoopFromCalls(
	calls: IKnoxDoomLoopCall[],
	options?: { threshold?: number | null },
): IKnoxDoomLoopHit | null {
	const threshold =
		options?.threshold === undefined ? DEFAULT_DOOM_LOOP_THRESHOLD : options.threshold;
	if (threshold === null || threshold < 2) {
		return null;
	}
	if (calls.length < threshold) {
		return null;
	}

	const counts = new Map<string, { count: number; name: string }>();
	for (const call of calls) {
		if (isRebuildToolName(call.name)) {
			continue;
		}
		const fingerprint = fingerprintToolCallNameArgs(call.name, call.args);
		const current = counts.get(fingerprint);
		if (current) {
			current.count += 1;
		} else {
			counts.set(fingerprint, { count: 1, name: call.name });
		}
	}
	for (const [fingerprint, info] of counts) {
		if (info.count >= threshold) {
			return {
				kind: 'repeat',
				threshold,
				count: info.count,
				fingerprint,
				toolName: info.name,
			};
		}
	}

	const rebuildHit = detectRebuildRepeat(calls, threshold);
	if (rebuildHit) {
		return rebuildHit;
	}

	const tail = calls.slice(-threshold);
	if (tail.length >= threshold && tail.every(call => isFailedDoomCall(call))) {
		return {
			kind: 'fail_streak',
			threshold,
			count: tail.length,
			toolName: tail[tail.length - 1]?.name,
		};
	}

	return null;
}

export function detectDoomLoop(
	history: readonly IKnoxChatHistoryItem[],
	options?: {
		pending?: IKnoxToolCallState[];
		threshold?: number | null;
	},
): IKnoxDoomLoopHit | null {
	const calls = [...collectTurnToolCalls(history), ...(options?.pending ?? [])].map(toolStateToCall);
	return detectDoomLoopFromCalls(calls, { threshold: options?.threshold });
}

export function buildDoomLoopSummaryInstruction(hit: IKnoxDoomLoopHit): string {
	const what =
		hit.kind === 'repeat'
			? `repeated identical ${hit.toolName ?? 'tool'} calls (${hit.count} times)`
			: `a streak of ${hit.count} failed tool calls`;
	return [
		`[Agent doom loop] You appear stuck: ${what}.`,
		'Do not call any tools.',
		'Summarize what you already learned, what failed, and the recommended next steps for the user.',
		'If you need a different approach, ask the user instead of retrying the same call.',
	].join(' ');
}

export function buildDoomLoopBlockedMessage(hit: IKnoxDoomLoopHit): string {
	const what =
		hit.kind === 'repeat'
			? `identical ${hit.toolName ?? 'tool'} call repeated ${hit.count} times`
			: `${hit.count} consecutive tool failures`;
	return [
		`Blocked: doom-loop detection (${what}).`,
		'This call was not executed.',
		'Stop retrying the same arguments. Summarize or try a different approach.',
	].join(' ');
}
