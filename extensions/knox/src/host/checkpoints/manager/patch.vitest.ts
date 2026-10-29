import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";
import { parseUnifiedPatch } from "./patch";

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
  fn: (ctx: { workspace: string; manager: any }) => Promise<void>,
): Promise<void> {
  const workspace = await tempDir("knox-patch-ws-");
  const store = await tempDir("knox-patch-store-");
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
  manager.lastCheckpointTime = Date.now() - 1000;
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
    await fn({ workspace, manager });
  } finally {
    Object.assign(manager, backup);
  }
}

describe("portable patch (CP-47)", () => {
  it("round-trips a text checkpoint onto the same parent", async () => {
    await withManager(async ({ workspace, manager }) => {
      const file = path.join(workspace, "a.ts");
      await fs.writeFile(file, "keep\n");
      await manager.createManualCheckpoint({ description: "parent" });
      await fs.writeFile(file, "keep\nadded\n");
      manager.lastCheckpointTime = Date.now() - 1000;
      const childId = await manager.createManualCheckpoint({ description: "Add line" });
      const exported = await manager.exportPatch(childId);
      expect(exported.success).toBe(true);
      expect(exported.patch).toContain("X-Knox-Checkpoint:");
      expect(exported.patch).toContain("Subject: Add line");
      expect(exported.patch).toContain("+added");

      await fs.writeFile(file, "keep\n");
      const applied = await manager.applyPatch(exported.patch);
      expect(applied.success).toBe(true);
      expect(await fs.readFile(file, "utf8")).toBe("keep\nadded\n");
      const created = manager.checkpointHistory.find((item: { id: string }) => item.id === applied.checkpointId);
      expect(created?.tags).toEqual(expect.arrayContaining(["patch", childId]));
    });
  });

  it("three-way applies on a shifted base", async () => {
    await withManager(async ({ workspace, manager }) => {
      const file = path.join(workspace, "a.ts");
      await fs.writeFile(file, "keep\nshared\n");
      await manager.createManualCheckpoint({ description: "parent" });
      await fs.writeFile(file, "keep\nshared-theirs\n");
      manager.lastCheckpointTime = Date.now() - 1000;
      const childId = await manager.createManualCheckpoint({ description: "theirs" });
      const exported = await manager.exportPatch(childId);
      expect(exported.success).toBe(true);

      await fs.writeFile(file, "keep-ours\nshared\n");
      const applied = await manager.applyPatch(exported.patch);
      expect(applied.success).toBe(true);
      expect(await fs.readFile(file, "utf8")).toBe("keep-ours\nshared-theirs\n");
    });
  });

  it("refuses a malformed patch without writes", async () => {
    await withManager(async ({ workspace, manager }) => {
      const file = path.join(workspace, "a.ts");
      await fs.writeFile(file, "safe\n");
      await manager.createManualCheckpoint({ description: "base" });
      const refused = await manager.applyPatch("this is not a patch");
      expect(refused.success).toBe(false);
      expect(refused.message).toMatch(/Malformed patch/i);
      expect(await fs.readFile(file, "utf8")).toBe("safe\n");
    });
  });

  it("parses rename headers", () => {
    const parsed = parseUnifiedPatch(`From cp_1
Subject: rename
X-Knox-Checkpoint: cp_1

diff --git a/a.ts b/b.ts
rename from a.ts
rename to b.ts
--- a/a.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
-hello
+hello
`);
    expect(parsed.files[0].renamedFrom).toBe("a.ts");
    expect(parsed.files[0].newPath).toBe("b.ts");
  });
});
