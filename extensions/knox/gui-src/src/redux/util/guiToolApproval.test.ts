import { describe, expect, it } from "vitest";

import {
  enterGuiAgentLoop,
  hasGuiAskUserWaiter,
  hasGuiToolApproval,
  isGuiAgentLoopRunning,
  leaveGuiAgentLoop,
  rejectGuiLoopWaiters,
  resolveGuiAskUser,
  resolveGuiToolApproval,
  waitForGuiAskUser,
  waitForGuiToolApproval,
} from "./guiToolApproval";

describe("guiToolApproval", () => {
  it("tracks nested loop depth", () => {
    expect(isGuiAgentLoopRunning()).toBe(false);
    enterGuiAgentLoop();
    enterGuiAgentLoop();
    expect(isGuiAgentLoopRunning()).toBe(true);
    leaveGuiAgentLoop();
    expect(isGuiAgentLoopRunning()).toBe(true);
    leaveGuiAgentLoop();
    expect(isGuiAgentLoopRunning()).toBe(false);
  });

  it("resolves an in-flight approval", async () => {
    const pending = waitForGuiToolApproval({ callId: "c1" });
    expect(hasGuiToolApproval("c1")).toBe(true);
    expect(resolveGuiToolApproval("c1", true, true)).toBe(true);
    await expect(pending).resolves.toEqual({ allow: true, always: true });
    expect(hasGuiToolApproval("c1")).toBe(false);
  });

  it("resolves ask_user with output or cancel", async () => {
    const pending = waitForGuiAskUser({ callId: "a1" });
    expect(hasGuiAskUserWaiter("a1")).toBe(true);
    const output = [{ name: "answers", description: "ok", content: "yes" }];
    expect(resolveGuiAskUser("a1", output)).toBe(true);
    await expect(pending).resolves.toEqual(output);
  });

  it("rejects waiters on stop", async () => {
    const approval = waitForGuiToolApproval({ callId: "c2" });
    const ask = waitForGuiAskUser({ callId: "a2" });
    rejectGuiLoopWaiters();
    await expect(approval).resolves.toEqual({ allow: false });
    await expect(ask).resolves.toBeNull();
  });
});
