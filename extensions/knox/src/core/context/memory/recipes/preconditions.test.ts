import { describe, expect, it } from "vitest";
import {
  checkPreconditions,
  deriveEnvironmentPreconditions,
  derivePreconditions,
  isSafeRelPath,
  type PreconditionEnv,
} from "./preconditions.js";

function env(files: Record<string, string>, dirty: string[] | null = []): PreconditionEnv {
  return {
    rootEntries: async () => [...new Set(Object.keys(files).map((f) => f.split("/")[0]))],
    readText: async (p) => files[p],
    exists: async (p) => p in files || Object.keys(files).some((f) => f.startsWith(p + "/")),
    dirtyPaths: async (paths) => (dirty === null ? undefined : paths.filter((p) => dirty.includes(p))),
  };
}

const REACT_TS = {
  "package.json": JSON.stringify({ dependencies: { react: "^18", axios: "1" }, devDependencies: { vitest: "1" } }),
  "tsconfig.json": "{}",
  "src/App.tsx": "x",
};

describe("checkPreconditions (MC-22)", () => {
  it("passes when everything holds", async () => {
    const r = await checkPreconditions(
      [
        { kind: "file_exists", value: "src/App.tsx" },
        { kind: "file_absent", value: "src/Button.tsx" },
        { kind: "language", value: "typescript" },
        { kind: "framework", value: "react" },
        { kind: "dependency", value: "axios" },
        { kind: "clean_paths", value: "src/App.tsx" },
      ],
      env(REACT_TS),
    );
    expect(r).toEqual({ ok: true, failures: [], summary: "" });
  });

  it("refuses each failed precondition with a clear reason", async () => {
    const cases: [string, string, RegExp][] = [
      ["file_exists", "src/Missing.tsx", /does not exist/],
      ["file_absent", "src/App.tsx", /would be overwritten/],
      ["language", "rust", /not a rust project/],
      ["framework", "vue", /vue not detected/],
      ["dependency", "lodash", /lodash is not declared/],
      ["clean_paths", "src/App.tsx", /uncommitted changes/],
      ["mystery", "x", /unknown precondition kind/],
    ];
    for (const [kind, value, re] of cases) {
      const r = await checkPreconditions([{ kind, value }], env(REACT_TS, ["src/App.tsx"]));
      expect(r.ok, kind).toBe(false);
      expect(r.failures[0].reason, kind).toMatch(re);
      expect(r.summary).toMatch(/^Replay refused: /);
    }
  });

  it("reports every failure, not just the first", async () => {
    const r = await checkPreconditions(
      [{ kind: "language", value: "go" }, { kind: "dependency", value: "nope" }],
      env(REACT_TS),
    );
    expect(r.failures).toHaveLength(2);
  });

  it("reads deps from Cargo.toml, devDependencies and pyproject; detects cargo", async () => {
    const files = {
      "Cargo.toml": '[package]\nname="a"\n[dependencies]\nserde = "1"\n[dev-dependencies.tempfile]\nversion="3"\n',
      "pyproject.toml": 'dependencies = ["requests>=2", "flask"]',
    };
    const r = await checkPreconditions(
      [
        { kind: "dependency", value: "serde" },
        { kind: "dependency", value: "tempfile" },
        { kind: "dependency", value: "requests" },
        { kind: "framework", value: "cargo" },
        { kind: "language", value: "rust" },
        { kind: "language", value: "python" },
      ],
      env(files),
    );
    expect(r.failures).toEqual([]);
    expect((await checkPreconditions([{ kind: "dependency", value: "vitest" }], env(REACT_TS))).ok).toBe(true);
  });

  it("typescript projects satisfy a javascript precondition", async () => {
    expect((await checkPreconditions([{ kind: "language", value: "javascript" }], env(REACT_TS))).ok).toBe(true);
  });

  it("rejects unsafe paths without touching the filesystem", async () => {
    let touched = false;
    const e = { ...env({}), exists: async () => ((touched = true), true) };
    for (const value of ["../secret", "/etc/passwd", "~/x", "C:/x", "a/../../b", "a\\b"]) {
      const r = await checkPreconditions([{ kind: "file_exists", value }], e);
      expect(r.failures[0].reason).toMatch(/not a safe/);
    }
    expect(touched).toBe(false);
    expect(isSafeRelPath("src/a.ts")).toBe(true);
  });

  it("fails closed when git state is unknown or the env throws", async () => {
    const unknown = await checkPreconditions([{ kind: "clean_paths", value: "a.ts" }], env({ "a.ts": "" }, null));
    expect(unknown.failures[0].reason).toMatch(/could not determine git state/);
    const boom = { ...env({}), exists: async () => { throw new Error("EIO"); } };
    const r = await checkPreconditions([{ kind: "file_exists", value: "a.ts" }], boom);
    expect(r.failures[0].reason).toMatch(/EIO/);
  });

  it("derivePreconditions covers modified, created and deleted files without duplicates", () => {
    const pre = derivePreconditions([
      { kind: "write_file", path: "src/new.ts", blobHash: "a" },
      { kind: "write_file", path: "src/old.ts", blobHash: "b", baseBlobHash: "c" },
      { kind: "delete_file", path: "src/gone.ts" },
      { kind: "write_file", path: "src/new.ts", blobHash: "a" },
      { kind: "command", command: "npm i" },
    ]);
    expect(pre).toEqual([
      { kind: "file_absent", value: "src/new.ts" },
      { kind: "clean_paths", value: "src/new.ts" },
      { kind: "file_exists", value: "src/old.ts" },
      { kind: "clean_paths", value: "src/old.ts" },
      { kind: "file_exists", value: "src/gone.ts" },
      { kind: "clean_paths", value: "src/gone.ts" },
    ]);
  });

  it("deriveEnvironmentPreconditions records the specific language and frameworks, not every npm dep", async () => {
    const pre = await deriveEnvironmentPreconditions(env(REACT_TS));
    expect(pre).toContainEqual({ kind: "language", value: "typescript" });
    expect(pre.some((p) => p.kind === "language" && p.value === "javascript")).toBe(false);
    expect(pre).toContainEqual({ kind: "framework", value: "react" });
    expect(pre.some((p) => p.kind === "dependency")).toBe(false);
  });
});
