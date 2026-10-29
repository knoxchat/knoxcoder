import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";
import { MAX_CHECKPOINT_WORKTREES } from "./worktree";

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
  const workspace = await tempDir("knox-wt-ws-");
  const store = await tempDir("knox-wt-store-");
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

describe("checkpoint worktree (CP-45)", () => {
  it("materializes a tree that matches reconstruct and can exist beside another", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const nested = path.join(workspace, "src", "b.ts");
      await fs.mkdir(path.dirname(nested), { recursive: true });
      await fs.writeFile(fileA, "hello\n");
      await fs.writeFile(nested, "world\n");
      const checkpointId = await manager.createManualCheckpoint({ description: "snap" });

      const destA = await tempDir("knox-wt-a-");
      const destB = await tempDir("knox-wt-b-");
      const first = await manager.materializeWorktree(checkpointId, { destDir: destA });
      expect(first.success).toBe(true);
      expect(await fs.readFile(path.join(destA, "a.ts"), "utf8")).toBe("hello\n");
      expect(await fs.readFile(path.join(destA, "src", "b.ts"), "utf8")).toBe("world\n");

      const reconstructed = await manager.reconstructStateAtCheckpoint(checkpointId) as Map<string, { content: string }>;
      expect(reconstructed.get("a.ts")?.content).toBe("hello\n");
      expect(reconstructed.get("src/b.ts")?.content).toBe("world\n");

      const second = await manager.materializeWorktree(checkpointId, { destDir: destB });
      expect(second.success).toBe(true);
      expect(second.worktreeId).not.toBe(first.worktreeId);
      expect(await fs.readFile(path.join(destB, "a.ts"), "utf8")).toBe("hello\n");
      expect((await manager.listWorktrees()).length).toBe(2);

      const removed = await manager.removeWorktree(first.worktreeId);
      expect(removed.success).toBe(true);
      await expect(fs.access(path.join(destA, "a.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await manager.listWorktrees()).map((item: { id: string }) => item.id)).toEqual([second.worktreeId]);
    });
  });

  it("refuses a destination inside the project root", async () => {
    await withManager(async ({ workspace, manager }) => {
      await fs.writeFile(path.join(workspace, "a.ts"), "x\n");
      const checkpointId = await manager.createManualCheckpoint({ description: "snap" });
      const dest = path.join(workspace, "exported");
      const refused = await manager.materializeWorktree(checkpointId, { destDir: dest });
      expect(refused.success).toBe(false);
      expect(refused.message).toMatch(/project root/i);
      await expect(fs.access(dest)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("caps concurrent worktrees", async () => {
    await withManager(async ({ manager }) => {
      await fs.writeFile(path.join(manager.currentWorkspacePath, "a.ts"), "x\n");
      const checkpointId = await manager.createManualCheckpoint({ description: "snap" });
      const ids: string[] = [];
      for (let i = 0; i < MAX_CHECKPOINT_WORKTREES; i++) {
        const dest = await tempDir(`knox-wt-cap-${i}-`);
        const result = await manager.materializeWorktree(checkpointId, { destDir: dest });
        expect(result.success).toBe(true);
        ids.push(result.worktreeId);
      }
      const extra = await manager.materializeWorktree(checkpointId, { destDir: await tempDir("knox-wt-extra-") });
      expect(extra.success).toBe(false);
      expect(extra.message).toMatch(/at most/i);
    });
  });
});
