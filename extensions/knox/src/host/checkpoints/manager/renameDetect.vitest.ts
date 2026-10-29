import { describe, expect, it } from "vitest";

import {
  applyLineageMatches,
  annotateSnapshotsFromParentIndex,
  collapseDiffByLineage,
  contentSimilarity,
  detectRenamesAndCopies,
} from "./renameDetect";
import type { CheckpointFileDiff, FileSnapshot } from "./types";
import { uniqueFileVersionsFollowingRenames } from "./fileHistory";

function file(relativePath: string, extra: Partial<FileSnapshot> = {}): FileSnapshot {
  return {
    relativePath,
    encoding: "utf8",
    lastModified: new Date("2026-10-29T00:00:00.000Z"),
    size: extra.content?.length ?? extra.size ?? 0,
    ...extra,
  };
}

function diff(
  relativePath: string,
  status: CheckpointFileDiff["status"],
  extra: Partial<CheckpointFileDiff> = {},
): CheckpointFileDiff {
  return {
    relativePath,
    status,
    oldContent: extra.oldContent ?? (status === "added" ? null : "old"),
    newContent: extra.newContent ?? (status === "deleted" ? null : "new"),
    ...extra,
  };
}

describe("rename / copy detection (CP-40)", () => {
  it("scores identical text as 1 and diverged text below the git default", () => {
    expect(contentSimilarity("alpha\nbeta\n", "alpha\nbeta\n")).toBe(1);
    expect(contentSimilarity("alpha\nbeta\n", "alpha\ngamma\n")).toBeGreaterThan(0.4);
    expect(contentSimilarity("alpha\nbeta\n", "zzzz\nyyyy\n")).toBeLessThan(0.6);
  });

  it("treats the same hash as a rename at score 100", () => {
    const matches = detectRenamesAndCopies(
      [{ relativePath: "b.ts", hash: "abc" }],
      [{ relativePath: "a.ts", hash: "abc" }],
    );
    expect(matches).toEqual([{ kind: "rename", from: "a.ts", to: "b.ts", score: 100 }]);
  });

  it("treats a surviving same-hash file as a copy", () => {
    const matches = detectRenamesAndCopies(
      [{ relativePath: "b.ts", hash: "abc" }],
      [],
      [{ relativePath: "a.ts", hash: "abc" }],
    );
    expect(matches).toEqual([{ kind: "copy", from: "a.ts", to: "b.ts", score: 100 }]);
  });

  it("pairs a second same-hash dest as a copy after the rename is taken", () => {
    const matches = detectRenamesAndCopies(
      [{ relativePath: "b.ts", hash: "abc" }, { relativePath: "c.ts", hash: "abc" }],
      [{ relativePath: "a.ts", hash: "abc" }],
    );
    expect(matches).toEqual([
      { kind: "rename", from: "a.ts", to: "b.ts", score: 100 },
      { kind: "copy", from: "a.ts", to: "c.ts", score: 100 },
    ]);
  });

  it("matches similar text under the 60% threshold", () => {
    const before = "one\ntwo\nthree\nfour\nfive\nsix\n";
    const after = "one\ntwo\nTHREE\nfour\nfive\nsix\n";
    const matches = detectRenamesAndCopies(
      [{ relativePath: "b.ts", content: after }],
      [{ relativePath: "a.ts", content: before }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("rename");
    expect(matches[0].from).toBe("a.ts");
    expect(matches[0].to).toBe("b.ts");
    expect(matches[0].score).toBeGreaterThanOrEqual(60);
  });

  it("does not pair unrelated text", () => {
    const matches = detectRenamesAndCopies(
      [{ relativePath: "b.ts", content: "export const b = 1;\n" }],
      [{ relativePath: "a.ts", content: "fn totally_different() {}\n" }],
    );
    expect(matches).toEqual([]);
  });

  it("annotates child snapshots from the parent hash index", async () => {
    const parent = new Map([["a.ts", "hash-a"], ["keep.ts", "hash-k"]]);
    const snapshots = [
      file("a.ts", { deleted: true, changeType: "deleted", hash: "hash-a" }),
      file("b.ts", { changeType: "created", hash: "hash-a", content: "same" }),
      file("copy.ts", { changeType: "created", hash: "hash-k", content: "keep" }),
    ];
    const annotated = await annotateSnapshotsFromParentIndex(snapshots, parent);
    expect(annotated.find((s) => s.relativePath === "b.ts")?.renamedFrom).toBe("a.ts");
    expect(annotated.find((s) => s.relativePath === "copy.ts")?.copiedFrom).toBe("keep.ts");
    expect(applyLineageMatches(snapshots, []).every((s) => !s.renamedFrom || s.relativePath === "b.ts")).toBe(true);
  });

  it("collapses add+delete into one renamed diff entry", () => {
    const files = collapseDiffByLineage(
      [
        diff("a.ts", "deleted", { oldContent: "hello", newContent: null }),
        diff("b.ts", "added", { oldContent: null, newContent: "hello" }),
        diff("c.ts", "modified", { oldContent: "x", newContent: "y" }),
      ],
      [file("b.ts", { changeType: "created", renamedFrom: "a.ts", content: "hello" })],
    );
    expect(files.map((file) => [file.relativePath, file.status, file.oldPath])).toEqual([
      ["b.ts", "renamed", "a.ts"],
      ["c.ts", "modified", undefined],
    ]);
    expect(files[0].oldContent).toBe("hello");
    expect(files[0].newContent).toBe("hello");
  });

  it("follows renamedFrom then hash fallback in file history", () => {
    const versions = uniqueFileVersionsFollowingRenames(
      [
        {
          info: { id: "cp1", description: "a v1", created: new Date("2026-01-01T00:00:00.000Z") },
          snapshots: [file("a.ts", { hash: "h1", changeType: "created" })],
        },
        {
          info: { id: "cp2", description: "rename", created: new Date("2026-01-02T00:00:00.000Z") },
          snapshots: [
            file("a.ts", { deleted: true, changeType: "deleted", hash: "h1" }),
            file("b.ts", { hash: "h1", changeType: "created", renamedFrom: "a.ts" }),
          ],
        },
        {
          info: { id: "cp3", description: "b v2", created: new Date("2026-01-03T00:00:00.000Z") },
          snapshots: [file("b.ts", { hash: "h2", changeType: "modified" })],
        },
      ],
      "b.ts",
    );
    expect(versions.map((version) => [version.checkpointId, version.relativePath, version.hash])).toEqual([
      ["cp1", "a.ts", "h1"],
      ["cp3", "b.ts", "h2"],
    ]);
  });

  it("follows a hash-only rename when manifests omit renamedFrom", () => {
    const versions = uniqueFileVersionsFollowingRenames(
      [
        {
          info: { id: "cp1", description: "old", created: new Date("2026-01-01T00:00:00.000Z") },
          snapshots: [file("src/old.ts", { hash: "same", changeType: "created" })],
        },
        {
          info: { id: "cp2", description: "moved", created: new Date("2026-01-02T00:00:00.000Z") },
          snapshots: [
            file("src/old.ts", { deleted: true, changeType: "deleted" }),
            file("src/new.ts", { hash: "same", changeType: "created" }),
          ],
        },
      ],
      "src/new.ts",
    );
    expect(versions.map((version) => version.relativePath)).toEqual(["src/old.ts"]);
    expect(versions[0].checkpointId).toBe("cp1");
  });
});

describe("graph rename labels (CP-40)", () => {
  it("exposes dest → source on the graph node without snapshot bytes", async () => {
    const { renamedFromByPath } = await import("./listQuery");
    const { buildCheckpointGraph } = await import("./graphPayload");
    expect(renamedFromByPath([
      { relativePath: "b.ts", renamedFrom: "a.ts" },
      { relativePath: "c.ts" },
    ])).toEqual({ "b.ts": "a.ts" });

    const graph = buildCheckpointGraph({
      history: [{
        id: "cp_rename",
        description: "mv a to b",
        created: new Date("2026-08-17T12:00:00.000Z"),
        fileSnapshots: [{
          relativePath: "b.ts",
          renamedFrom: "a.ts",
          content: "SECRET_BYTES",
          encoding: "utf8",
          lastModified: new Date("2026-08-17T12:00:00.000Z"),
          size: 5,
        }],
      }],
      branches: [],
    });
    expect(graph.nodes[0]?.renamedFrom).toEqual({ "b.ts": "a.ts" });
    expect(graph.nodes[0]?.changedPaths).toEqual(["b.ts"]);
    expect(JSON.stringify(graph).includes("SECRET_BYTES")).toBe(false);
    expect(JSON.stringify(graph).includes("fileSnapshots")).toBe(false);
  });
});
