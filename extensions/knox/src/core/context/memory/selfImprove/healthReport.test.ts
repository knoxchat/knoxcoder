import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  buildHealthReport,
  findFlakyTests,
  findHotFiles,
  gatherHealthInputs,
  gatherRecipeHealth,
  parseNpmAudit,
  undocumentedIssues,
  writeHealthReport,
} from "./healthReport";

describe("health report (MC-43)", () => {
  it("flags a test as flaky only when it flips across sessions", () => {
    const flaky = findFlakyTests([
      { name: "a", passed: true, sessionId: "s1" },
      { name: "a", passed: false, sessionId: "s2" },
      { name: "b", passed: false, sessionId: "s1" },
      { name: "b", passed: false, sessionId: "s2" },
      { name: "c", passed: true, sessionId: "s1" },
      { name: "c", passed: false, sessionId: "s1" },
    ]);
    expect(flaky.map((f) => f.name)).toEqual(["a"]);
  });

  it("ranks hot files by commits touched, ignoring single changes", () => {
    const hot = findHotFiles([
      { commitId: "1", changedPaths: ["a.ts", "b.ts", "a.ts"] },
      { commitId: "2", changedPaths: ["a.ts"] },
      { commitId: "3", changedPaths: ["b.ts", "c.ts"] },
    ]);
    expect(hot).toEqual([
      { path: "a.ts", changes: 2 },
      { path: "b.ts", changes: 2 },
    ]);
  });

  it("finds undocumented issues", () => {
    const doc = "Known: sqlite lock contention under soak";
    expect(undocumentedIssues(["sqlite lock contention", "terminal hangs on windows"], doc)).toEqual(["terminal hangs on windows"]);
  });

  it("parses npm audit json", () => {
    const j = JSON.stringify({ metadata: { vulnerabilities: { high: 2, low: 1 } } });
    expect(parseNpmAudit(j)).toEqual({ critical: 0, high: 2, moderate: 0, low: 1 });
    expect(parseNpmAudit("nope")).toBeUndefined();
  });

  it("generates and writes a report for the eval fixture repo", () => {
    const fixture = path.join(__dirname, "../../../eval/fixtures/mini-c");
    const inputs = gatherHealthInputs(fixture, { generatedAt: "2026-10-13T00:00:00.000Z" });
    expect(inputs.scannedFiles).toBeGreaterThan(0);
    const md = buildHealthReport(inputs);
    for (const h of ["## Dependencies", "## Flaky tests", "## Hot files", "## TODO / FIXME density", "## Undocumented known issues", "## Recipes"]) {
      expect(md).toContain(h);
    }
    expect(md).toContain("Not collected");
    expect(md).toContain("## Hot files (commit churn)");
    expect(md).not.toMatch(/checkpoint/i);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-health-"));
    try {
      const file = writeHealthReport(md, path.join(dir, "reports"), "mini c!", new Date("2026-10-13T00:00:00Z"));
      expect(path.basename(file)).toBe("health-mini-c--2026-10-13.md");
      expect(fs.readFileSync(file, "utf8")).toBe(md);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes recipe capture skips, quarantines, wrong-reuse, and unlinked verified (P7.4)", () => {
    const recipes = gatherRecipeHealth(
      [
        { status: "verified", memoryId: 1, stats: { replays: 3, reverted: 0, failedVerify: 0 } },
        { status: "verified", stats: { replays: 1, reverted: 1, failedVerify: 0 } },
        { status: "quarantined", stats: { replays: 2, reverted: 0, failedVerify: 2 } },
        { status: "candidate", stats: { replays: 0, reverted: 0, failedVerify: 0 } },
      ],
      { skips: 4, skipReasons: { no_oracle: 3, secret_detected: 1 }, nearMisses: 2 },
    );
    expect(recipes).toMatchObject({
      verified: 2,
      candidate: 1,
      quarantined: 1,
      unlinkedVerified: 1,
      wrongReuse: 3,
      replays: 6,
      wrongApplyRate: 0.5,
      skips: 4,
      nearMisses: 2,
    });
    const md = buildHealthReport({
      projectName: "x",
      generatedAt: "t",
      dependencies: { runtime: 0, dev: 0 },
      testRuns: [],
      commitChurn: [],
      markers: [],
      scannedFiles: 0,
      scannedLines: 0,
      observedIssues: [],
      recipes,
    });
    expect(md).toContain("Unlinked verified");
    expect(md).toContain("no_oracle 3");
    expect(md).toContain("wrong-reuse");
    expect(md).toContain("wrongApplyRate 0.5");
  });

  it("counts markers and skips node_modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-health-"));
    try {
      fs.mkdirSync(path.join(dir, "node_modules"));
      fs.writeFileSync(path.join(dir, "node_modules", "x.js"), "// TODO a\n");
      fs.writeFileSync(path.join(dir, "a.ts"), "// TODO one\n// FIXME two\n");
      const i = gatherHealthInputs(dir);
      expect(i.markers).toEqual([{ file: "a.ts", todo: 1, fixme: 1 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
