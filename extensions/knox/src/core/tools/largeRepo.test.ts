/**
 * P1-5 large repo run: a synthetic monorepo with hundreds of thousands of files.
 *
 * Opt in (it writes gigabytes of tiny files and takes minutes):
 *
 *   KNOX_LARGE_REPO_FILES=500000 npx vitest run --config src/core/vitest.config.ts tools/largeRepo
 *
 * Layout: packages/pkg-NNN/{src,test}/dir-N/file-N.ts plus, per package, a gitignored
 * `build/` and a `node_modules/` with many files. Only real source files count towards
 * the visible total; the ignored trees are extra weight the tools must skip cheaply.
 * Budgets are ceilings that catch an O(files) regression per call, not promises.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { countTokens } from "../llm/countTokens";
import generateRepoMap from "../util/generateRepoMap";

import type { IDE, ToolExtras } from "..";
import { globImpl, GLOB_MAX_WALK } from "./implementations/glob";
import { resolveRipgrepBinary, searchWorkspaceWithRipgrep } from "./ripgrep";

const FILES = Number(process.env.KNOX_LARGE_REPO_FILES) || 0;
const suite = FILES > 0 ? describe : describe.skip;

const PER_DIR = 100;
const DIRS_PER_PKG = 10;
const FILES_PER_PKG = PER_DIR * DIRS_PER_PKG;

let root = "";
const timings: Record<string, number | string> = {};

function toUri(p: string): string {
  return `file://${p}`;
}
function fromUri(u: string): string {
  return u.replace(/^file:\/\//, "");
}

function realIde(workspace: string): IDE {
  return {
    getWorkspaceDirs: vi.fn(async () => [toUri(workspace)]),
    getCurrentFile: vi.fn(async () => undefined),
    fileExists: vi.fn(async (uri: string) => fs.existsSync(fromUri(uri))),
    readFile: vi.fn(async (uri: string) => fs.readFileSync(fromUri(uri), "utf8")),
    getFileStats: vi.fn(async (uris: string[]) => {
      const out: Record<string, { size: number; lastModified: number }> = {};
      for (const uri of uris) {
        try {
          const st = fs.statSync(fromUri(uri));
          out[uri] = { size: st.size, lastModified: st.mtimeMs };
        } catch {
          // file vanished: ranking works without it
        }
      }
      return out;
    }),
    subprocess: vi.fn(async () => ["", ""] as [string, string]),
    listDir: vi.fn(async (uri: string) =>
      fs.readdirSync(fromUri(uri), { withFileTypes: true }).map(
        (d) => [d.name, d.isDirectory() ? 2 : 1] as [string, number],
      ),
    ),
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_glob" } } as ToolExtras["tool"],
  };
}

function seed(base: string, sourceFiles: number) {
  const packages = Math.ceil(sourceFiles / FILES_PER_PKG);
  fs.writeFileSync(path.join(base, ".gitignore"), "build/\n*.log\n");
  for (let p = 0; p < packages; p++) {
    const pkg = path.join(base, "packages", `pkg-${String(p).padStart(4, "0")}`);
    for (let d = 0; d < DIRS_PER_PKG; d++) {
      const dir = path.join(pkg, d % 2 === 0 ? "src" : "test", `dir-${d}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let f = 0; f < PER_DIR; f++) {
        const n = p * FILES_PER_PKG + d * PER_DIR + f;
        // One needle in the whole tree, deep in the last package.
        const body =
          n === sourceFiles - 7
            ? "export const NEEDLE_LARGE_REPO_ZZ = 1;\n"
            : `export const v${n} = ${n};\n`;
        fs.writeFileSync(path.join(dir, `file-${f}.ts`), body);
      }
    }
    // Ignored weight: ~10% extra files that must be skipped.
    const build = path.join(pkg, "build");
    const nm = path.join(pkg, "node_modules", "dep");
    fs.mkdirSync(build, { recursive: true });
    fs.mkdirSync(nm, { recursive: true });
    for (let f = 0; f < 50; f++) {
      fs.writeFileSync(path.join(build, `out-${f}.js`), "var NEEDLE_LARGE_REPO_ZZ = 2;\n");
      fs.writeFileSync(path.join(nm, `m-${f}.js`), "var NEEDLE_LARGE_REPO_ZZ = 3;\n");
    }
  }
}

suite(`large repo (${FILES} source files)`, () => {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-large-repo-"));
    const t0 = performance.now();
    seed(root, FILES);
    timings.seedMs = Math.round(performance.now() - t0);
  }, 3_600_000);

  afterAll(() => {
    fs.writeFileSync(
      path.join(os.tmpdir(), "knox-large-repo-report.json"),
      JSON.stringify({ files: FILES, walkCap: GLOB_MAX_WALK, ...timings }, null, 2),
    );
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }, 3_600_000);

  it("exact_search finds a single needle, honoring .gitignore, within budget", async () => {
    const rg = resolveRipgrepBinary();
    expect(rg, "ripgrep binary").toBeTruthy();
    const t0 = performance.now();
    const out = await searchWorkspaceWithRipgrep([root], "NEEDLE_LARGE_REPO_ZZ", {});
    timings.exactSearchMs = Math.round(performance.now() - t0);
    expect(out).toContain("NEEDLE_LARGE_REPO_ZZ = 1");
    // build/ is gitignored and node_modules is ignored by default: no hits from them.
    expect(out).not.toContain("= 2;");
    expect(out).not.toContain("= 3;");
    expect(timings.exactSearchMs as number).toBeLessThan(60_000);
  }, 120_000);

  it("glob with a narrow path is fast and exact", async () => {
    const ide = realIde(root);
    const t0 = performance.now();
    const out = await globImpl(
      { pattern: "**/file-5.ts", target_directory: "packages/pkg-0001", max_results: 50 },
      extras(ide),
    );
    timings.globNarrowMs = Math.round(performance.now() - t0);
    const text = out.map((o) => o.content).join("\n");
    expect(text).toMatch(/Found \d+ file/);
    expect(text).toContain("packages/pkg-0001");
    expect(text).not.toContain("walk cap");
    expect(timings.globNarrowMs as number).toBeLessThan(5_000);
  }, 60_000);

  it("glob over the whole workspace stops at the walk cap instead of hanging", async () => {
    const ide = realIde(root);
    const t0 = performance.now();
    const out = await globImpl(
      { pattern: "**/*.ts", max_results: 1_000_000 },
      extras(ide),
    );
    timings.globWholeMs = Math.round(performance.now() - t0);
    const text = out.map((o) => o.content).join("\n");
    timings.globWholeNote = text.split("\n")[0].slice(0, 160);
    if (FILES > GLOB_MAX_WALK) {
      expect(text).toContain("walk cap");
    }
    // The cap bounds the work: ~GLOB_MAX_WALK visits, nowhere near FILES.
    expect(timings.globWholeMs as number).toBeLessThan(60_000);
  }, 120_000);

  describe("repo map", () => {
    const llm = {
      model: "gpt-4o",
      contextLength: 200_000,
      countTokens: (t: string) => countTokens(t, "gpt-4o"),
    } as any;
    let globalDir = "";
    const savedGlobal = process.env.KNOX_GLOBAL_DIR;

    beforeAll(() => {
      globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-large-repo-global-"));
      process.env.KNOX_GLOBAL_DIR = globalDir;
    });
    afterAll(() => {
      if (savedGlobal === undefined) delete process.env.KNOX_GLOBAL_DIR;
      else process.env.KNOX_GLOBAL_DIR = savedGlobal;
      fs.rmSync(globalDir, { recursive: true, force: true });
    });

    const run = (opts: Record<string, unknown>) =>
      generateRepoMap(llm, realIde(root), {
        outputRelativeUriPaths: true,
        dirUris: [toUri(root)],
        ...opts,
      } as any);

    it("builds a bounded paths-only map, then serves it from cache", async () => {
      let t0 = performance.now();
      const cold = await run({ includeSignatures: false });
      timings.repoMapPathsColdMs = Math.round(performance.now() - t0);
      timings.repoMapPathsChars = cold.length;
      expect(cold.length).toBeGreaterThan(0);
      // Token budget is half the context window (4 chars/token is a loose upper bound).
      expect(countTokens(cold, "gpt-4o")).toBeLessThanOrEqual(llm.contextLength * 0.5 + 64);
      expect(cold).toContain("packages");

      t0 = performance.now();
      const warm = await run({ includeSignatures: false });
      timings.repoMapPathsWarmMs = Math.round(performance.now() - t0);
      expect(warm).toBe(cold);
      expect(timings.repoMapPathsColdMs as number).toBeLessThan(120_000);
    }, 300_000);

    it("builds a map with signatures for the hottest files only", async () => {
      const t0 = performance.now();
      const out = await run({ includeSignatures: true, skipCache: true });
      timings.repoMapSignaturesColdMs = Math.round(performance.now() - t0);
      expect(out).toContain("repository map");
      expect(timings.repoMapSignaturesColdMs as number).toBeLessThan(180_000);
    }, 300_000);

    it("zooming into one package is fast", async () => {
      const t0 = performance.now();
      const out = await run({
        includeSignatures: true,
        path: "packages/pkg-0001",
        skipCache: true,
      });
      timings.repoMapZoomMs = Math.round(performance.now() - t0);
      expect(out).toContain("file-");
      expect(timings.repoMapZoomMs as number).toBeLessThan(10_000);
    }, 120_000);
  });
});
