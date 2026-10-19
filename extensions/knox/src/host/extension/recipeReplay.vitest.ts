import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const manager = {
  readBlobBytes: vi.fn(async () => undefined as Buffer | undefined),
  createManualCheckpoint: vi.fn(async () => "cp-1" as string | undefined),
  restoreCheckpoint: vi.fn(async () => ({ success: true, failedFiles: [] as string[] })),
  createWhatIfBranch: vi.fn(async (..._args: unknown[]) => ({ id: "b1" }) as unknown),
};
vi.mock("../checkpoints/CheckpointManager", () => ({ CheckpointManager: { getInstance: () => manager } }));

import { createReplayPorts, recipeOutOfHostProject, type RecipeReplayHost } from "./recipeReplay";

let dir: string;
beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "recipe-replay-"));
  vi.clearAllMocks();
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const term = (exit: number, content = "") => [{ name: "Terminal", description: `Terminal command exited ${exit}`, content }];

function host(callTool: RecipeReplayHost["callTool"]): RecipeReplayHost {
  return { workspaceDir: dir, callTool };
}

describe("createReplayPorts", () => {
  it("writes through the tool path and confirms the bytes landed", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const ports = await createReplayPorts(
      host(async (name, args) => {
        calls.push([name, args]);
        await fsp.writeFile(path.join(dir, args.filepath as string), args.contents as string);
        return [];
      }),
    );
    expect(await ports.writeFile("a.txt", "hello")).toEqual({ ok: true });
    expect(calls).toEqual([["builtin_write_file", { filepath: "a.txt", contents: "hello", openAfterWrite: false }]]);
  });

  it("does not count a write held for review as applied", async () => {
    const ports = await createReplayPorts(host(async () => []));
    const res = await ports.writeFile("a.txt", "hello");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/held for review/);
  });

  it("reports a rejected tool call as a failed write", async () => {
    const ports = await createReplayPorts(
      host(async () => {
        throw new Error("permission denied");
      }),
    );
    expect(await ports.writeFile("a.txt", "x")).toEqual({ ok: false, error: "permission denied" });
  });

  it("refuses binary content and deletes", async () => {
    const ports = await createReplayPorts(host(async () => []));
    expect((await ports.writeFile("a.bin", new Uint8Array([0xff, 0xfe, 0x00]))).ok).toBe(false);
    expect((await ports.deleteFile("a.txt")).ok).toBe(false);
  });

  it("hashes what is on disk and reads current text", async () => {
    const ports = await createReplayPorts(host(async () => []));
    expect(await ports.currentHash("none.txt")).toBeUndefined();
    await fsp.writeFile(path.join(dir, "a.txt"), "hello");
    // sha256("hello")
    expect(await ports.currentHash("a.txt")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(await ports.readCurrent("a.txt")).toBe("hello");
  });

  it("refuses a path that escapes the workspace", async () => {
    const ports = await createReplayPorts(host(async () => []));
    expect(await ports.currentHash("../outside.txt")).toBeUndefined();
  });

  it("verify passes on exit 0 and fails on a non-zero exit with the output", async () => {
    const recipe = { oracle: { kind: "test", passedAt: "x", command: "npm test" } } as never;
    const ok = await createReplayPorts(host(async () => term(0, "all green")));
    expect(await ok.verify(recipe)).toEqual({ ok: true });
    const bad = await createReplayPorts(host(async () => term(1, "1 failed")));
    expect(await bad.verify(recipe)).toMatchObject({ ok: false, detail: "1 failed" });
  });

  it("verify fails when the recipe has no command to repeat", async () => {
    const ports = await createReplayPorts(host(async () => term(0)));
    expect((await ports.verify({ oracle: { kind: "user", passedAt: "x" } } as never)).ok).toBe(false);
  });

  it("MC-90 refuses a project-scope recipe captured in another workspace", async () => {
    const local = host(async () => []);
    const foreign = {
      id: "r".repeat(64),
      projectId: "other-project",
      scope: "project" as const,
      status: "verified" as const,
      title: "x",
      intentText: "",
      intentFingerprint: "x",
      slots: [],
      preconditions: [],
      steps: [],
      sourceCheckpointIds: [],
      stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
      captureCount: 1,
      createdAt: "",
      updatedAt: "",
    };
    expect(await recipeOutOfHostProject(local, foreign)).toBe(true);
    expect(await recipeOutOfHostProject(local, { ...foreign, scope: "global" })).toBe(false);
  });

  it("verify never runs a network or secret-bearing oracle command (MC-82)", async () => {
    const callTool = vi.fn(async () => term(0));
    const ports = await createReplayPorts(host(callTool));
    const res = await ports.verify({ oracle: { kind: "build", passedAt: "x", command: "git push origin main" } } as never);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/network/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("command steps fail on non-zero exit", async () => {
    const ports = await createReplayPorts(host(async () => term(2, "boom")));
    expect((await ports.runCommand("npm i")).ok).toBe(false);
  });

  it("checkpoint failures surface", async () => {
    const ports = await createReplayPorts(host(async () => []));
    manager.createManualCheckpoint.mockResolvedValueOnce(undefined);
    await expect(ports.createCheckpoint("x")).rejects.toThrow(/pre-replay checkpoint/);
    manager.restoreCheckpoint.mockResolvedValueOnce({ success: false, failedFiles: ["a"] });
    await expect(ports.restoreCheckpoint("cp")).rejects.toThrow(/restore reported failure/);
  });

  it("forks a what-if branch at the pre-replay checkpoint only for adapt (MC-62)", async () => {
    const plain = await createReplayPorts(host(async () => []));
    await plain.createCheckpoint("x");
    expect(manager.createWhatIfBranch).not.toHaveBeenCalled();

    const adapt = await createReplayPorts(host(async () => []), { recipeId: "r1", intent: "make header" });
    expect(await adapt.createCheckpoint("x")).toBe("cp-1");
    expect(manager.createWhatIfBranch).toHaveBeenCalledWith("cp-1", "r1", "make header");
  });

  it("a failed or disabled what-if branch never blocks the replay (MC-62)", async () => {
    manager.createWhatIfBranch.mockRejectedValueOnce(new Error("nope"));
    const adapt = await createReplayPorts(host(async () => []), { recipeId: "r1" });
    expect(await adapt.createCheckpoint("x")).toBe("cp-1");

    const off = await createReplayPorts({ ...host(async () => []), whatIfBranch: false }, { recipeId: "r1" });
    await off.createCheckpoint("x");
    expect(manager.createWhatIfBranch).toHaveBeenCalledTimes(1);
  });
});
