import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";
import { loadIndexFromCurrentStore } from "./persistence";
import { recoverIncompleteRestore, setRestoreTestHooks } from "./restore";

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
  const workspace = await tempDir("knox-checkout-ws-");
  const store = await tempDir("knox-checkout-store-");
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

describe("checkout on branch switch (CP-39)", () => {
  it("hard switch rewrites files and switching back restores the other line", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      const fileFeatureOnly = path.join(workspace, "feature-only.ts");
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      expect(baselineId).toBeTruthy();

      const feature = await manager.createBranch("feature", baselineId);
      expect(feature).toBeTruthy();
      await fs.writeFile(fileA, "A-feature\n");
      await fs.writeFile(fileFeatureOnly, "only-on-feature\n");
      manager.recentlyModifiedFiles.add(fileA);
      manager.recentlyModifiedFiles.add(fileFeatureOnly);
      expect(await manager.createManualCheckpoint({ description: "feature edit" })).toBeTruthy();

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      expect(main).toBeTruthy();
      const ontoMain = await manager.switchBranch(main.id);
      expect(ontoMain.success).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A0\n");
      await expect(fs.readFile(fileFeatureOnly, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      await fs.writeFile(fileB, "B-main\n");
      manager.recentlyModifiedFiles.add(fileB);
      expect(await manager.createManualCheckpoint({ description: "main edit" })).toBeTruthy();

      const toFeature = await manager.switchBranch(feature.id);
      expect(toFeature.success).toBe(true);
      expect(toFeature.checkout).toBe("hard");
      expect(await fs.readFile(fileA, "utf8")).toBe("A-feature\n");
      expect(await fs.readFile(fileB, "utf8")).toBe("B0\n");
      expect(await fs.readFile(fileFeatureOnly, "utf8")).toBe("only-on-feature\n");

      const backToMain = await manager.switchBranch(main.id);
      expect(backToMain.success).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A0\n");
      expect(await fs.readFile(fileB, "utf8")).toBe("B-main\n");
      await expect(fs.readFile(fileFeatureOnly, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("pointer-only switch does not rewrite files", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      manager.recentlyModifiedFiles.add(fileA);
      await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      const switched = await manager.switchBranch(main.id, { checkout: "none" });
      expect(switched.success).toBe(true);
      expect(switched.checkout).toBe("none");
      expect(await fs.readFile(fileA, "utf8")).toBe("A-feature\n");
    });
  });

  it("dirty tree is auto-stashed on hard switch", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      manager.recentlyModifiedFiles.add(fileA);
      await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await manager.createManualCheckpoint({ description: "main" });

      await fs.writeFile(fileA, "dirty-on-main\n");
      manager.recentlyModifiedFiles.add(fileA);
      const switched = await manager.switchBranch(feature.id);
      expect(switched.success).toBe(true);
      expect(switched.stashed).toBe(true);
      expect(switched.stashId).toMatch(/^st_/);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-feature\n");
      expect(await manager.stashList()).toHaveLength(1);
    });
  });

  it("refuses a dirty tree when auto-stash is disabled", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      manager.recentlyModifiedFiles.add(fileA);
      await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await manager.createManualCheckpoint({ description: "main" });

      await fs.writeFile(fileA, "dirty-on-main\n");
      manager.recentlyModifiedFiles.add(fileA);
      const refused = await manager.switchBranch(feature.id, { autoStash: false });
      expect(refused.success).toBe(false);
      expect(refused.refused).toBe("dirty");
      expect(await fs.readFile(fileA, "utf8")).toBe("dirty-on-main\n");
      expect(manager.activeBranchId).toBe(main.id);
    });
  });

  it("detached checkout persists and later captures stay off the previous branch head", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      await fs.writeFile(fileA, "A1\n");
      manager.recentlyModifiedFiles.add(fileA);
      const midId = await manager.createManualCheckpoint({ description: "mid" });
      await fs.writeFile(fileA, "A2\n");
      manager.recentlyModifiedFiles.add(fileA);
      const tipId = await manager.createManualCheckpoint({ description: "tip" });
      const mainBefore = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      expect(mainBefore?.headCheckpointId).toBe(tipId);

      const checked = await manager.checkoutCheckpoint(midId);
      expect(checked.success).toBe(true);
      expect(checked.detached).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A1\n");
      expect(manager.detachedFrom?.checkpointId).toBe(midId);

      manager.checkpointHistory = [];
      manager.branches = [];
      manager.activeBranchId = undefined;
      manager.detachedFrom = undefined;
      expect(await loadIndexFromCurrentStore(manager)).toBe(true);
      expect(manager.detachedFrom?.checkpointId).toBe(midId);

      await fs.writeFile(fileA, "A-detached\n");
      manager.recentlyModifiedFiles.add(fileA);
      const afterId = await manager.createManualCheckpoint({ description: "after detached" });
      const after = manager.getCheckpointInfo(afterId);
      expect(after?.parentCheckpointId).toBe(midId);
      expect(after?.branchId).toBeUndefined();
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      expect(main.headCheckpointId).toBe(tipId);
    });
  });

  it("crash journal during hard checkout still recovers", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      manager.recentlyModifiedFiles.add(fileA);
      await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await manager.createManualCheckpoint({ description: "main" });

      setRestoreTestHooks({
        afterJournalWrite: async () => {
          throw new Error("simulated crash after journal");
        },
      });
      try {
        await expect(manager.switchBranch(feature.id)).rejects.toThrow(/simulated crash/);
      } finally {
        setRestoreTestHooks(undefined);
      }
      await recoverIncompleteRestore(manager);
      expect(await fs.readFile(fileA, "utf8")).toBe("A0\n");
    });
  });
});
