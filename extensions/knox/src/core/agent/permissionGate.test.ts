import { describe, expect, it } from "vitest";
import { resolveAutonomousToolApproval } from "./autonomousApproval";
import { resolveToolPermission } from "./permissionGate";

const base = (over = {}) => ({
  permission: {
    mode: "default" as const,
    toolSettings: {},
    sessionAllowlist: [] as string[],
  },
  toolName: "builtin_run_terminal_command",
  args: { command: "ls" },
  sessionId: "gate-s",
  callId: () => "c1",
  onAsk: () => undefined,
  ...over,
});

describe("resolveToolPermission", () => {
  it("auto-approves in fullAuto without asking", async () => {
    let asked = false;
    const result = await resolveToolPermission(
      base({
        permission: { mode: "fullAuto", toolSettings: {}, sessionAllowlist: [] },
        onAsk: () => void (asked = true),
      }),
    );
    expect(result).toBe("allow");
    expect(asked).toBe(false);
  });

  it("asks, then 'always' adds the tool to the session allowlist", async () => {
    const options = base();
    let askedId = "";
    const pending = resolveToolPermission({
      ...options,
      onAsk: (id) => void (askedId = id),
    });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(askedId).toBe("c1");
    resolveAutonomousToolApproval({ sessionId: "gate-s", callId: "c1", allow: true, always: true });
    expect(await pending).toBe("allow");
    expect(options.permission.sessionAllowlist).toContain(options.toolName);
  });

  it("a denied card returns deny; abort while waiting throws cancelled", async () => {
    const denied = resolveToolPermission(base({ callId: () => "c2" }));
    await new Promise((r) => setTimeout(r, 0));
    resolveAutonomousToolApproval({ sessionId: "gate-s", callId: "c2", allow: false });
    expect(await denied).toBe("deny");

    const controller = new AbortController();
    const waiting = resolveToolPermission(
      base({ callId: () => "c3", abortSignal: controller.signal }),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(waiting).rejects.toThrow(/cancel/i);
  });
});
