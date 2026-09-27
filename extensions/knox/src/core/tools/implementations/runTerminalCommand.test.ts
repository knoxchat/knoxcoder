import { afterEach, describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import { resetShellJobs } from "../shellJobs";
import { runLocalShellCommand, runTerminalCommandImpl } from "./runTerminalCommand";

function extras(overrides: Partial<ToolExtras> = {}): ToolExtras {
  return {
    ide: {
      getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
      getWorkspaceDirs: vi.fn(async () => [`file://${process.cwd()}`]),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: {
      function: { name: "builtin_run_terminal_command" },
    } as ToolExtras["tool"],
    ...overrides,
  };
}

afterEach(() => {
  resetShellJobs();
});


describe("runLocalShellCommand abort", () => {
  it("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runLocalShellCommand("sleep 10", process.cwd(), controller.signal),
    ).rejects.toMatchObject({
      code: ToolCallErrorCode.CANCELLED,
    });
  });

  it("kills a long-running command on abort", async () => {
    const controller = new AbortController();
    const promise = runLocalShellCommand(
      "sleep 30",
      process.cwd(),
      controller.signal,
    );

    // Let the process start, then cancel.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    try {
      await promise;
      expect.unreachable("expected cancellation");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolCallError);
      expect((error as ToolCallError).code).toBe(ToolCallErrorCode.CANCELLED);
    }
  });

  it("resolves for a short successful command", async () => {
    const result = await runLocalShellCommand(
      "echo hello-cancel-test",
      process.cwd(),
    );
    expect(result.stdout).toContain("hello-cancel-test");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves non-zero exits so the model can read stderr", async () => {
    const result = await runLocalShellCommand(
      "exit 7",
      process.cwd(),
    );
    expect(result.exitCode).toBe(7);
  });

  it("invokes onOutput as chunks arrive", async () => {
    const chunks: string[] = [];
    const result = await runLocalShellCommand(
      "echo stream-chunk",
      process.cwd(),
      undefined,
      (chunk) => {
        if (chunk.stdout) {
          chunks.push(chunk.stdout);
        }
      },
    );
    expect(result.stdout).toContain("stream-chunk");
    expect(chunks.join("")).toContain("stream-chunk");
  });
});

describe("runTerminalCommandImpl background", () => {
  it("returns a job_id immediately when background is true", async () => {
    const result = await runTerminalCommandImpl(
      { command: "sleep 30", background: true },
      extras(),
    );
    const content = result[0]?.content ?? "";
    expect(content).toContain("Status: running");
    expect(content).toMatch(/Job: sh_/);
    expect(content).toContain("builtin_await_shell");
  });

  it("streams partial output via extras.onPartialOutput", async () => {
    const partials: string[] = [];
    await runTerminalCommandImpl(
      { command: "echo partial-ui" },
      extras({
        onPartialOutput: (items) => {
          partials.push(items[0]?.content ?? "");
        },
      }),
    );
    expect(partials.some((text) => text.includes("partial-ui"))).toBe(true);
  });

  it("auto-backgrounds when block_until_ms elapses", async () => {
    const result = await runTerminalCommandImpl(
      { command: "sleep 2", block_until_ms: 40 },
      extras(),
    );
    const content = result[0]?.content ?? "";
    expect(content).toContain("Status: running");
    expect(content).toMatch(/Job: sh_/);
  });
});

