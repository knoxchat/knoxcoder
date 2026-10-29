import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointManager } from "../CheckpointManager";
import { blobObjectPaths } from "../store/blobStore";
import { attributeLines, collapseBlameRanges } from "./blame";

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
  const workspace = await tempDir("knox-blame-ws-");
  const store = await tempDir("knox-blame-store-");
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

describe("attributeLines (CP-44)", () => {
  it("blames unchanged lines on the first version and new lines on the second", () => {
    const blamed = attributeLines(
      ["keep", "added"],
      [
        { checkpointId: "cp-a", description: "first", originPath: "a.ts", lines: ["keep"] },
        { checkpointId: "cp-b", description: "second", originPath: "a.ts", lines: ["keep", "added"] },
      ],
    );
    expect(blamed[0]).toMatchObject({ line: 1, text: "keep", checkpointId: "cp-a" });
    expect(blamed[1]).toMatchObject({ line: 2, text: "added", checkpointId: "cp-b" });
  });

  it("skips a missing version and blames the next reconstructable one", () => {
    const blamed = attributeLines(
      ["keep", "added"],
      [
        { checkpointId: "cp-a", description: "first", originPath: "a.ts", lines: null },
        { checkpointId: "cp-b", description: "second", originPath: "a.ts", lines: ["keep", "added"] },
      ],
    );
    expect(blamed[0].checkpointId).toBe("cp-b");
    expect(blamed[1].checkpointId).toBe("cp-b");
  });

  it("leaves lines unknown when every version blob is missing", () => {
    const blamed = attributeLines(
      ["keep"],
      [{ checkpointId: "cp-a", description: "first", originPath: "a.ts", lines: null }],
    );
    expect(blamed[0].checkpointId).toBeUndefined();
  });

  it("collapses consecutive lines from the same checkpoint", () => {
    const ranges = collapseBlameRanges([
      { line: 1, text: "a", checkpointId: "cp-a" },
      { line: 2, text: "b", checkpointId: "cp-a" },
      { line: 3, text: "c", checkpointId: "cp-b" },
    ]);
    expect(ranges).toEqual([
      { startLine: 1, endLine: 2, checkpointId: "cp-a" },
      { startLine: 3, endLine: 3, checkpointId: "cp-b" },
    ]);
  });
});

describe("blameFile (CP-44)", () => {
  it("attributes old lines to the first checkpoint and new lines to the second", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "keep\n");
      const firstId = await manager.createManualCheckpoint({ description: "first" });
      await fs.writeFile(fileA, "keep\nadded\n");
      const secondId = await manager.createManualCheckpoint({ description: "second" });

      const blamed = await manager.blameFile("a.ts");
      expect(blamed.unsupported).toBeUndefined();
      expect(blamed.lines).toHaveLength(2);
      expect(blamed.lines[0]).toMatchObject({ text: "keep", checkpointId: firstId });
      expect(blamed.lines[1]).toMatchObject({ text: "added", checkpointId: secondId });
    });
  });

  it("follows a rename so old lines keep the original checkpoint", async () => {
    await withManager(async ({ workspace, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      const fileB = path.join(workspace, "b.ts");
      await fs.writeFile(fileA, "hello\nworld\n");
      const firstId = await manager.createManualCheckpoint({ description: "created a.ts" });
      await fs.rename(fileA, fileB);
      await fs.writeFile(fileB, "hello\nworld\nnew\n");
      manager.lastCheckpointTime = Date.now() - 1000;
      manager.watcherTrusted = false;
      manager.recentlyDeletedFiles = new Set([fileA]);
      manager.recentlyModifiedFiles = new Set([fileB]);
      const secondId = await manager.createManualCheckpoint({ description: "renamed" });
      expect(secondId).toBeTruthy();

      const blamed = await manager.blameFile("b.ts");
      expect(blamed.lines[0]).toMatchObject({ text: "hello", checkpointId: firstId, originPath: "a.ts" });
      expect(blamed.lines[1]).toMatchObject({ text: "world", checkpointId: firstId, originPath: "a.ts" });
      expect(blamed.lines[2]).toMatchObject({ text: "new", checkpointId: secondId, originPath: "b.ts" });
    });
  });

  it("degrades missing blobs to unknown without throwing", async () => {
    await withManager(async ({ workspace, store, manager }) => {
      const fileA = path.join(workspace, "a.ts");
      await fs.writeFile(fileA, "keep\n");
      const firstId = await manager.createManualCheckpoint({ description: "first" });
      const hash = manager.lastSnapshotHashes.get("a.ts") as string | undefined;
      expect(hash).toBeTruthy();
      const paths = blobObjectPaths(store, hash);
      await Promise.allSettled([
        fs.unlink(paths.raw),
        fs.unlink(paths.gz),
        fs.unlink(paths.enc),
      ]);

      await fs.writeFile(fileA, "keep\nadded\n");
      await manager.createManualCheckpoint({ description: "second" });

      const blamed = await manager.blameFile("a.ts");
      expect(blamed.lines.length).toBeGreaterThan(0);
      expect(blamed.lines.every((line: { checkpointId?: string }) => line.checkpointId !== firstId)).toBe(true);
    });
  });
});
