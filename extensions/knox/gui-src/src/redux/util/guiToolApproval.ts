/**
 * In-flight GUI AgentLoop permission / ask_user waits.
 *
 * Product chat runs `runAgentLoop` in the webview. Ask/Accept and ask_user
 * pause the loop here instead of returning from the thunk. Stop/abort denies.
 */

import type { ContextItem } from "core";

export interface GuiApprovalDecision {
  allow: boolean;
  always?: boolean;
}

type ApprovalWaiter = {
  resolve: (decision: GuiApprovalDecision) => void;
};

type AskWaiter = {
  resolve: (output: ContextItem[] | null) => void;
};

const approvalWaiters = new Map<string, ApprovalWaiter>();
const askWaiters = new Map<string, AskWaiter>();
let loopDepth = 0;

export function enterGuiAgentLoop(): void {
  loopDepth += 1;
}

export function leaveGuiAgentLoop(): void {
  loopDepth = Math.max(0, loopDepth - 1);
}

export function isGuiAgentLoopRunning(): boolean {
  return loopDepth > 0;
}

export function hasGuiToolApproval(callId: string): boolean {
  return approvalWaiters.has(callId);
}

export function hasGuiAskUserWaiter(callId: string): boolean {
  return askWaiters.has(callId);
}

export function waitForGuiToolApproval(options: {
  callId: string;
  abortSignal?: AbortSignal;
}): Promise<GuiApprovalDecision> {
  const callId = options.callId;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (decision: GuiApprovalDecision) => {
      if (settled) {
        return;
      }
      settled = true;
      approvalWaiters.delete(callId);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish({ allow: false });
    approvalWaiters.set(callId, { resolve: finish });
    if (options.abortSignal?.aborted) {
      onAbort();
      return;
    }
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveGuiToolApproval(
  callId: string,
  allow: boolean,
  always?: boolean,
): boolean {
  const waiter = approvalWaiters.get(callId);
  if (!waiter) {
    return false;
  }
  waiter.resolve({ allow, always });
  return true;
}

export function waitForGuiAskUser(options: {
  callId: string;
  abortSignal?: AbortSignal;
}): Promise<ContextItem[] | null> {
  const callId = options.callId;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: ContextItem[] | null) => {
      if (settled) {
        return;
      }
      settled = true;
      askWaiters.delete(callId);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve(output);
    };
    const onAbort = () => finish(null);
    askWaiters.set(callId, { resolve: finish });
    if (options.abortSignal?.aborted) {
      onAbort();
      return;
    }
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveGuiAskUser(
  callId: string,
  output: ContextItem[] | null,
): boolean {
  const waiter = askWaiters.get(callId);
  if (!waiter) {
    return false;
  }
  waiter.resolve(output);
  return true;
}

export function rejectGuiLoopWaiters(): void {
  for (const waiter of [...approvalWaiters.values()]) {
    waiter.resolve({ allow: false });
  }
  for (const waiter of [...askWaiters.values()]) {
    waiter.resolve(null);
  }
}
