import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextItem, IDE, ToolExtras } from "../..";
import { resetShellJobs } from "../shellJobs";
import { buildImpl } from "./build";

const hasBin = (bin: string, arg = "--version") =>
  spawnSync(bin, [arg], { encoding: "utf8" }).status === 0;

const here = path.dirname(fileURLToPath(import.meta.url));
/** extensions/knox/node_modules provides a real vitest for the e2e case. */
const repoNodeModules = path.resolve(here, "../../../../node_modules");
const hasRepoVitest = fs.existsSync(path.join(repoNodeModules, ".bin", "vitest"));

function fsIde(root: string): IDE {
  const toPath = (uri: string) => fileURLToPath(uri);
  return {
    getIdeInfo: vi.fn(async () => ({ remoteName: "local" })),
    getWorkspaceDirs: vi.fn(async () => [`file://${root}`]),
    fileExists: vi.fn(async (uri: string) => fs.existsSync(toPath(uri))),
    readFile: vi.fn(async (uri: string) => fs.readFileSync(toPath(uri), "utf8")),
    listDir: vi.fn(async (uri: string) =>
      fs.readdirSync(toPath(uri)).map((name) => [name, 0] as [string, number]),
    ),
    subprocess: vi.fn(async (command: string) => {
      const r = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      return [r.stdout, r.stderr] as [string, string];
    }),
  } as unknown as IDE;
}

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_build" } } as ToolExtras["tool"],
  };
}

function write(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

const results = (items: ContextItem[]) =>
  items.find((i) => i.name === "Test results");

describe("builtin_build action=test (real runners)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "knox-test-action-")));
  });
  afterEach(() => {
    resetShellJobs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = (args: Record<string, unknown>) =>
    buildImpl({ action: "test", ...args }, extras(fsIde(root)));

  it.skipIf(!hasBin("node"))("node:test project: failing then passing", async () => {
    write(root, {
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "sum.js": "exports.sum = (a, b) => a - b;\n",
      "sum.test.js":
        "const test = require('node:test'); const assert = require('node:assert');\n" +
        "const { sum } = require('./sum');\n" +
        "test('adds', () => { assert.strictEqual(sum(2, 3), 5); });\n" +
        "test('zero', () => { assert.strictEqual(sum(0, 0), 0); });\n",
    });
    const red = await run({});
    const failing = results(red)!;
    expect(failing.description).toBe("failing");
    expect(failing.content).toContain("Test results (node:test): 1 passed, 1 failed");
    expect(failing.content).toContain("- adds (sum.test.js:3)");
    expect(failing.content).toMatch(/Do not delete, skip/);

    fs.writeFileSync(path.join(root, "sum.js"), "exports.sum = (a, b) => a + b;\n");
    const green = results(await run({}))!;
    expect(green.description).toBe("passing");
    expect(green.content).toContain("2 passed, 0 failed");
  }, 60_000);

  it.skipIf(!hasBin("node"))("filter narrows the run", async () => {
    write(root, {
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "a.test.js":
        "const test = require('node:test');\n" +
        "test('alpha', () => {});\ntest('beta', () => { throw new Error('boom'); });\n",
    });
    const only = results(await run({ filter: "alpha" }))!;
    expect(only.description).toBe("passing");
    expect(only.content).toContain("1 passed, 0 failed");
  }, 60_000);

  it.skipIf(!hasRepoVitest || !hasBin("node"))(
    "vitest project via the project script (no watch mode)",
    async () => {
      write(root, {
        "package.json": JSON.stringify({
          type: "module",
          scripts: { test: "vitest" },
          devDependencies: { vitest: "*" },
        }),
        "a.test.ts":
          'import { it, expect } from "vitest";\n' +
          'it("adds", () => { expect(1 + 1).toBe(3); });\n' +
          'it("ok", () => { expect(1).toBe(1); });\n',
      });
      fs.symlinkSync(repoNodeModules, path.join(root, "node_modules"), "dir");
      const failing = results(await run({ target: "a.test.ts" }))!;
      expect(failing.description).toBe("failing");
      expect(failing.content).toContain("Test results (vitest): 1 passed, 1 failed");
      expect(failing.content).toMatch(/adds \(a\.test\.ts:2\)/);
    },
    90_000,
  );

  it.skipIf(!hasBin("python3"))("python unittest project", async () => {
    write(root, {
      "setup.py": "",
      "tests/__init__.py": "",
      "tests/test_a.py":
        "import unittest\nclass T(unittest.TestCase):\n" +
        "    def test_add(self):\n        self.assertEqual(1 + 1, 3)\n" +
        "    def test_ok(self):\n        self.assertTrue(True)\n",
    });
    const failing = results(await run({}))!;
    expect(failing.description).toBe("failing");
    expect(failing.content).toContain("Test results (unittest): 1 passed, 1 failed");
    expect(failing.content).toContain("test_add");
  }, 60_000);

  it.skipIf(!hasBin("go", "version"))("go module", async () => {
    write(root, {
      "go.mod": "module ex\n\ngo 1.22\n",
      "a.go": "package ex\n\nfunc Add(a, b int) int { return a - b }\n",
      "a_test.go":
        'package ex\n\nimport "testing"\n\n' +
        'func TestAdd(t *testing.T) { if Add(2, 3) != 5 { t.Errorf("want 5") } }\n' +
        "func TestOk(t *testing.T) {}\n",
    });
    const failing = results(await run({}))!;
    expect(failing.description).toBe("failing");
    expect(failing.content).toContain("- TestAdd (a_test.go:5)");

    const only = results(await run({ filter: "TestOk" }))!;
    expect(only.description).toBe("passing");
  }, 120_000);

  it.skipIf(!hasBin("cargo"))("cargo crate with a libtest filter", async () => {
    write(root, {
      "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2024"\n',
      "src/lib.rs":
        "pub fn add(a: i32, b: i32) -> i32 { a - b }\n" +
        "#[cfg(test)]\nmod tests {\n    use super::*;\n" +
        "    #[test] fn adds() { assert_eq!(add(2, 3), 5); }\n" +
        "    #[test] fn zero() { assert_eq!(add(0, 0), 0); }\n}\n",
    });
    const failing = results(await run({}))!;
    expect(failing.description).toBe("failing");
    expect(failing.content).toContain("- tests::adds (src/lib.rs:5)");

    const zero = results(await run({ filter: "zero" }))!;
    expect(zero.description).toBe("passing");
    expect(zero.content).toContain("1 passed, 0 failed");
  }, 180_000);

  it("reports when no runner is detected instead of guessing", async () => {
    write(root, { "README.md": "hello" });
    const items = await run({});
    expect(items[0].description).toBe("no test runner");
    expect(items[0].content).toMatch(/Do not claim tests passed/);
  });

  it("explicit command override still gets parsed results", async () => {
    write(root, { "README.md": "hello" });
    const items = await run({
      command: "printf 'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\\n'",
    });
    expect(results(items)!.content).toContain("2 passed, 0 failed");
  });

  it("does not report success for a run that ran zero tests", async () => {
    write(root, {
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "README.md": "no tests here",
    });
    const item = results(await run({ filter: "nothing-matches" }))!;
    expect(item.content).toContain("0 tests ran — this is not a pass");
    expect(item.description).toBe("failing");
  }, 60_000);

  it("refuses destructive input", async () => {
    write(root, { "Cargo.toml": '[package]\nname = "x"\n' });
    const items = await run({ command: "cargo clean && cargo test" });
    expect(items[0].description).toBe("refused");
  });
});
