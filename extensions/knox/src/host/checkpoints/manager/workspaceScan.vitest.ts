import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_MTIME_SLACK_MS,
  changedFullPathsFromScan,
  type WorkspaceScanResult,
} from "./workspaceScan";

function scan(files: Array<{ relativePath: string; mtimeMs: number }>): WorkspaceScanResult {
  return {
    files: files.map((file) => ({
      ...file,
      fullPath: `/ws/${file.relativePath}`,
      size: 4,
    })),
    skippedFiles: [],
    stats: {
      durationMs: 0,
      directoriesRead: 1,
      filesSeen: files.length,
      ignoredDirectoriesSkipped: 0,
      skippedIgnoredDirs: [],
    },
  };
}

describe("changedFullPathsFromScan", () => {
  it("treats mtime on or just before the watermark as changed (Windows slack)", () => {
    const now = 1_000_000;
    const result = scan([
      { relativePath: "old.ts", mtimeMs: now - CHECKPOINT_MTIME_SLACK_MS - 1 },
      { relativePath: "same.ts", mtimeMs: now },
      { relativePath: "just-before.ts", mtimeMs: now - 1 },
    ]);
    expect(changedFullPathsFromScan(result, now).sort()).toEqual([
      "/ws/just-before.ts",
      "/ws/same.ts",
    ]);
  });

  it("includes inventory paths missing from the last snapshot even with a stale mtime", () => {
    const now = 1_000_000;
    const result = scan([
      { relativePath: "known.ts", mtimeMs: now - 60_000 },
      { relativePath: "c.ts", mtimeMs: now - 60_000 },
    ]);
    expect(
      changedFullPathsFromScan(result, now, new Set(["known.ts"])),
    ).toEqual(["/ws/c.ts"]);
  });
});
