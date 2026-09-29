import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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


describe("cargo new pins (real cargo)", () => {
  const hasCargo = spawnSync("cargo", ["--version"]).status === 0;

  function extrasFor(dir: string): ToolExtras {
    return extras({
      ide: {
        getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
        getWorkspaceDirs: vi.fn(async () => [`file://${dir}`]),
      } as unknown as IDE,
    });
  }

  it.skipIf(!hasCargo)(
    "pins a new crate but leaves an existing project's versions alone",
    async () => {
      const dir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "knox-real-cargo-")),
      );
      try {
        const result = await runTerminalCommandImpl(
          { command: "cargo new snake --vcs none" },
          extrasFor(dir),
        );
        const manifest = fs.readFileSync(path.join(dir, "snake/Cargo.toml"), "utf8");
        expect(manifest).toContain('edition = "2024"');
        expect(manifest).toContain('rust-version = "1.98.1"');
        expect(
          fs.readFileSync(path.join(dir, "snake/rust-toolchain.toml"), "utf8"),
        ).toContain('channel = "1.98.1"');
        expect(result.some((i) => i.name === "Rust new crate")).toBe(true);

        // Existing project: cargo init must fail / not be rewritten.
        const old = path.join(dir, "old");
        fs.mkdirSync(old);
        const legacy =
          '[package]\nname = "old"\nversion = "0.1.0"\nedition = "2021"\nrust-version = "1.70"\n';
        fs.writeFileSync(path.join(old, "Cargo.toml"), legacy);
        const again = await runTerminalCommandImpl(
          { command: "cargo init old --vcs none" },
          extrasFor(dir),
        );
        expect(fs.readFileSync(path.join(old, "Cargo.toml"), "utf8")).toBe(legacy);
        expect(fs.existsSync(path.join(old, "rust-toolchain.toml"))).toBe(false);
        expect(again.some((i) => i.name === "Rust new crate")).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
