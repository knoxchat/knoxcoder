import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { TEST_TAMPER_MARKER } from "../tools/rustEditGuard";
import { summarizeRustEval } from "./rustEvalMetrics";

describe("summarizeRustEval (RL-56)", () => {
  it("counts edits until the first green cargo check", () => {
    const metrics = summarizeRustEval({
      toolTrace: [
        {
          name: BuiltInToolNames.EditFile,
          args: { new_string: "a + b" },
          output: "edited",
        },
        {
          name: BuiltInToolNames.Build,
          args: { command: "cargo check --workspace" },
          output: "Exit: 1\nerror[E0425]",
        },
        {
          name: BuiltInToolNames.EditFile,
          args: { new_string: "42" },
          output: "Command: cargo check\nExit: 0\n",
        },
        {
          name: BuiltInToolNames.EditFile,
          args: { new_string: "cleanup" },
          output: "later edit",
        },
      ],
    });
    expect(metrics.editsToGreen).toBe(2);
  });

  it("scans edit payloads for clone/unwrap and counts tamper / clippy", () => {
    const metrics = summarizeRustEval({
      toolTrace: [
        {
          name: BuiltInToolNames.EditFile,
          args: {
            old_string: "acc.as_str()",
            new_string: "acc.clone().unwrap()",
          },
          output: TEST_TAMPER_MARKER,
        },
        {
          name: BuiltInToolNames.Build,
          args: { command: "cargo clippy" },
          output: "error: used unwrap()\n  = note: `#[deny(clippy::unwrap_used)]`",
        },
      ],
    });
    expect(metrics.cloneDelta).toBe(1);
    expect(metrics.unwrapDelta).toBe(1);
    expect(metrics.testTamper).toBe(1);
    expect(metrics.clippyWarnings).toBeGreaterThan(0);
    expect(metrics.editsToGreen).toBeNull();
  });
});
