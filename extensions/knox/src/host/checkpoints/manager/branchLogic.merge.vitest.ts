import { describe, expect, it } from "vitest";

import {
    fileHasConflictMarkers,
    formatConflictMarkers,
    threeWayMergeText,
} from "./branchLogic";

describe("content three-way merge (CP-43)", () => {
  it("auto-resolves non-overlapping hunks", () => {
    const base = "keep\nshared\n";
    const ours = "keep-ours\nshared\n";
    const theirs = "keep\nshared-theirs\n";
    const merged = threeWayMergeText(base, ours, theirs);
    expect(merged).toEqual({ content: "keep-ours\nshared-theirs\n" });
  });

  it("conflicts when both sides change the same line", () => {
    const merged = threeWayMergeText("A0\n", "A-ours\n", "A-theirs\n");
    expect(merged).toEqual({ conflict: true });
  });

  it("writes and detects standard conflict markers", () => {
    const marked = formatConflictMarkers("ours\n", "theirs\n", "HEAD", "feature");
    expect(marked).toContain("<<<<<<< HEAD");
    expect(marked).toContain(">>>>>>> feature");
    expect(fileHasConflictMarkers(marked)).toBe(true);
    expect(fileHasConflictMarkers("plain\n")).toBe(false);
  });
});
