/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem } from './knoxChatTypes.js';

export interface IKnoxToolApprovalDecision {
	allow: boolean;
	always?: boolean;
}

type ApprovalWaiter = { resolve: (decision: IKnoxToolApprovalDecision) => void };
type AskWaiter = { resolve: (output: IKnoxContextItem[] | null) => void };

const approvalWaiters = new Map<string, ApprovalWaiter>();
const askWaiters = new Map<string, AskWaiter>();
let loopDepth = 0;

export function enterKnoxAgentLoop(): void {
	loopDepth += 1;
}

export function leaveKnoxAgentLoop(): void {
	loopDepth = Math.max(0, loopDepth - 1);
}

export function isKnoxAgentLoopRunning(): boolean {
	return loopDepth > 0;
}

export function hasKnoxToolApproval(callId: string): boolean {
	return approvalWaiters.has(callId);
}

export function hasKnoxAskUserWaiter(callId: string): boolean {
	return askWaiters.has(callId);
}

export function waitForKnoxToolApproval(options: {
	callId: string;
	abortSignal?: AbortSignal;
}): Promise<IKnoxToolApprovalDecision> {
	const callId = options.callId;
	return new Promise(resolve => {
		let settled = false;
		const finish = (decision: IKnoxToolApprovalDecision) => {
			if (settled) {
				return;
			}
			settled = true;
			approvalWaiters.delete(callId);
			options.abortSignal?.removeEventListener('abort', onAbort);
			resolve(decision);
		};
		const onAbort = () => finish({ allow: false });
		approvalWaiters.set(callId, { resolve: finish });
		if (options.abortSignal?.aborted) {
			onAbort();
			return;
		}
		options.abortSignal?.addEventListener('abort', onAbort, { once: true });
	});
}

export function resolveKnoxToolApproval(callId: string, allow: boolean, always?: boolean): boolean {
	const waiter = approvalWaiters.get(callId);
	if (!waiter) {
		return false;
	}
	waiter.resolve({ allow, always });
	return true;
}

export function waitForKnoxAskUser(options: {
	callId: string;
	abortSignal?: AbortSignal;
}): Promise<IKnoxContextItem[] | null> {
	const callId = options.callId;
	return new Promise(resolve => {
		let settled = false;
		const finish = (output: IKnoxContextItem[] | null) => {
			if (settled) {
				return;
			}
			settled = true;
			askWaiters.delete(callId);
			options.abortSignal?.removeEventListener('abort', onAbort);
			resolve(output);
		};
		const onAbort = () => finish(null);
		askWaiters.set(callId, { resolve: finish });
		if (options.abortSignal?.aborted) {
			onAbort();
			return;
		}
		options.abortSignal?.addEventListener('abort', onAbort, { once: true });
	});
}

export function resolveKnoxAskUser(callId: string, output: IKnoxContextItem[] | null): boolean {
	const waiter = askWaiters.get(callId);
	if (!waiter) {
		return false;
	}
	waiter.resolve(output);
	return true;
}

export function rejectKnoxLoopWaiters(): void {
	for (const waiter of [...approvalWaiters.values()]) {
		waiter.resolve({ allow: false });
	}
	for (const waiter of [...askWaiters.values()]) {
		waiter.resolve(null);
	}
}
