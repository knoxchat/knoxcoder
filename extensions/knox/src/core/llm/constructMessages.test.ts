import { describe, expect, it, afterEach } from "vitest";

import { constructMessages } from "./constructMessages";
import { createPlan, formatPlanInject, formatPlanText, resetPlansForTests } from "../tools/planStore";
import {
  resetCodebaseCardForTests,
  setCodebaseCardInject,
} from "../context/codebaseCard";
import {
  resetRustPolicyForTests,
  setRustPolicyEnabled,
  RUST_POLICY_MARKER,
} from "../context/rustPolicy";
import {
  resetSerialContextForTests,
  setSerialContextInject,
} from "../context/serialContext";

/** Size of the pre-K-031 monolithic prompt, for the shrink target. */
const OLD_PROMPT_CHARS = 4900;

describe("constructMessages", () => {
  afterEach(() => {
    resetPlansForTests();
    resetCodebaseCardForTests();
    resetRustPolicyForTests();
    resetSerialContextForTests();
  });

  it("keeps a byte-identical stable prefix when plan and serial tail change (K-030)", () => {
    setCodebaseCardInject("CARD: stable repo summary");
    setRustPolicyEnabled(true);
    const sysText = (sid: string) =>
      constructMessages([], sid)
        .filter((m) => m.role === "system")
        .map((m) => String(m.content));

    const before = sysText("s-none");
    createPlan({ sessionId: "s-a", title: "Plan A", steps: ["one"] });
    setSerialContextInject("serial tail 1");
    const turn1 = sysText("s-a");
    createPlan({ sessionId: "s-a", title: "Plan B", steps: ["two", "three"] });
    setSerialContextInject("serial tail 2 (longer)");
    const turn2 = sysText("s-a");

    // Stable blocks: prompt, card, rust policy.
    const stableCount = before.length;
    expect(stableCount).toBeGreaterThanOrEqual(3);
    expect(turn1.slice(0, stableCount).join("\u0000")).toBe(
      turn2.slice(0, stableCount).join("\u0000"),
    );
    // Volatile blocks come strictly after the stable prefix.
    expect(turn1.length).toBeGreaterThan(stableCount);
    expect(turn1[stableCount]).toContain("Plan A");
    expect(turn2[stableCount]).toContain("Plan B");
  });

  it("injects edit-tool discipline in the default system message", () => {
    const msgs = constructMessages([]);
    expect(msgs[0]?.role).toBe("system");
    const content = String(msgs[0]?.content);
    expect(content).toContain("builtin_read_file");
    expect(content).toContain("builtin_exact_search");
    expect(content).toContain("builtin_edit_file");
    expect(content).toContain("builtin_write_file");
    expect(content).toContain("builtin_apply_patch");
    expect(content).toMatch(/never the terminal|Do not write or patch files/i);
    expect(content).toContain("builtin_create_new_file");
    expect(content).toContain("builtin_await_shell");
    expect(content).toMatch(/cargo check/);
    expect(content).toContain("builtin_pty_start");
    expect(content).toContain("builtin_task");
    expect(content).toContain("builtin_ask_user");
    expect(content).toContain("startLine");
    expect(content).toContain("builtin_git_status");
    expect(content).toContain("builtin_git_blame");
    expect(content).toContain("builtin_git_bisect");
    expect(content).toContain("builtin_qemu");
    expect(content).toContain("builtin_workspace_checkpoint");
    expect(content).toContain("builtin_plan");
    expect(content).toContain("builtin_kconfig");
    expect(content).toContain("builtin_maintainers");
    expect(content).toContain("builtin_debug");
    expect(content).toMatch(/native tool|Never print DSML/i);
  });

  it("omits systems tooling on the default profile and is >=40% smaller (K-031)", () => {
    const full = String(constructMessages([])[0]?.content);
    const lean = String(constructMessages([], null, { systems: false })[0]?.content);
    expect(lean).not.toContain("builtin_pty_start");
    expect(lean).not.toContain("builtin_qemu");
    expect(lean).toContain("builtin_edit_file");
    expect(lean).toContain("Verification");
    expect(lean.length).toBeLessThanOrEqual(OLD_PROMPT_CHARS * 0.6);
    expect(full.length).toBeLessThan(OLD_PROMPT_CHARS);
  });

  it("strips leaked DSML tool markup from assistant history", () => {
    const msgs = constructMessages([
      {
        message: {
          role: "assistant",
          content: `Let me run it:
< | DSML | tool_calls>
< | DSML | invoke name="builtin_run_terminal_command">
< | DSML | parameter name="command" string="true">cargo build</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | tool_calls>`,
        },
        contextItems: [],
      },
    ]);
    const assistant = msgs.find((msg) => msg.role === "assistant");
    expect(String(assistant?.content)).toContain("Let me run it:");
    expect(String(assistant?.content)).not.toMatch(/DSML/);
  });

  it("strips exploded `| | DSML | |` markup from assistant history", () => {
    const msgs = constructMessages([
      {
        message: {
          role: "assistant",
          content: `Let me look:
< | | DSML | |  calls>
< | | DSML | |  invoke name="builtin_glob">
< | | DSML | |  parameter name="pattern" string="true">**/Cargo.toml</ / | DSML | | parameter>
</ / | DSML | | invoke>
</ / | DSML | | calls>`,
        },
        contextItems: [],
      },
    ]);
    const assistant = msgs.find((msg) => msg.role === "assistant");
    expect(String(assistant?.content)).toContain("Let me look:");
    expect(String(assistant?.content)).not.toMatch(/DSML/);
    expect(assistant?.toolCalls?.[0]?.function?.name).toBe("builtin_glob");
  });

  it("strips fullwidth ｜DSML｜ markup from assistant history", () => {
    const msgs = constructMessages([
      {
        message: {
          role: "assistant",
          content: `Let me check the manifest:
<\uFF5CDSML\uFF5Ctool_calls>
<\uFF5CDSML\uFF5Cinvoke name="builtin_read_file">
<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Ctool_calls>`,
        },
        contextItems: [],
      },
    ]);
    const assistant = msgs.find((msg) => msg.role === "assistant");
    expect(String(assistant?.content)).toContain("Let me check the manifest:");
    expect(String(assistant?.content)).not.toMatch(/DSML/);
    expect(String(assistant?.content)).not.toContain("\uFF5C");
  });

  it("uses the canceled notice only when every tool on the turn was canceled", () => {
    const canceled = {
      toolCallId: "a",
      status: "canceled" as const,
      parsedArgs: {},
      toolCall: {
        id: "a",
        type: "function" as const,
        function: { name: "builtin_read_file", arguments: "{}" },
      },
    };
    const done = {
      ...canceled,
      toolCallId: "b",
      status: "done" as const,
      toolCall: { ...canceled.toolCall, id: "b" },
    };

    const mixed = constructMessages([
      {
        message: { role: "assistant", content: "working", toolCalls: [] },
        contextItems: [],
        toolCallState: canceled,
        toolCallStates: [canceled, done],
      },
    ]);
    expect(mixed.at(-1)?.content).toBe("working");

    const allCanceled = constructMessages([
      {
        message: { role: "assistant", content: "working", toolCalls: [] },
        contextItems: [],
        toolCallState: canceled,
        toolCallStates: [canceled],
      },
    ]);
    expect(String(allCanceled.at(-1)?.content)).toMatch(/cancelled by the user/i);
  });

  it("injects the session Task Execution Plan as protected system content", () => {
    createPlan({
      sessionId: "sess-plan",
      title: "Boot panic in mm",
      steps: ["Read MAINTAINERS", "Reproduce in QEMU"],
    });
    const msgs = constructMessages([], "sess-plan");
    const joined = msgs
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(joined).toContain("Task Execution Plan");
    expect(joined).toContain("Boot panic in mm");
    expect(joined).toContain("Read MAINTAINERS");
    expect(joined).toContain("Reproduce in QEMU");
  });

  it("recovers the Task Execution Plan from history when the store is empty", () => {
    const created = createPlan({
      sessionId: "sess-history",
      title: "Snake game",
      steps: ["Create Cargo.toml", "Write main.rs"],
    });
    resetPlansForTests();
    expect(formatPlanInject("sess-history")).toBe("");
    const msgs = constructMessages(
      [
        {
          message: {
            role: "tool",
            content: formatPlanText(created),
            toolCallId: "p1",
          },
          contextItems: [
            {
              name: "Plan",
              description: "created",
              content: formatPlanText(created),
              id: { providerTitle: "toolCall", itemId: "p1" },
            },
          ],
        },
      ],
      "sess-history",
    );
    const joined = msgs
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(joined).toContain("Task Execution Plan");
    expect(joined).toContain("Snake game");
    expect(joined).toContain("Create Cargo.toml");
  });

  it("injects rust engineering policy only when the rust profile is enabled", () => {
    setRustPolicyEnabled(true);
    const rustJoined = constructMessages([])
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(rustJoined).toContain(RUST_POLICY_MARKER);
    expect(rustJoined).toMatch(/forbid\(unsafe_code\)/);
    expect(rustJoined).toContain("edition 2024");
    expect(rustJoined).toContain("rust-version 1.98.1");

    resetRustPolicyForTests();
    const defaultJoined = constructMessages([])
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(defaultJoined).not.toContain(RUST_POLICY_MARKER);
  });

  it("injects a kernel codebase card as protected system content", () => {
    setCodebaseCardInject(
      "## Codebase Card\nBuild: `make ARCH=x86_64`\nTop-level dirs: mm/ arch/",
    );
    const msgs = constructMessages([]);
    const joined = msgs
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(joined).toContain("Codebase Card");
    expect(joined).toContain("make ARCH=x86_64");
    expect(joined).toContain("mm/");
  });

  it("injects serial / dmesg job tails (HL-45)", () => {
    setSerialContextInject("## Serial / dmesg\nKernel panic - not syncing");
    const msgs = constructMessages([]);
    const joined = msgs
      .filter((m) => m.role === "system")
      .map((m) => String(m.content))
      .join("\n");
    expect(joined).toContain("Serial / dmesg");
    expect(joined).toContain("Kernel panic");
  });
});
