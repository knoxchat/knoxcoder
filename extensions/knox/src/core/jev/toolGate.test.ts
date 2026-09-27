import { describe, expect, it, vi } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { resolveJevRuntime } from "./config";
import {
  gateToolCall,
  isJevToolDenialText,
  omitJevToolDenialLines,
  shouldGateTool,
} from "./toolGate";
import type { JevClient } from "./types";

function runtime() {
  return {
    ...resolveJevRuntime({ enabled: true }),
    apiKey: "test-key",
  };
}

function fakeClient(): JevClient & { systemOne: ReturnType<typeof vi.fn> } {
  return {
    systemOne: vi.fn(async () => {
      throw new Error("Jev must not score tool calls");
    }),
  };
}

describe("gateToolCall", () => {
  it("does not gate any tool, including file creation", async () => {
    expect(shouldGateTool(BuiltInToolNames.ReadFile)).toBe(false);
    expect(shouldGateTool(BuiltInToolNames.CreateNewFile)).toBe(false);
    expect(shouldGateTool(BuiltInToolNames.WriteFile)).toBe(false);
    expect(shouldGateTool(BuiltInToolNames.RunTerminalCommand)).toBe(false);

    const client = fakeClient();
    const gate = await gateToolCall({
      toolName: BuiltInToolNames.CreateNewFile,
      args: { filepath: "script.js", contents: "ok" },
      userMessage: "build a signup form",
      permissionMode: "acceptEdits",
      runtime: runtime(),
      client,
    });
    expect(gate.action).toBe("allow");
    expect(gate.source).toBe("heuristic");
    expect(client.systemOne).not.toHaveBeenCalled();
  });

  it("allows a call that used to be denied as irrelevant or destructive", async () => {
    const client = fakeClient();
    const gate = await gateToolCall({
      toolName: BuiltInToolNames.RunTerminalCommand,
      args: { command: "rm -rf /" },
      userMessage: "clean the build",
      permissionMode: "acceptEdits",
      runtime: runtime(),
      client,
    });
    expect(gate.action).toBe("allow");
    expect(client.systemOne).not.toHaveBeenCalled();
  });
});

describe("omitJevToolDenialLines", () => {
  it("drops recalled lines that ban a tool because Jev denied it", () => {
    const text = [
      "User asked for a signup form.",
      "builtin_create_new_file: File-creation tool that was blocked with 'tool path does not match the request'.",
      "Keep the form validation.",
    ].join("\n");
    expect(isJevToolDenialText(text.split("\n")[1])).toBe(true);
    expect(omitJevToolDenialLines(text)).toBe(
      "User asked for a signup form.\nKeep the form validation.",
    );
  });
});
