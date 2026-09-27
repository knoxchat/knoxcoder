import { describe, expect, it } from "vitest";

import {
  GitModelStatus,
  formatGitStatusPorcelain,
} from "./gitStatusFromModel";

describe("formatGitStatusPorcelain (KN-130)", () => {
  it("prints branch, staged, unstaged, and untracked", () => {
    const text = formatGitStatusPorcelain({
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      indexChanges: [
        { path: "staged.ts", status: GitModelStatus.INDEX_MODIFIED },
      ],
      workingTreeChanges: [
        { path: "unstaged.ts", status: GitModelStatus.MODIFIED },
        { path: "new.ts", status: GitModelStatus.UNTRACKED },
      ],
    });
    expect(text).toBe(
      [
        "## main...origin/main [ahead 1]",
        "?? new.ts",
        "M  staged.ts",
        " M unstaged.ts",
      ].join("\n"),
    );
  });

  it("combines index + worktree on the same path", () => {
    const text = formatGitStatusPorcelain({
      branch: "topic",
      indexChanges: [{ path: "a.ts", status: GitModelStatus.INDEX_MODIFIED }],
      workingTreeChanges: [{ path: "a.ts", status: GitModelStatus.MODIFIED }],
    });
    expect(text).toContain("MM a.ts");
  });
});
