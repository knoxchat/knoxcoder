import { describe, expect, it } from "vitest";

import {
  rejectAutonomousApprovals,
  resolveAutonomousToolApproval,
  waitForAutonomousToolApproval,
} from "./autonomousApproval";

describe("autonomousApproval", () => {
  it("resolves an in-flight wait", async () => {
    const pending = waitForAutonomousToolApproval({
      sessionId: "s1",
      callId: "c1",
    });
    expect(
      resolveAutonomousToolApproval({
        sessionId: "s1",
        callId: "c1",
        allow: true,
        always: true,
      }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({ allow: true, always: true });
  });

  it("rejects waiters for a cancelled session", async () => {
    const pending = waitForAutonomousToolApproval({
      sessionId: "s2",
      callId: "c2",
    });
    rejectAutonomousApprovals("s2");
    await expect(pending).resolves.toEqual({ allow: false });
  });
});
