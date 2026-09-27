import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "./builtIn";
import { resolveToolTimeoutMs } from "./middleware";
import {
  DEFAULT_AWAIT_TIMEOUT_MS,
  TOOL_TIMEOUT_SLACK_MS,
} from "./shellJobs";

describe("resolveToolTimeoutMs (HL-14)", () => {
  it("gives await_shell at least the requested wait plus slack", () => {
    const ms = resolveToolTimeoutMs(
      BuiltInToolNames.AwaitShell,
      undefined,
      { timeout_ms: 180_000 },
    );
    expect(ms).toBeGreaterThanOrEqual(180_000);
    expect(ms).toBeGreaterThanOrEqual(DEFAULT_AWAIT_TIMEOUT_MS);
  });

  it("extends past 10 min when the model asks for a longer slice", () => {
    const requested = 1_200_000;
    const ms = resolveToolTimeoutMs(
      BuiltInToolNames.AwaitShell,
      undefined,
      { timeout_ms: requested },
    );
    expect(ms).toBe(requested + TOOL_TIMEOUT_SLACK_MS);
  });

  it("keeps poll (timeout_ms=0) on the base override", () => {
    const ms = resolveToolTimeoutMs(
      BuiltInToolNames.AwaitShell,
      undefined,
      { timeout_ms: 0 },
    );
    expect(ms).toBe(DEFAULT_AWAIT_TIMEOUT_MS);
  });

  it("extends pty_read to the requested wait", () => {
    const ms = resolveToolTimeoutMs(
      BuiltInToolNames.PtyRead,
      undefined,
      { timeout_ms: 60_000 },
    );
    expect(ms).toBeGreaterThanOrEqual(60_000);
  });
});
