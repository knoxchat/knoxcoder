import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./systemPrompt";

describe("buildSystemPrompt tool gating (K-031)", () => {
  it("keeps every section when no tool list is given", () => {
    const p = buildSystemPrompt({ systems: false });
    expect(p).toContain("Editing");
    expect(p).toContain("Shell:");
    expect(p).toContain("Git:");
    expect(p).toContain("Plan and delegation");
  });

  it("drops git, plan and shell sections for a read/edit-only catalog", () => {
    const p = buildSystemPrompt({
      systems: false,
      tools: ["builtin_read_file", "builtin_edit_file"],
    });
    expect(p).toContain("Editing");
    expect(p).not.toContain("Shell:");
    expect(p).not.toContain("Git:");
    expect(p).not.toContain("Plan and delegation");
  });

  it("drops editing for a read-only catalog and keeps shell when present", () => {
    const p = buildSystemPrompt({
      systems: false,
      tools: ["builtin_read_file", "builtin_run_terminal_command"],
    });
    expect(p).not.toContain("Editing (use tools");
    expect(p).toContain("Shell:");
  });

  it("only adds systems guidance when systems tools are enabled", () => {
    expect(
      buildSystemPrompt({ systems: true, tools: ["builtin_read_file"] }),
    ).not.toContain("Systems tooling");
    expect(
      buildSystemPrompt({ systems: true, tools: ["builtin_qemu"] }),
    ).toContain("Systems tooling");
  });
});

describe("multi-root workspace note", () => {
  it("is omitted for zero or one root", () => {
    expect(buildSystemPrompt({ roots: ["file:///a"] })).not.toContain("Multi-root");
    expect(buildSystemPrompt({})).not.toContain("Multi-root");
  });

  it("names the primary root first when there are several", () => {
    const prompt = buildSystemPrompt({ roots: ["file:///work/b", "file:///work/a"] });
    expect(prompt).toContain("Primary root (cwd for shell, git, builds and relative paths): /work/b");
    expect(prompt).toContain("Other roots: /work/a");
  });
});
