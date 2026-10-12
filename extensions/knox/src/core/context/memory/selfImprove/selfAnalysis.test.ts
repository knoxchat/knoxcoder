import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseGitLog, runSelfAnalysis } from "./selfAnalysis";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("self analysis (MC-48)", () => {
  it("parses git log into per-commit churn limited to the scanned dirs", () => {
    const log = ["@@aaa111", "extensions/knox/src/a.ts", "docs/other.md", "", "@@bbb222", "docs/other.md", "", "@@ccc333", "extensions/knox/package-lock.json", "extensions/knox/src/a.ts"].join("\n");
    const churn = parseGitLog(log, ["extensions/knox/"]);
    expect(churn).toEqual([
      { checkpointId: "aaa111", changedPaths: ["extensions/knox/src/a.ts"] },
      { checkpointId: "ccc333", changedPaths: ["extensions/knox/src/a.ts"] },
    ]);
  });

  it("writes one dated report under outDir with hot files, markers and no tuning when no history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-selfan-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "pkg", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "knox", dependencies: { a: "1" } }));
    fs.writeFileSync(path.join(root, "pkg", "src", "x.ts"), "// TODO one\n// FIXME two\n");
    const file = runSelfAnalysis({
      repoRoot: root,
      scanDirs: ["pkg"],
      packageDir: path.join(root, "pkg"),
      outDir: path.join(root, "pkg", "docs", "self-improve"),
      gitLog: "@@a1\npkg/src/x.ts\n@@a2\npkg/src/x.ts\n",
      baseline: { recallAtK: 1, precision: 1, falseInjectRate: 0, tokensMean: 10 },
      now: new Date("2026-10-13T00:00:00Z"),
    });
    expect(path.basename(file)).toBe("2026-10-13-self-improve.md");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("# Project health: knox");
    expect(text).toContain("`pkg/src/x.ts`: 2 checkpoints");
    expect(text).toContain("1 TODO, 1 FIXME");
    expect(text).toContain("falseInjectRate 0");
    expect(text).toContain("No recorded history was supplied");
    expect(text).not.toContain(root);
  });
});
