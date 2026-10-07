import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildRipgrepArgs,
  collectNestedKnoxIgnore,
  fileTypeToRipgrepFlags,
  mergeWorkspaceSearchResults,
  prefixGitignorePattern,
  resolveRipgrepBinary,
  resolveSearchMaxResults,
  resolveSearchRoots,
  runRipgrepSearch,
  summarizeSearchOutput,
  synthesizeNestedKnoxIgnore,
  SYSTEMS_SEARCH_MAX_RESULTS,
} from "./ripgrep";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const bundledRg =
  resolveRipgrepBinary() ??
  path.resolve(
    repoRoot,
    "extensions/vscode/node_modules/@vscode/ripgrep/bin/rg",
  );

describe("buildRipgrepArgs node_modules default", () => {
  const globs = (args: string[]) =>
    args.flatMap((a, i) => (args[i - 1] === "--glob" ? [a] : []));

  it("skips node_modules unless the path or glob targets it", () => {
    expect(globs(buildRipgrepArgs("x"))).toContain("!**/node_modules/**");
    expect(globs(buildRipgrepArgs("x", { path: "node_modules/foo" }))).not.toContain(
      "!**/node_modules/**",
    );
    expect(
      globs(buildRipgrepArgs("x", { fileGlob: "**/node_modules/foo/*.js" })),
    ).not.toContain("!**/node_modules/**");
  });

  it("puts the default before the user's glob so the user's glob wins", () => {
    const args = buildRipgrepArgs("x", { fileGlob: "*.ts" });
    const g = globs(args);
    expect(g.indexOf("!**/node_modules/**")).toBeLessThan(g.indexOf("*.ts"));
  });
});

describe("buildRipgrepArgs", () => {
  it("does not pass -I (that is --no-filename in ripgrep)", () => {
    const args = buildRipgrepArgs("exactSearchImpl");
    expect(args).not.toContain("-I");
    expect(args).toContain("-H");
    expect(args).toContain("--heading");
    expect(args).toContain("--line-number");
    expect(args).toContain("--no-config");
    expect(args).toContain("-e");
    expect(args).toContain("-F");
    expect(args[args.indexOf("-e") + 1]).toBe("exactSearchImpl");
    expect(args[args.indexOf("--") + 1]).toBe(".");
  });

  it("treats queries with regex metacharacters as literals by default", () => {
    const snippet = "fn ui(&mut self,";
    const args = buildRipgrepArgs(snippet);
    expect(args).toContain("-F");
    expect(args).not.toContain("-P");
    expect(args[args.indexOf("-e") + 1]).toBe(snippet);
  });

  it("opts into regex with pcre2 or fixedStrings=false", () => {
    const pcre = buildRipgrepArgs("foo|bar", { pcre2: true });
    expect(pcre).toContain("-P");
    expect(pcre).not.toContain("-F");

    const rustRe = buildRipgrepArgs("foo|bar", { fixedStrings: false });
    expect(rustRe).not.toContain("-F");
    expect(rustRe).not.toContain("-P");
  });

  it("never passes both -F and -P", () => {
    const args = buildRipgrepArgs("TODO", {
      pcre2: true,
      fixedStrings: true,
    });
    expect(args).toContain("-F");
    expect(args).not.toContain("-P");
  });

  it("defaults to case-insensitive and 2 context lines", () => {
    const args = buildRipgrepArgs("foo");
    expect(args).toContain("-i");
    expect(args).toContain("-C");
    expect(args[args.indexOf("-C") + 1]).toBe("2");
    expect(args).toContain("--max-columns");
    expect(args).toContain("-m");
  });

  it("scopes to a path after --", () => {
    const args = buildRipgrepArgs("Game::new", { path: "src" });
    expect(args[args.indexOf("--") + 1]).toBe("src");
  });

  it("supports files_with_matches, excludes, multiline, and PCRE2", () => {
    const args = buildRipgrepArgs("TODO", {
      outputMode: "files_with_matches",
      excludeGlob: "dist/**",
      multiline: true,
      hidden: true,
      pcre2: true,
      fixedStrings: false,
    });
    expect(args).toContain("-l");
    expect(args).not.toContain("--heading");
    expect(args).toContain("--glob");
    expect(args).toContain("!dist/**");
    expect(args).toContain("-U");
    expect(args).toContain("--hidden");
    expect(args).toContain("-P");
    expect(args).not.toContain("-F");
  });

  it("uses -B/-A when split context is set", () => {
    const args = buildRipgrepArgs("foo", { beforeContext: 1, afterContext: 4 });
    expect(args).toContain("-B");
    expect(args[args.indexOf("-B") + 1]).toBe("1");
    expect(args).toContain("-A");
    expect(args[args.indexOf("-A") + 1]).toBe("4");
    expect(args).not.toContain("-C");
  });

  it("maps unknown file types to a glob and aliases rs/tsx", () => {
    expect(fileTypeToRipgrepFlags("foo")).toEqual(["--glob", "*.foo"]);
    expect(fileTypeToRipgrepFlags("vue")).toEqual(["--type", "vue"]);
    expect(fileTypeToRipgrepFlags("ts")).toEqual(["--type", "ts"]);
    expect(fileTypeToRipgrepFlags("rs")).toEqual(["--type", "rust"]);
    expect(fileTypeToRipgrepFlags("tsx")).toEqual(["--type", "ts"]);
    expect(fileTypeToRipgrepFlags("yml")).toEqual(["--type", "yaml"]);
    expect(fileTypeToRipgrepFlags("s")).toEqual(["--type", "asm"]);
  });
});

describe("summarizeSearchOutput / mergeWorkspaceSearchResults", () => {
  const sample = [
    "./core/tools/callTool.ts",
    "13-import { applyPatchImpl } from \"./implementations/applyPatch\";",
    "14:import { exactSearchImpl } from \"./implementations/exactSearch\";",
    "15-import { globImpl } from \"./implementations/glob\";",
    "",
    "./core/tools/implementations/exactSearch.ts",
    "14:export const exactSearchImpl: ToolImpl = async (args, extras) => {",
  ].join("\n");

  it("counts files and match lines from --heading output", () => {
    expect(summarizeSearchOutput(sample)).toEqual({
      fileCount: 2,
      matchCount: 2,
    });
  });

  it("summarizes files_with_matches and count modes", () => {
    expect(
      summarizeSearchOutput("./a.ts\n./b.ts", "files_with_matches"),
    ).toEqual({ fileCount: 2, matchCount: 2 });
    expect(summarizeSearchOutput("./a.ts:3\n./b.ts:1", "count")).toEqual({
      fileCount: 2,
      matchCount: 4,
    });
  });

  it("drops empty-root 'No matches found' when another root hit", () => {
    const merged = mergeWorkspaceSearchResults(
      [sample, "No matches found"],
      50,
    );
    expect(merged).toContain("./core/tools/callTool.ts");
    expect(merged).not.toContain("No matches found");
  });

  it("enforces a total match cap (rg -m is per-file)", () => {
    const merged = mergeWorkspaceSearchResults([sample], 1);
    expect(merged).toContain("truncated; pass maxResults/path/fileType");
    expect(merged).toContain("./core/tools/callTool.ts");
    expect(merged).not.toContain("exactSearch.ts");
  });

  it("applies offset before the cap", () => {
    const merged = mergeWorkspaceSearchResults([sample], 1, { offset: 1 });
    expect(merged).toContain("exactSearch.ts");
    expect(merged).not.toContain("callTool.ts");
  });

  it("uses 200 as the systems default maxResults", () => {
    expect(resolveSearchMaxResults(undefined, false)).toBe(50);
    expect(resolveSearchMaxResults(undefined, true)).toBe(
      SYSTEMS_SEARCH_MAX_RESULTS,
    );
    expect(resolveSearchMaxResults(12, true)).toBe(12);
  });
});

describe("resolveSearchRoots", () => {
  it("strips a workspace folder prefix", () => {
    const prefixed = `${path.basename(repoRoot)}/core/tools/ripgrep.ts`;
    const roots = resolveSearchRoots([repoRoot], prefixed);
    expect(roots).not.toHaveProperty("error");
    if ("error" in roots) {
      return;
    }
    expect(roots[0]?.searchPath.replace(/\\/g, "/")).toBe(
      "core/tools/ripgrep.ts",
    );
  });

  it("returns a path-not-found error", () => {
    const roots = resolveSearchRoots([repoRoot], "no/such/dir/here");
    expect(roots).toEqual({
      error: "Search error: path not found: no/such/dir/here",
    });
  });

  it("strips a leading > from the search path", () => {
    const roots = resolveSearchRoots([repoRoot], ">core/tools/ripgrep.ts");
    expect(roots).not.toHaveProperty("error");
    if ("error" in roots) {
      return;
    }
    expect(roots[0]?.searchPath.replace(/\\/g, "/")).toBe(
      "core/tools/ripgrep.ts",
    );
  });
});

describe("bundled ripgrep", () => {
  const rg = existsSync(bundledRg) ? bundledRg : null;

  it("is ripgrep 15.x or newer with PCRE2", function () {
    if (!rg) {
      return;
    }
    const result = spawnSync(rg, ["--version"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ripgrep (1[5-9]|[2-9]\d)\./);
    expect(result.stdout).toMatch(/\+pcre2/);
  });

  it("prints file headings when run with our argv", function () {
    if (!rg) {
      return;
    }
    const args = buildRipgrepArgs("exactSearchImpl", {
      contextLines: 0,
      fileGlob: "core/tools/**/*.ts",
    });
    const result = spawnSync(rg, args, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^\.\/core\/tools\//m);
    expect(result.stdout).toMatch(/^\d+:/m);
    expect(summarizeSearchOutput(result.stdout).fileCount).toBeGreaterThan(0);
    expect(summarizeSearchOutput(result.stdout).matchCount).toBeGreaterThan(0);
  });

  it("finds a literal snippet that would be an invalid regex", function () {
    if (!rg) {
      return;
    }
    // Unclosed '(' is the Exact Search failure mode (rust-regex: unclosed group).
    const snippet = "export function buildRipgrepArgs(";
    const regexArgs = buildRipgrepArgs(snippet, {
      contextLines: 0,
      fileGlob: "core/tools/ripgrep.ts",
      fixedStrings: false,
    });
    const regexResult = spawnSync(rg, regexArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(regexResult.status).toBe(2);
    expect(regexResult.stderr).toMatch(/regex parse error|unclosed group/i);

    const literalArgs = buildRipgrepArgs(snippet, {
      contextLines: 0,
      fileGlob: "core/tools/ripgrep.ts",
    });
    expect(literalArgs).toContain("-F");
    const literalResult = spawnSync(rg, literalArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(literalResult.status, literalResult.stderr).toBe(0);
    expect(literalResult.stdout).toContain(snippet);
  });

  it("returns exit 1 with no matches", function () {
    if (!rg) {
      return;
    }
    const args = buildRipgrepArgs("zzz_knox_no_such_token_xyz", {
      contextLines: 0,
      fileGlob: "core/tools/builtIn.ts",
    });
    const result = spawnSync(rg, args, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).toBe(1);
  });

  it("accepts --type rust for .rs files (not --type rs)", function () {
    if (!rg) {
      return;
    }
    const rustType = spawnSync(rg, ["--type-list"], { encoding: "utf8" });
    expect(rustType.stdout).toMatch(/^rust:/m);
    expect(rustType.stdout).not.toMatch(/^rs:/m);
    const bad = spawnSync(rg, ["--type", "rs", "-e", "fn", "--", "."], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(bad.status).toBe(2);
  });
});

describe("runRipgrepSearch ignore + limits", () => {
  const rg = resolveRipgrepBinary();
  const withTree = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "knox-rg-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.skipIf(!rg)("honors .gitignore (no git repo) and .knoxignore", async () => {
    await withTree(async (dir) => {
      mkdirSync(path.join(dir, "gen"));
      mkdirSync(path.join(dir, "secret"));
      writeFileSync(path.join(dir, ".gitignore"), "gen/\n");
      writeFileSync(path.join(dir, ".knoxignore"), "secret/\n");
      writeFileSync(path.join(dir, "gen", "a.txt"), "NEEDLE\n");
      writeFileSync(path.join(dir, "secret", "b.txt"), "NEEDLE\n");
      writeFileSync(path.join(dir, "keep.txt"), "NEEDLE\n");
      const out = await runRipgrepSearch(rg!, dir, "NEEDLE", {
        outputMode: "files_with_matches",
      });
      expect(out).toContain("keep.txt");
      expect(out).not.toContain("gen/a.txt");
      expect(out).not.toContain("secret/b.txt");
    });
  });

  it.skipIf(!rg)("honors nested .knoxignore relative to that directory", async () => {
    await withTree(async (dir) => {
      mkdirSync(path.join(dir, "pkg", "secret"), { recursive: true });
      mkdirSync(path.join(dir, "other", "secret"), { recursive: true });
      writeFileSync(path.join(dir, "pkg", ".knoxignore"), "secret/\n");
      writeFileSync(path.join(dir, "pkg", "secret", "b.txt"), "NEEDLE\n");
      writeFileSync(path.join(dir, "other", "secret", "c.txt"), "NEEDLE\n");
      writeFileSync(path.join(dir, "keep.txt"), "NEEDLE\n");
      const out = await runRipgrepSearch(rg!, dir, "NEEDLE", {
        outputMode: "files_with_matches",
      });
      expect(out).toContain("keep.txt");
      expect(out).toContain("other/secret/c.txt");
      expect(out).not.toContain("pkg/secret/b.txt");
    });
  });

  it.skipIf(!rg)("searches a 20k-file tree quickly", async () => {
    await withTree(async (dir) => {
      for (let d = 0; d < 200; d++) {
        const sub = path.join(dir, `pkg${d}`);
        mkdirSync(sub);
        for (let f = 0; f < 100; f++) {
          writeFileSync(path.join(sub, `f${f}.ts`), f === 7 && d === 150 ? "TARGET\n" : "x\n");
        }
      }
      const started = Date.now();
      const out = await runRipgrepSearch(rg!, dir, "TARGET", {});
      expect(out).toContain("pkg150/f7.ts");
      expect(Date.now() - started).toBeLessThan(10_000);
    });
  });

  it.skipIf(!rg)("stops with a partial-result notice on timeout", async () => {
    await withTree(async (dir) => {
      writeFileSync(path.join(dir, "a.txt"), "hello\n".repeat(10));
      const prev = process.env.KNOX_SEARCH_TIMEOUT_MS;
      process.env.KNOX_SEARCH_TIMEOUT_MS = "1";
      try {
        // rg process startup alone outlasts a 1 ms budget.
        writeFileSync(path.join(dir, "big.txt"), "a".repeat(5_000_000) + "\n");
        const out = await runRipgrepSearch(rg!, dir, "(a+)+$", { pcre2: true, fixedStrings: false });
        expect(out).toContain("search stopped: timed out");
      } finally {
        if (prev === undefined) delete process.env.KNOX_SEARCH_TIMEOUT_MS;
        else process.env.KNOX_SEARCH_TIMEOUT_MS = prev;
      }
    });
  });
});

describe("nested .knoxignore prefixing", () => {
  it("prefixes gitignore patterns relative to the nested directory", () => {
    expect(prefixGitignorePattern("pkg", "secret/")).toBe("pkg/secret/");
    expect(prefixGitignorePattern("pkg", "*.log")).toBe("pkg/**/*.log");
    expect(prefixGitignorePattern("pkg", "/exact")).toBe("pkg/exact");
    expect(prefixGitignorePattern("pkg", "!keep.txt")).toBe("!pkg/**/keep.txt");
    expect(prefixGitignorePattern("pkg", "# comment")).toBeNull();
    expect(prefixGitignorePattern("pkg", "")).toBeNull();
  });

  it("synthesizes nested ignore files and skips comments", () => {
    const text = synthesizeNestedKnoxIgnore([
      { relDir: "pkg", content: "secret/\n*.tmp\n# x\n" },
    ]);
    expect(text).toContain("pkg/secret/");
    expect(text).toContain("pkg/**/*.tmp");
    expect(text).not.toContain("# x");
  });

  it("collects nested .knoxignore and not the root file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "knox-nested-ig-"));
    try {
      mkdirSync(path.join(dir, "pkg"), { recursive: true });
      writeFileSync(path.join(dir, ".knoxignore"), "root-secret/\n");
      writeFileSync(path.join(dir, "pkg", ".knoxignore"), "secret/\n");
      const nested = collectNestedKnoxIgnore(dir);
      expect(nested).toEqual([{ relDir: "pkg", content: "secret/\n" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
