import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "./builtIn";
import { ToolCallError, ToolCallErrorCode } from "./errors";
import {
  assertToolPolicyAllowed,
  classifyPolicyPattern,
  evaluateToolPolicy,
  extractToolPolicyTargets,
  isPathOutsideWorkspace,
  matchCommandPattern,
  parsePolicyBlocks,
  parsePolicyLines,
  pathMatchesPolicy,
  patternsToPolicy,
  policyBlocksAutoApprove,
} from "./toolPolicy";

describe("parsePolicyLines", () => {
  it("parses allow/ask/deny lines and ignores comments", () => {
    expect(
      parsePolicyLines(`
# secrets
deny ~/.ssh/**
allow src/**
ask packages/**
not a rule
`),
    ).toEqual([
      { action: "deny", pattern: "~/.ssh/**" },
      { action: "allow", pattern: "src/**" },
      { action: "ask", pattern: "packages/**" },
    ]);
  });
});

describe("classifyPolicyPattern", () => {
  it("classifies paths vs commands", () => {
    expect(classifyPolicyPattern("src/**")).toEqual({
      kind: "path",
      pattern: "src/**",
    });
    expect(classifyPolicyPattern("~/.ssh/**")).toEqual({
      kind: "path",
      pattern: "~/.ssh/**",
    });
    expect(classifyPolicyPattern("git *")).toEqual({
      kind: "command",
      pattern: "git *",
    });
    expect(classifyPolicyPattern("npm test*")).toEqual({
      kind: "command",
      pattern: "npm test*",
    });
    expect(classifyPolicyPattern("cmd:rm -rf *")).toEqual({
      kind: "command",
      pattern: "rm -rf *",
    });
    expect(classifyPolicyPattern("path:**/.env")).toEqual({
      kind: "path",
      pattern: "**/.env",
    });
  });
});

describe("parsePolicyBlocks", () => {
  it("reads markdown always/ask/never items", () => {
    const parsed = parsePolicyBlocks(`
# Agent
- always: src/**
- ask: git *
- never: ~/.ssh/**
- never: rm -rf *
`);
    expect(parsed.always).toEqual(["src/**"]);
    expect(parsed.ask).toEqual(["git *"]);
    expect(parsed.never).toEqual(["~/.ssh/**", "rm -rf *"]);
  });
});

describe("patternsToPolicy", () => {
  it("splits never/ask/always into path and command rules", () => {
    const policy = patternsToPolicy({
      always: ["src/**", "npm test*"],
      ask: ["git *"],
      never: ["~/.ssh/**", "rm -rf *"],
    });
    expect(policy.paths).toEqual([
      { pattern: "~/.ssh/**", action: "deny" },
      { pattern: "src/**", action: "allow" },
    ]);
    expect(policy.commands).toEqual([
      { pattern: "rm -rf *", action: "deny" },
      { pattern: "git *", action: "ask" },
      { pattern: "npm test*", action: "allow" },
    ]);
  });
});

describe("matchCommandPattern", () => {
  it("matches git and npm globs", () => {
    expect(matchCommandPattern("git status", "git *")).toBe(true);
    expect(matchCommandPattern("npm test --watch", "npm test*")).toBe(true);
    expect(matchCommandPattern("npm install", "npm test*")).toBe(false);
  });
});

describe("path + external directory", () => {
  const ws = [path.join(os.tmpdir(), "knox-ws")];

  it("matches workspace-relative globs", () => {
    expect(pathMatchesPolicy("src/a.ts", "src/**", ws)).toBe(true);
    expect(pathMatchesPolicy("README.md", "src/**", ws)).toBe(false);
  });

  it("detects paths outside the workspace", () => {
    expect(isPathOutsideWorkspace("src/a.ts", ws)).toBe(false);
    expect(isPathOutsideWorkspace("/etc/passwd", ws)).toBe(true);
    expect(isPathOutsideWorkspace("~/.ssh/id_rsa", ws)).toBe(true);
  });
});

describe("extractToolPolicyTargets", () => {
  it("reads file and terminal args", () => {
    expect(
      extractToolPolicyTargets(BuiltInToolNames.EditFile, {
        filepath: "src/a.ts",
      }),
    ).toEqual({ paths: ["src/a.ts"] });

    expect(
      extractToolPolicyTargets(BuiltInToolNames.RunTerminalCommand, {
        command: "git status",
        working_directory: "packages/app",
      }),
    ).toEqual({
      paths: ["packages/app"],
      command: "git status",
      cwd: "packages/app",
    });
  });
});

describe("evaluateToolPolicy", () => {
  const ws = [path.join(os.tmpdir(), "knox-ws")];

  it("denies destructive commands via sandbox", () => {
    const decision = evaluateToolPolicy({
      toolName: BuiltInToolNames.RunTerminalCommand,
      args: { command: "rm -rf /" },
      workspaceDirs: ws,
    });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/Sandbox|destructive/i);
  });

  it("asks before installing/removing the git pre-commit hook", () => {
    for (const command of [
      "scripts/pre-commit.sh --install-hook",
      "bash ./scripts/pre-commit.sh --uninstall-hook",
    ]) {
      expect(
        evaluateToolPolicy({
          toolName: BuiltInToolNames.RunTerminalCommand,
          args: { command },
          workspaceDirs: ws,
        }).action,
      ).toBe("ask");
    }
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "bash scripts/pre-commit.sh --quick" },
        workspaceDirs: ws,
      }).action,
    ).not.toBe("ask");
  });

  it("denies cargo publish/login and asks for cargo clean/yank", () => {
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "cargo publish --allow-dirty" },
        workspaceDirs: ws,
      }).action,
    ).toBe("deny");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "cargo login" },
        workspaceDirs: ws,
      }).reason,
    ).toMatch(/publish|login|destructive/i);
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "cargo clean" },
        workspaceDirs: ws,
      }).action,
    ).toBe("ask");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "cargo yank -p foo --version 1.0.0" },
        workspaceDirs: ws,
      }).action,
    ).toBe("ask");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "cargo check --workspace" },
        workspaceDirs: ws,
      }).action,
    ).toBeNull();
  });

  it("denies ~/.ssh even for reads", () => {
    const decision = evaluateToolPolicy({
      toolName: BuiltInToolNames.ReadFile,
      args: { filepath: "~/.ssh/id_rsa" },
      workspaceDirs: ws,
    });
    expect(decision.action).toBe("deny");
  });

  it("asks for git * and allows npm test*", () => {
    const policy = patternsToPolicy({
      always: ["npm test*"],
      ask: ["git *"],
    });
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "git push origin main" },
        policy,
        workspaceDirs: ws,
      }).action,
    ).toBe("ask");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "npm test" },
        policy,
        workspaceDirs: ws,
      }).action,
    ).toBe("allow");
  });

  it("allows reads of cargo registry / vendor and denies registry writes (RL-29)", () => {
    const home = path.join(os.tmpdir(), "knox-home");
    const registrySrc = path.join(
      home,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-6f17d22bba15001f",
      "serde-1.0.210",
      "src",
      "lib.rs",
    );
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.ReadFile,
        args: { filepath: registrySrc },
        workspaceDirs: ws,
        home,
      }).action,
    ).toBe("allow");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.ReadFile,
        args: { filepath: "vendor/serde/src/lib.rs" },
        workspaceDirs: ws,
        home,
      }).action,
    ).toBe("allow");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.WriteFile,
        args: { filepath: registrySrc, contents: "fn steal() {}" },
        workspaceDirs: ws,
        home,
      }).action,
    ).toBe("deny");
    expect(
      evaluateToolPolicy({
        toolName: BuiltInToolNames.EditFile,
        args: {
          filepath: path.join(home, ".cargo", "registry", "src", "x.rs"),
          old_string: "a",
          new_string: "b",
        },
        workspaceDirs: ws,
        home,
      }).action,
    ).toBe("deny");
  });

  it("asks for external paths by default", () => {
    const decision = evaluateToolPolicy({
      toolName: BuiltInToolNames.WriteFile,
      args: { filepath: "/tmp/outside.ts", contents: "x" },
      workspaceDirs: ws,
    });
    expect(decision.action).toBe("ask");
    expect(decision.reason).toMatch(/outside/i);
  });

  it("denies external paths when configured", () => {
    const decision = evaluateToolPolicy({
      toolName: BuiltInToolNames.WriteFile,
      args: { filepath: "/tmp/outside.ts", contents: "x" },
      policy: { externalDirectory: "deny" },
      workspaceDirs: ws,
    });
    expect(decision.action).toBe("deny");
  });

  it("throws PERMISSION_DENIED on hard deny", () => {
    expect(() =>
      assertToolPolicyAllowed({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "rm -rf /" },
        workspaceDirs: ws,
      }),
    ).toThrow(ToolCallError);
    try {
      assertToolPolicyAllowed({
        toolName: BuiltInToolNames.RunTerminalCommand,
        args: { command: "rm -rf /" },
        workspaceDirs: ws,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ToolCallError);
      expect((error as ToolCallError).code).toBe(
        ToolCallErrorCode.PERMISSION_DENIED,
      );
    }
  });

  it("blocks auto-approve for deny and ask (except fullAuto ask)", () => {
    expect(
      policyBlocksAutoApprove({ action: "deny", reason: "x" }, "fullAuto"),
    ).toBe(true);
    expect(
      policyBlocksAutoApprove({ action: "ask", reason: "x" }, "default"),
    ).toBe(true);
    expect(
      policyBlocksAutoApprove({ action: "ask", reason: "x" }, "fullAuto"),
    ).toBe(false);
  });
});
