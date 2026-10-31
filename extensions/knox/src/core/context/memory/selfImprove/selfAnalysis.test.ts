import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseGitLog, runSelfAnalysis } from "./selfAnalysis";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function attributionHistory() {
  return Array.from({ length: 10 }, (_, i) => ({
    injected: 1,
    cited: i < 3 ? 1 : 0,
    helpful: i < 3 ? 1 : null,
    channel: i === 0 ? "lexical" : i === 1 ? "graph" : "lexical",
  }));
}

describe("self analysis (MC-48 / MEM-43)", () => {
  it("parses git log into per-commit churn limited to the scanned dirs", () => {
    const log = ["@@aaa111", "extensions/knox/src/a.ts", "docs/other.md", "", "@@bbb222", "docs/other.md", "", "@@ccc333", "extensions/knox/package-lock.json", "extensions/knox/src/a.ts"].join("\n");
    const churn = parseGitLog(log, ["extensions/knox/"]);
    expect(churn).toEqual([
      { commitId: "aaa111", changedPaths: ["extensions/knox/src/a.ts"] },
      { commitId: "ccc333", changedPaths: ["extensions/knox/src/a.ts"] },
    ]);
  });

  it("writes one dated report under outDir with theorem numbers and commit churn, not checkpoints", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-selfan-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "pkg", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "knox", dependencies: { a: "1" } }));
    fs.writeFileSync(path.join(root, "pkg", "src", "x.ts"), "// TODO one\n// FIXME two\n");
    const file = await runSelfAnalysis({
      repoRoot: root,
      scanDirs: ["pkg"],
      packageDir: path.join(root, "pkg"),
      outDir: path.join(root, "pkg", "docs", "self-improve"),
      gitLog: "@@a1\npkg/src/x.ts\n@@a2\npkg/src/x.ts\n",
      baseline: {
        recallAtK: 1,
        precision: 1,
        falseInjectRate: 0,
        tokensMean: 10,
        sigma: 1,
        epsilon_b: null,
        epsilon_b_note: "n/a — flat FTS",
        epsilon_s: 0,
        theorem_held: false,
      },
      now: new Date("2026-10-13T00:00:00Z"),
    });
    expect(path.basename(file)).toBe("2026-10-13-self-improve.md");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("# Project health: knox");
    expect(text).toContain("## Theorem");
    expect(text).toContain("Rec vs N: not published");
    expect(text).toContain("false-inject: 0");
    expect(text).toContain("attribution coverage: not collected");
    expect(text).toContain("recipe wrongApplyRate: not collected");
    expect(text).toContain("`pkg/src/x.ts`: 2 commits");
    expect(text).toContain("## Hot files (commit churn)");
    expect(text).toContain("1 TODO, 1 FIXME");
    expect(text).toContain("falseInjectRate 0");
    expect(text).toContain("n/a — flat FTS");
    expect(text).toContain("theorem_held false");
    expect(text).toContain("No recorded history or brain_attribution log was supplied");
    expect(text).toContain("Not collected");
    expect(text).not.toContain("checkpoint");
    expect(text).not.toContain(root);
  });

  it("reports Rec vs N, ε_S, attribution coverage, wrongApplyRate, and fits θ / w_s", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-selfan-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "knox" }));
    const file = await runSelfAnalysis({
      repoRoot: root,
      scanDirs: ["pkg"],
      packageDir: path.join(root, "pkg"),
      outDir: path.join(root, "pkg", "docs", "self-improve"),
      gitLog: "",
      now: new Date("2026-10-31T00:00:00Z"),
      baseline: {
        recallAtK: 1,
        precision: 0.5,
        falseInjectRate: 0.12,
        tokensMean: 20,
        epsilon_s: 0.2,
        theorem_held: false,
      },
      theoremErrors: {
        sigma: 0.2,
        epsilon_b: 0.05,
        epsilon_s: 0.2,
        theorem_held: true,
        points: [
          { n: 1000, rec: 0.9 },
          { n: 10000, rec: 0.85 },
        ],
      },
      history: { attribution: attributionHistory() },
      recipes: {
        verified: 2,
        candidate: 1,
        quarantined: 1,
        unlinkedVerified: 1,
        wrongReuse: 3,
        replays: 6,
        wrongApplyRate: 0.5,
        skips: 4,
        skipReasons: { no_oracle: 3 },
        nearMisses: 2,
      },
    });
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("N=1000 Rec=0.9");
    expect(text).toContain("N=10000 Rec=0.85");
    expect(text).toContain("ε_S 0.2");
    expect(text).toContain("false-inject: 0.12");
    expect(text).toContain("attribution coverage: 30% (3/10 injects have an outcome)");
    expect(text).toContain("recipe wrongApplyRate: 0.5");
    expect(text).toContain("`retrieval.theta`");
    expect(text).toContain("`fusion.channelWeights`");
    expect(text).toContain("wrongApplyRate 0.5");
    expect(text).not.toContain("checkpoint");
  });

  it("writes live recipe stats when they are supplied", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-selfan-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "knox" }));
    const file = await runSelfAnalysis({
      repoRoot: root,
      scanDirs: ["pkg"],
      packageDir: path.join(root, "pkg"),
      outDir: path.join(root, "pkg", "docs", "self-improve"),
      gitLog: "",
      now: new Date("2026-10-28T00:00:00Z"),
      recipes: {
        verified: 2,
        candidate: 1,
        quarantined: 1,
        unlinkedVerified: 1,
        wrongReuse: 3,
        replays: 6,
        wrongApplyRate: 0.5,
        skips: 4,
        skipReasons: { no_oracle: 3 },
        nearMisses: 2,
      },
    });
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("Verified: 2");
    expect(text).toContain("Unlinked verified");
    expect(text).toContain("no_oracle 3");
    expect(text).toContain("wrongApplyRate 0.5");
    expect(text).not.toContain("Not collected");
  });
});
