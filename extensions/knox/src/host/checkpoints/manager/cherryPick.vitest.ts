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
  const workspace = await tempDir("knox-cherrypick-ws-");
  const store = await tempDir("knox-cherrypick-store-");
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

describe("cherry-pick (CP-41)", () => {
  it("applies only the source turn onto main and keeps main-only files", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      expect(baselineId).toBeTruthy();

      const feature = await manager.createBranch("feature", baselineId);
      expect(feature).toBeTruthy();
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({
        description: "feature a",
        intent: "add feature a",
      });
      expect(featureId).toBeTruthy();
      const featureCp = manager.checkpointHistory.find((item: { id: string }) => item.id === featureId);
      if (featureCp) {
        featureCp.label = "Add feature a";
      }

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      expect(main).toBeTruthy();
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B-main\n");
      const mainId = await manager.createManualCheckpoint({ description: "main b" });
      expect(mainId).toBeTruthy();

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(true);
      expect(picked.empty).toBeFalsy();
      expect(picked.conflicts).toEqual([]);
      expect(picked.checkpointId).toBeTruthy();
      expect(await fs.readFile(fileA, "utf8")).toBe("A-feature\n");
      expect(await fs.readFile(fileB, "utf8")).toBe("B-main\n");

      const newCp = manager.checkpointHistory.find((item: { id: string }) => item.id === picked.checkpointId);
      expect(newCp?.parentCheckpointId).toBe(mainId);
      expect(newCp?.tags).toEqual(expect.arrayContaining(["cherry-pick", featureId]));
      expect(newCp?.label).toBe("Add feature a");
      expect(newCp?.intent).toBe("add feature a");

      const reconstructed = await manager.reconstructStateAtCheckpoint(picked.checkpointId) as Map<string, { content: string }> | null;
      expect(reconstructed?.get("a.ts")?.content).toBe("A-feature\n");
      expect(reconstructed?.get("b.ts")?.content).toBe("B-main\n");
    });
  });

  it("treats already-present changes as a no-op and leaves HEAD unchanged", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A1\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A1\n");
      const mainId = await manager.createManualCheckpoint({ description: "same change" });
      const beforeCount = manager.checkpointHistory.length;

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(true);
      expect(picked.empty).toBe(true);
      expect(picked.checkpointId).toBeUndefined();
      expect(manager.checkpointHistory.length).toBe(beforeCount);
      expect(manager.getActiveBranch()?.headCheckpointId).toBe(mainId);
      expect(await fs.readFile(fileA, "utf8")).toBe("A1\n");
    });
  });

  it("reports overlapping hunks, writes markers, and leaves HEAD unchanged", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      const mainId = await manager.createManualCheckpoint({ description: "main" });
      const beforeCount = manager.checkpointHistory.length;

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(false);
      expect(picked.mergeInProgress).toBe(true);
      expect(picked.conflicts.map((conflict: { path: string }) => conflict.path)).toContain("a.ts");
      expect(picked.checkpointId).toBeUndefined();
      expect(manager.checkpointHistory.length).toBe(beforeCount);
      expect(manager.getActiveBranch()?.headCheckpointId).toBe(mainId);
      expect(await fs.readFile(fileA, "utf8")).toContain("<<<<<<<");

      const aborted = await manager.mergeAbort();
      expect(aborted.success).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-main\n");
      expect(await manager.getMergeState()).toBeNull();
    });
  });

  it("continues a cherry-pick after conflict markers are resolved", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });

      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      const mainId = await manager.createManualCheckpoint({ description: "main" });
      const beforeCount = manager.checkpointHistory.length;

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(false);
      expect(picked.mergeInProgress).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toContain("<<<<<<<");

      await fs.writeFile(fileA, "A-resolved\n");
      const continued = await manager.mergeContinue();
      expect(continued.success).toBe(true);
      expect(continued.checkpointId).toBeTruthy();
      expect(continued.conflicts).toEqual([]);
      expect(manager.checkpointHistory.length).toBe(beforeCount + 1);
      expect(manager.getActiveBranch()?.headCheckpointId).toBe(continued.checkpointId);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-resolved\n");
      expect(await manager.getMergeState()).toBeNull();

      const newCp = manager.checkpointHistory.find((item: { id: string }) => item.id === continued.checkpointId);
      expect(newCp?.parentCheckpointId).toBe(mainId);
      expect(newCp?.tags).toEqual(expect.arrayContaining(["cherry-pick", featureId]));
      const reconstructed = await manager.reconstructStateAtCheckpoint(continued.checkpointId) as Map<string, { content: string }> | null;
      expect(reconstructed?.get("a.ts")?.content).toBe("A-resolved\n");
    });
  });

  it("honors renamedFrom so a rename applies as one path", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "hello\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.rename(fileA, fileB);
      manager.lastCheckpointTime = Date.now() - 1000;
      manager.watcherTrusted = false;
      manager.recentlyDeletedFiles = new Set([fileA]);
      manager.recentlyModifiedFiles = new Set([fileB]);
      const featureId = await manager.createManualCheckpoint({ description: "rename" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "hard" });
      expect(await fs.readFile(fileA, "utf8")).toBe("hello\n");

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(true);
      expect(picked.conflicts).toEqual([]);
      await expect(fs.readFile(fileA, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(fileB, "utf8")).toBe("hello\n");
    });
  });
});

describe("inverse revert (CP-42)", () => {
  it("reverts B after C and keeps C's unique files", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileC = path.join(workspace, "c.ts");
      const fileB = path.join(workspace, "b-only.ts");
      await fs.writeFile(fileA, "A0\n");
      const aId = await manager.createManualCheckpoint({ description: "A" });
      expect(aId).toBeTruthy();

      await fs.writeFile(fileA, "A-bad\n");
      await fs.writeFile(fileB, "B-only\n");
      const bId = await manager.createManualCheckpoint({ description: "B bad turn" });
      expect(bId).toBeTruthy();

      await fs.writeFile(fileC, "C-only\n");
      const cId = await manager.createManualCheckpoint({ description: "C later" });
      expect(cId).toBeTruthy();

      const reverted = await manager.revertCheckpoint(bId);
      expect(reverted.success).toBe(true);
      expect(reverted.empty).toBeFalsy();
      expect(reverted.checkpointId).toBeTruthy();
      expect(reverted.conflicts).toEqual([]);
      expect(await fs.readFile(fileA, "utf8")).toBe("A0\n");
      await expect(fs.readFile(fileB, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(fileC, "utf8")).toBe("C-only\n");

      const newCp = manager.checkpointHistory.find((item: { id: string }) => item.id === reverted.checkpointId);
      expect(newCp?.parentCheckpointId).toBe(cId);
      expect(newCp?.description).toBe('Revert "B bad turn"');
      expect(newCp?.tags).toEqual(expect.arrayContaining(["revert", bId]));
      expect(manager.checkpointHistory.some((item: { id: string }) => item.id === bId)).toBe(true);
    });
  });

  it("refuses merge checkpoints without mainline", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      await manager.createManualCheckpoint({ description: "feature a" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B-main\n");
      await manager.createManualCheckpoint({ description: "main b" });
      const merged = await manager.mergeBranches(feature.id, main.id);
      expect(merged.success).toBe(true);
      expect(merged.mergeCheckpointId).toBeTruthy();

      const refused = await manager.revertCheckpoint(merged.mergeCheckpointId);
      expect(refused.success).toBe(false);
      expect(refused.message).toMatch(/mainline/i);

      const withMainline = await manager.revertCheckpoint(merged.mergeCheckpointId, { mainline: 1 });
      expect(withMainline.success).toBe(true);
    });
  });
});

describe("merge continue / abort (CP-43)", () => {
  it("refuses continue while markers remain", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      await manager.createManualCheckpoint({ description: "main" });

      const picked = await manager.cherryPick(featureId);
      expect(picked.mergeInProgress).toBe(true);

      const refused = await manager.mergeContinue();
      expect(refused.success).toBe(false);
      expect(refused.message).toMatch(/Unresolved conflict markers/i);
      expect(await manager.getMergeState()).not.toBeNull();
    });
  });

  it("continues a branch merge after resolving markers", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      const mainId = await manager.createManualCheckpoint({ description: "main" });

      const other = await manager.createBranch("other", baselineId);
      await fs.writeFile(fileA, "A-other\n");
      const otherId = await manager.createManualCheckpoint({ description: "other" });
      await manager.switchBranch(feature.id, { checkout: "none" });

      const conflicted = await manager.mergeBranches(other.id, feature.id);
      expect(conflicted.success).toBe(false);
      expect(conflicted.mergeInProgress).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toContain("<<<<<<<");

      await fs.writeFile(fileA, "A-resolved\n");
      const continued = await manager.mergeContinue();
      expect(continued.success).toBe(true);
      expect(continued.checkpointId).toBeTruthy();
      expect(await manager.getMergeState()).toBeNull();
      expect(manager.getActiveBranch()?.headCheckpointId).toBe(continued.checkpointId);

      const newCp = manager.checkpointHistory.find((item: { id: string }) => item.id === continued.checkpointId);
      expect(newCp?.parentCheckpointId).toBe(featureId);
      expect(newCp?.parentCheckpointIds).toEqual([featureId, otherId]);
      expect(newCp?.tags).toEqual(expect.arrayContaining(["merge"]));
      const reconstructed = await manager.reconstructStateAtCheckpoint(continued.checkpointId) as Map<string, { content: string }> | null;
      expect(reconstructed?.get("a.ts")?.content).toBe("A-resolved\n");
      expect(mainId).toBeTruthy();
    });
  });

  it("refuses overlapping dirty files without writing markers", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      await manager.createManualCheckpoint({ description: "main" });
      await fs.writeFile(fileA, "A-dirty\n");

      const picked = await manager.cherryPick(featureId);
      expect(picked.success).toBe(false);
      expect(picked.mergeInProgress).toBeFalsy();
      expect(picked.message).toMatch(/uncheckpointed/i);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-dirty\n");
      expect(await manager.getMergeState()).toBeNull();
    });
  });

  it("refuses a second merge while one is in progress", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "A0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      const featureId = await manager.createManualCheckpoint({ description: "feature" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A-main\n");
      await manager.createManualCheckpoint({ description: "main" });

      const first = await manager.cherryPick(featureId);
      expect(first.mergeInProgress).toBe(true);
      const second = await manager.cherryPick(featureId);
      expect(second.success).toBe(false);
      expect(second.mergeInProgress).toBeFalsy();
      expect(second.message).toMatch(/already in progress/i);
      expect(await fs.readFile(fileA, "utf8")).toContain("<<<<<<<");
    });
  });

  it("writes the merged workspace on a clean branch merge", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B0\n");
      const baselineId = await manager.createManualCheckpoint({ description: "base" });
      const feature = await manager.createBranch("feature", baselineId);
      await fs.writeFile(fileA, "A-feature\n");
      await manager.createManualCheckpoint({ description: "feature a" });
      const main = (await manager.listBranches()).find((item: { name: string }) => item.name === "main");
      await manager.switchBranch(main.id, { checkout: "none" });
      await fs.writeFile(fileA, "A0\n");
      await fs.writeFile(fileB, "B-main\n");
      await manager.createManualCheckpoint({ description: "main b" });

      const merged = await manager.mergeBranches(feature.id, main.id);
      expect(merged.success).toBe(true);
      expect(await fs.readFile(fileA, "utf8")).toBe("A-feature\n");
      expect(await fs.readFile(fileB, "utf8")).toBe("B-main\n");
    });
  });
});
