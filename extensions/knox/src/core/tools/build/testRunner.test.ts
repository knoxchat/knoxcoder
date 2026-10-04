import { describe, expect, it } from "vitest";

import {
  composeTestCommand,
  detectTestRunners,
  formatTestResults,
  parseTestOutput,
  pickTestRunner,
  shellQuote,
  testsRed,
  type WorkspaceFacts,
} from "./testRunner";

function facts(files: Record<string, string>): WorkspaceFacts {
  return {
    entries: Object.keys(files),
    readText: async (name) => files[name],
  };
}

const CARGO_FAIL = `   Compiling c1 v0.1.0 (/tmp/c1)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.38s
     Running unittests src/lib.rs (target/debug/deps/c1-1e122870b61785c5)

running 3 tests
test tests::slow ... ignored
test tests::ok_one ... ok
test tests::adds ... FAILED

failures:

---- tests::adds stdout ----

thread 'tests::adds' (4182275) panicked at src/lib.rs:5:25:
assertion \`left == right\` failed
  left: -1
 right: 5
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    tests::adds

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass \`--lib\`
`;

const VITEST_FAIL = `
 RUN  v5.0.2 /tmp/v1

 ❯ a.test.ts (3 tests | 1 failed | 1 skipped) 3ms
   ❯ math (3)
     × adds 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  a.test.ts > math > adds
AssertionError: expected 2 to be 3 // Object.is equality

- Expected
+ Received

- 3
+ 2

 ❯ a.test.ts:3:36
      1| import { describe, it, expect } from "vitest";

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 1 skipped (3)
`;

const JEST_FAIL = `FAIL src/sum.test.js
  ● sum › adds

    expect(received).toBe(expected) // Object.is equality

    Expected: 4
    Received: 3

      3 | test('adds', () => {
    > 4 |   expect(sum(1, 2)).toBe(4);
        |                     ^
      at Object.<anonymous> (src/sum.test.js:4:21)

Tests:       1 failed, 2 passed, 3 total
Test Suites: 1 failed, 1 total
`;

const NODE_FAIL = `✖ adds (0.661583ms)
✔ ok (0.068333ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

✖ failing tests:

test at a.test.js:2:1
✖ adds (0.661583ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
`;

const UNITTEST_FAIL = `test_add (test_a.T.test_add) ... FAIL
test_ok (test_a.T.test_ok) ... ok

======================================================================
FAIL: test_add (test_a.T.test_add)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/p1/test_a.py", line 4, in test_add
    self.assertEqual(1+1, 3)
AssertionError: 2 != 3

----------------------------------------------------------------------
Ran 2 tests in 0.000s

FAILED (failures=1)
`;

const PYTEST_FAIL = `tests/test_math.py:7: AssertionError
=========================== short test summary info ============================
FAILED tests/test_math.py::test_add - assert 3 == 4
FAILED tests/test_math.py::test_mul - AssertionError: bad
========================= 2 failed, 5 passed, 1 skipped in 0.12s ==============
`;

const GO_FAIL = `--- FAIL: TestAdd (0.00s)
    a_test.go:3: want 5 got -1
FAIL
FAIL\tex\t0.429s
FAIL
`;

const MOCHA_FAIL = `  2 passing (5ms)
  1 failing

  1) math
       adds:
     AssertionError: expected 2 to equal 3
`;

describe("parseTestOutput", () => {
  it("cargo test: counts, failing test, panic location", () => {
    const r = parseTestOutput(CARGO_FAIL)!;
    expect(r.framework).toBe("cargo test");
    expect(r).toMatchObject({ passed: 1, failed: 1, skipped: 1 });
    expect(r.failures).toEqual([
      expect.objectContaining({ name: "tests::adds", file: "src/lib.rs", line: 5 }),
    ]);
    expect(r.failures[0].message).toContain("left == right");
  });

  it("cargo test: sums unit + doc-test result lines", () => {
    const r = parseTestOutput(
      "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n" +
        "test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\n",
    )!;
    expect(r).toMatchObject({ passed: 5, failed: 0, skipped: 1 });
  });

  it("cargo test: compile failure is a run error, not a pass", () => {
    const r = parseTestOutput("error[E0425]: cannot find value `x`\nerror: could not compile `c1` (lib test)\n")!;
    expect(r.runError).toMatch(/could not compile/);
    expect(testsRed("error: could not compile `c1`")).toBe(true);
  });

  it("vitest: counts and failing test with location", () => {
    const r = parseTestOutput(VITEST_FAIL)!;
    expect(r.framework).toBe("vitest");
    expect(r).toMatchObject({ passed: 1, failed: 1, skipped: 1 });
    expect(r.failures[0]).toMatchObject({
      name: "math > adds",
      file: "a.test.ts",
      line: 3,
    });
    expect(r.failures[0].message).toContain("expected 2 to be 3");
  });

  it("jest: counts and failing test", () => {
    const r = parseTestOutput(JEST_FAIL)!;
    expect(r.framework).toBe("jest");
    expect(r).toMatchObject({ passed: 2, failed: 1 });
    expect(r.failures[0]).toMatchObject({ name: "sum › adds", file: "src/sum.test.js", line: 4 });
  });

  it("node:test: counts, name and location", () => {
    const r = parseTestOutput(NODE_FAIL)!;
    expect(r.framework).toBe("node:test");
    expect(r).toMatchObject({ passed: 1, failed: 1 });
    expect(r.failures).toEqual([
      expect.objectContaining({ name: "adds", file: "a.test.js", line: 2 }),
    ]);
  });

  it("mocha: counts and failing test", () => {
    const r = parseTestOutput(MOCHA_FAIL)!;
    expect(r).toMatchObject({ framework: "mocha", passed: 2, failed: 1 });
    expect(r.failures[0].name).toBe("math adds");
  });

  it("pytest: counts, node ids, messages, line", () => {
    const r = parseTestOutput(PYTEST_FAIL)!;
    expect(r).toMatchObject({ framework: "pytest", passed: 5, failed: 2, skipped: 1 });
    expect(r.failures.map((f) => f.name)).toEqual([
      "tests/test_math.py::test_add",
      "tests/test_math.py::test_mul",
    ]);
    expect(r.failures[0]).toMatchObject({ file: "tests/test_math.py", line: 7, message: "assert 3 == 4" });
  });

  it("pytest: quiet pass line and 'no tests ran'", () => {
    expect(parseTestOutput("12 passed in 0.31s")).toMatchObject({ passed: 12, failed: 0 });
    const none = parseTestOutput("============ no tests ran in 0.01s ============")!;
    expect(none.passed).toBe(0);
    expect(testsRed("============ no tests ran in 0.01s ============")).toBe(true);
  });

  it("unittest (old and new name format)", () => {
    const r = parseTestOutput(UNITTEST_FAIL)!;
    expect(r).toMatchObject({ framework: "unittest", passed: 1, failed: 1 });
    expect(r.failures[0]).toMatchObject({ name: "test_a.T.test_add", line: 4 });
    const old = parseTestOutput(
      UNITTEST_FAIL.replace(/test_add \(test_a\.T\.test_add\)/g, "test_add (test_a.T)"),
    )!;
    expect(old.failures[0].name).toBe("test_a.T.test_add");
  });

  it("go test: failing test with file:line, build failure", () => {
    const r = parseTestOutput(GO_FAIL)!;
    expect(r.framework).toBe("go test");
    expect(r.failures[0]).toMatchObject({ name: "TestAdd", file: "a_test.go", line: 3 });
    expect(r.failures[0].message).toContain("want 5");
    const build = parseTestOutput("FAIL\tex [build failed]\n")!;
    expect(build.runError).toMatch(/could not build/);
  });

  it("strips ANSI and ignores unrelated output", () => {
    const green = "\u001b[32m 12 passed\u001b[0m in 0.31s";
    expect(parseTestOutput(green)?.passed).toBe(12);
    expect(parseTestOutput("hello world")).toBeUndefined();
    expect(parseTestOutput("")).toBeUndefined();
  });
});

describe("formatTestResults / testsRed", () => {
  it("lists failures and forbids weakening tests", () => {
    const text = formatTestResults(`Exit: 1\n${CARGO_FAIL}`);
    expect(text).toContain("Test results (cargo test): 1 passed, 1 failed, 1 skipped.");
    expect(text).toContain("- tests::adds (src/lib.rs:5)");
    expect(text).toMatch(/Do not delete, skip/);
    expect(testsRed(`Exit: 1\n${CARGO_FAIL}`)).toBe(true);
  });

  it("does not call a zero-test run a pass", () => {
    const log = "Exit: 0\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n";
    expect(formatTestResults(log)).toMatch(/0 tests ran — this is not a pass/);
    expect(testsRed(log)).toBe(true);
  });

  it("is green only when tests ran and nothing failed", () => {
    const log = "Exit: 0\ntest result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n";
    expect(testsRed(log)).toBe(false);
    expect(formatTestResults(log)).toContain("4 passed, 0 failed");
  });

  it("warns when nothing is recognizable", () => {
    expect(formatTestResults("Exit: 127\nsh: foo: not found")).toMatch(/no test summary recognized \(exit 127\)/);
    expect(formatTestResults("Exit: 0\nok")).toMatch(/Confirm from the log that tests actually ran/);
    expect(testsRed("Exit: 127\nsh: foo: not found")).toBe(true);
  });
});

describe("detectTestRunners", () => {
  it("cargo", async () => {
    const r = await detectTestRunners(facts({ "Cargo.toml": "" }));
    expect(r.map((x) => x.kind)).toEqual(["cargo"]);
  });

  it("npm script with vitest runs via the script with CI=1", async () => {
    const [r] = await detectTestRunners(
      facts({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) }),
    );
    expect(r).toMatchObject({ kind: "vitest", viaScript: true, packageManager: "npm" });
    expect(r.base).toMatch(/npm test$/);
  });

  it("watch scripts are bypassed for a direct run-once command", async () => {
    const [r] = await detectTestRunners(
      facts({
        "package.json": JSON.stringify({
          scripts: { test: "vitest --watch" },
          devDependencies: { vitest: "^3" },
        }),
        "pnpm-lock.yaml": "",
      }),
    );
    expect(r.viaScript).toBeUndefined();
    expect(r.base).toContain("pnpm exec vitest run");
    expect(r.base).not.toContain("watch");
  });

  it("jest / mocha / node:test from devDependencies or script", async () => {
    const jest = await detectTestRunners(
      facts({ "package.json": JSON.stringify({ devDependencies: { jest: "1" } }) }),
    );
    expect(jest[0].base).toContain("jest --ci");
    const mocha = await detectTestRunners(
      facts({ "package.json": JSON.stringify({ scripts: { test: "mocha" } }) }),
    );
    expect(mocha[0].kind).toBe("mocha");
    const node = await detectTestRunners(
      facts({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) }),
    );
    expect(node[0].kind).toBe("node-test");
  });

  it("package manager from lockfile and packageManager field", async () => {
    const pkg = JSON.stringify({ scripts: { test: "vitest run" } });
    expect((await detectTestRunners(facts({ "package.json": pkg, "yarn.lock": "" })))[0].base).toContain("yarn test");
    expect((await detectTestRunners(facts({ "package.json": pkg, "bun.lock": "" })))[0].base).toContain("bun run test");
    const field = JSON.stringify({ scripts: { test: "vitest run" }, packageManager: "pnpm@9.0.0" });
    expect((await detectTestRunners(facts({ "package.json": field })))[0].base).toContain("pnpm run test");
  });

  it("ignores the npm placeholder script and invalid package.json", async () => {
    const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
    expect(await detectTestRunners(facts({ "package.json": placeholder }))).toEqual([]);
    expect(await detectTestRunners(facts({ "package.json": "{nope" }))).toEqual([]);
  });

  it("python: pytest vs unittest", async () => {
    const py = await detectTestRunners(facts({ "pyproject.toml": "[tool.pytest.ini_options]\n" }));
    expect(py[0].kind).toBe("pytest");
    const ut = await detectTestRunners(facts({ tests: "", "setup.py": "" }));
    expect(ut[0].kind).toBe("unittest");
    const uv = await detectTestRunners(facts({ "pytest.ini": "", "uv.lock": "" }));
    expect(uv[0].base).toContain("uv run pytest");
  });

  it("go and polyglot ordering (cargo first)", async () => {
    expect((await detectTestRunners(facts({ "go.mod": "" })))[0].kind).toBe("go");
    const poly = await detectTestRunners(
      facts({
        "Cargo.toml": "",
        "go.mod": "",
        "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      }),
    );
    expect(poly.map((x) => x.kind)).toEqual(["cargo", "vitest", "go"]);
  });

  it("returns nothing for an unrelated directory", async () => {
    expect(await detectTestRunners(facts({ "README.md": "" }))).toEqual([]);
  });
});

describe("pickTestRunner", () => {
  it("routes by target extension", async () => {
    const all = await detectTestRunners(
      facts({
        "Cargo.toml": "",
        "go.mod": "",
        "pyproject.toml": "[tool.pytest]",
        "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      }),
    );
    expect(pickTestRunner(all, "src/lib.rs")?.kind).toBe("cargo");
    expect(pickTestRunner(all, "src/a.test.ts")?.kind).toBe("vitest");
    expect(pickTestRunner(all, "tests/test_a.py::test_x")?.kind).toBe("pytest");
    expect(pickTestRunner(all, "pkg/a_test.go")?.kind).toBe("go");
    expect(pickTestRunner(all, "./pkg/...")?.kind).toBe("go");
    expect(pickTestRunner(all)?.kind).toBe("cargo");
    expect(pickTestRunner([], "x.ts")).toBeUndefined();
  });
});

describe("composeTestCommand", () => {
  const run = async (files: Record<string, string>) =>
    (await detectTestRunners(facts(files)))[0];

  it("cargo keeps -p / extra args and adds a libtest filter after --", async () => {
    const r = await run({ "Cargo.toml": "" });
    expect(composeTestCommand(r).command).toBe("cargo test --workspace");
    expect(composeTestCommand(r, { target: "mylib", filter: "adds" }).command).toBe(
      "cargo test -p mylib -- adds",
    );
    expect(
      composeTestCommand(r, { extraArgs: "-- --nocapture", filter: "adds" }).command,
    ).toBe("cargo test --workspace -- --nocapture adds");
  });

  it("vitest/jest use -t; npm scripts pass args after --", async () => {
    const npm = await run({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    const c = composeTestCommand(npm, { target: "src/a.test.ts", filter: "adds" });
    expect(c.command).toMatch(/npm test -- src\/a\.test\.ts -t adds$/);
    const direct = await run({ "package.json": JSON.stringify({ devDependencies: { jest: "1" } }) });
    expect(composeTestCommand(direct, { filter: "sum adds" }).command).toMatch(
      new RegExp(
        `jest --ci -t ${shellQuote("sum adds").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      ),
    );
  });

  it("pytest -k, unittest discover / module, go -run", async () => {
    const py = await run({ "pytest.ini": "" });
    expect(composeTestCommand(py, { target: "tests/test_a.py", filter: "add" }).command).toMatch(
      /-m pytest -q --color=no tests\/test_a\.py -k add$/,
    );
    const ut = await run({ tests: "", "setup.py": "" });
    expect(composeTestCommand(ut).command).toMatch(/-m unittest discover -v$/);
    expect(composeTestCommand(ut, { target: "tests.test_a" }).command).toMatch(/-m unittest tests\.test_a$/);
    const go = await run({ "go.mod": "" });
    expect(composeTestCommand(go).command).toBe("go test ./...");
    expect(composeTestCommand(go, { target: "./pkg", filter: "TestAdd" }).command).toBe(
      "go test ./pkg -run TestAdd",
    );
  });

  it("quotes hostile filters so they cannot inject shell", async () => {
    const go = await run({ "go.mod": "" });
    const c = composeTestCommand(go, { filter: "x; rm -rf /" }).command;
    expect(c).toBe(`go test ./... -run ${shellQuote("x; rm -rf /")}`);
    expect(shellQuote("it's")).toBe(
      process.platform === "win32" ? `"it's"` : "'it'\\''s'",
    );
    expect(shellQuote("plain-name_1.ts")).toBe("plain-name_1.ts");
  });

  it("notes when a filter cannot be applied", async () => {
    const npm = await run({ "package.json": JSON.stringify({ scripts: { test: "ava" } }) });
    const c = composeTestCommand(npm, { filter: "x" });
    expect(c.notes[0]).toMatch(/filter ignored/);
    expect(c.command).not.toContain(" x");
  });
});
