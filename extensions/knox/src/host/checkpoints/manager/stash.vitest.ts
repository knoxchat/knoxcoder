import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";
import { collectReferencedBlobHashes, gcUnreferencedCheckpointBlobs } from "./persistence";
import {
  collectStashBlobHashes,
  loadStashIndex,
  saveStashIndex,
  type CheckpointStashEntry,
} from "../store/stashIndex";

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
  const workspace = await tempDir("knox-stash-ws-");
  const store = await tempDir("knox-stash-store-");
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
  manager.extensionContext = undefined;

  try {
    await fn({ workspace, store, manager });
  } finally {
    Object.assign(manager, backup);
  }
}

describe("stash index (CP-38)", () => {
  it("round-trips entries without inlined file bytes", async () => {
    const store = await tempDir("knox-stash-index-");
    const entry: CheckpointStashEntry = {
      id: "st_11111111-1111-4111-8111-111111111111",
      message: "wip",
      createdAt: new Date("2026-10-29T00:00:00.000Z"),
      baseCheckpointId: "cp_base",
      fileSnapshots: [{
        relativePath: "a.ts",
        hash: "a".repeat(64),
        encoding: "utf8",
        lastModified: new Date("2026-10-29T00:00:00.000Z"),
        size: 3,
        changeType: "modified",
      }],
    };
    await saveStashIndex(store, [entry]);
    const loaded = await loadStashIndex(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(entry.id);
    expect(loaded[0].message).toBe("wip");
    expect(loaded[0].fileSnapshots[0].hash).toBe("a".repeat(64));
    expect(loaded[0].fileSnapshots[0].content).toBeUndefined();
  });
});

describe("working-tree stash (CP-38)", () => {
  it("push then pop round-trips dirty files and new files", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "A0\n");
      expect(await manager.createManualCheckpoint({ description: "base" })).toBeTruthy();

      await fs.writeFile(fileA, "A1\n");
      await fs.writeFile(fileB, "B-new\n");
      manager.recentlyModifiedFiles.add(fileA);
      manager.recentlyModifiedFiles.add(fileB);

      const pushed = await manager.stashPush({ message: "wip" });
      expect(pushed.success).toBe(true);
      expect(pushed.empty).toBe(false);
      expect(pushed.stashId).toMatch(/^st_/);
      expect(await fs.readFile(fileA, "utf8")).toBe("A0\n");
      await expect(fs.readFile(fileB, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const listed = await manager.stashList();
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(pushed.stashId);
      expect(listed[0].message).toBe("wip");

      const popped = await manager.stashPop();
      expect(popped.success).toBe(true);
      expect(popped.conflicts).toEqual([]);
      expect(await fs.readFile(fileA, "utf8")).toBe("A1\n");
      expect(await fs.readFile(fileB, "utf8")).toBe("B-new\n");
      expect(await manager.stashList()).toHaveLength(0);
    });
  });

  it("empty stash is a no-op success", async () => {
    await withManager(async ({ workspace, manager }) => {
      await fs.writeFile(path.join(workspace, "a.ts"), "A0\n");
      expect(await manager.createManualCheckpoint({ description: "base" })).toBeTruthy();
      const pushed = await manager.stashPush();
      expect(pushed.success).toBe(true);
      expect(pushed.empty).toBe(true);
      expect(await manager.stashList()).toHaveLength(0);
    });
  });

  it("reload keeps the stash stack", async () => {
    await withManager(async ({ workspace, store, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      expect(await manager.createManualCheckpoint({ description: "base" })).toBeTruthy();
      await fs.writeFile(fileA, "A1\n");
      manager.recentlyModifiedFiles.add(fileA);
      const pushed = await manager.stashPush({ message: "keep" });
      expect(pushed.stashId).toBeTruthy();
      const fromDisk = await loadStashIndex(store);
      expect(fromDisk).toHaveLength(1);
      expect(fromDisk[0].id).toBe(pushed.stashId);
      expect(fromDisk[0].message).toBe("keep");
    });
  });

  it("conflicts leave the workspace unchanged", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      expect(await manager.createManualCheckpoint({ description: "base" })).toBeTruthy();
      await fs.writeFile(fileA, "A1\n");
      manager.recentlyModifiedFiles.add(fileA);
      expect((await manager.stashPush()).stashId).toBeTruthy();

      await fs.writeFile(fileA, "A2\n");
      const popped = await manager.stashPop();
      expect(popped.success).toBe(false);
      expect(popped.conflicts.map((conflict: { path: string }) => conflict.path)).toEqual(["a.ts"]);
      expect(await fs.readFile(fileA, "utf8")).toBe("A2\n");
      expect(await manager.stashList()).toHaveLength(1);
    });
  });

  it("stash blobs survive garbage collection", async () => {
    await withManager(async ({ workspace, store, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      expect(await manager.createManualCheckpoint({ description: "base" })).toBeTruthy();
      await fs.writeFile(fileA, "A-stashed\n");
      manager.recentlyModifiedFiles.add(fileA);
      expect((await manager.stashPush()).stashId).toBeTruthy();

      const stashHashes = await collectStashBlobHashes(store);
      expect(stashHashes.length).toBeGreaterThan(0);
      const referenced = await collectReferencedBlobHashes(manager);
      for (const hash of stashHashes) {
        expect(referenced.has(hash)).toBe(true);
      }
      await gcUnreferencedCheckpointBlobs(manager);
      const popped = await manager.stashPop();
      expect(popped.success).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-stashed\n");
    });
  });
});
