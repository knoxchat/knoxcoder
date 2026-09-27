/**
 * In-flight `/autonomous` permission waits. Core resolves them when the GUI
 * sends `brain/resolveAutonomousTool`; cancel aborts the wait as deny.
 */

export interface AutonomousApprovalDecision {
  allow: boolean;
  always?: boolean;
}

interface PendingApproval {
  resolve: (decision: AutonomousApprovalDecision) => void;
}

const pending = new Map<string, PendingApproval>();

function approvalKey(sessionId: string, callId: string): string {
  return `${sessionId}::${callId}`;
}

export function waitForAutonomousToolApproval(options: {
  sessionId: string;
  callId: string;
  abortSignal?: AbortSignal;
}): Promise<AutonomousApprovalDecision> {
  const key = approvalKey(options.sessionId, options.callId);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (decision: AutonomousApprovalDecision) => {
      if (settled) {
        return;
      }
      settled = true;
      pending.delete(key);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish({ allow: false });
    pending.set(key, { resolve: finish });
    if (options.abortSignal?.aborted) {
      onAbort();
      return;
    }
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveAutonomousToolApproval(options: {
  sessionId: string;
  callId: string;
  allow: boolean;
  always?: boolean;
}): boolean {
  const waiter = pending.get(approvalKey(options.sessionId, options.callId));
  if (!waiter) {
    return false;
  }
  waiter.resolve({
    allow: options.allow,
    always: options.always,
  });
  return true;
}

export function rejectAutonomousApprovals(sessionId: string): void {
  const prefix = `${sessionId}::`;
  for (const [key, waiter] of [...pending.entries()]) {
    if (key.startsWith(prefix)) {
      waiter.resolve({ allow: false });
    }
  }
}
