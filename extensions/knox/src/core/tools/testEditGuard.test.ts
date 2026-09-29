import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "..";
import { editFileImpl } from "./implementations/editFile";
import {
  analyzeTestEdit,
  evaluateTestEditWarnings,
  isNonRustTestPath,
  TEST_WEAKENING_MARKER,
} from "./testEditGuard";

describe("isNonRustTestPath", () => {
  it("recognizes TS/JS, Python and Go test files only", () => {
    for (const p of [
      "src/sum.test.ts",
      "src/sum.spec.tsx",
      "src/__tests__/sum.js",
      "tests/test_math.py",
      "pkg/math_test.py",
      "pkg/math_test.go",
      "test/helpers.mjs",
    ]) {
      expect(isNonRustTestPath(p), p).toBe(true);
    }
    for (const p of ["src/sum.ts", "src/main.py", "README.md", "tests/it.rs", "src/lib.rs"]) {
      expect(isNonRustTestPath(p), p).toBe(false);
    }
  });
});

describe("analyzeTestEdit", () => {
  it("counts removed assertions, cases and added skips across languages", () => {
    const ts = analyzeTestEdit(
      "it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });",
      "it.skip('a', () => { expect(1).toBe(1); });",
    );
    expect(ts).toEqual({ assertsRemoved: 1, casesRemoved: 0, skipsAdded: 1 });

    const py = analyzeTestEdit(
      "def test_a():\n    assert x == 1\n\ndef test_b():\n    self.assertEqual(1, 1)\n",
      "@pytest.mark.skip\ndef test_a():\n    assert x == 1\n",
    );
    expect(py.casesRemoved).toBe(1);
    expect(py.assertsRemoved).toBe(1);
    expect(py.skipsAdded).toBe(1);

    const go = analyzeTestEdit(
      'func TestA(t *testing.T) { t.Errorf("x") }\nfunc TestB(t *testing.T) {}\n',
      'func TestA(t *testing.T) { t.Skip("later") }\n',
    );
    expect(go).toEqual({ assertsRemoved: 1, casesRemoved: 1, skipsAdded: 1 });
  });

  it("is quiet for additive edits and refactors", () => {
    expect(
      analyzeTestEdit(
        "it('a', () => { expect(1).toBe(1); });",
        "it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });\nit('b', () => {});",
      ),
    ).toEqual({ assertsRemoved: 0, casesRemoved: 0, skipsAdded: 0 });
  });
});

describe("evaluateTestEditWarnings", () => {
  const before = "it('a', () => { expect(sum(2, 3)).toBe(5); });\n";

  it("warns when a test file loses its assertion", () => {
    const [w] = evaluateTestEditWarnings({
      filePath: "src/sum.test.ts",
      oldText: before,
      newText: "it('a', () => {});\n",
    });
    expect(w.content).toContain(TEST_WEAKENING_MARKER);
    expect(w.content).toContain("1 fewer assertion(s)");
    expect(w.content).toMatch(/Fix the code under test/);
  });

  it("does not fire for source files, new files or Rust", () => {
    expect(
      evaluateTestEditWarnings({ filePath: "src/sum.ts", oldText: before, newText: "" }),
    ).toEqual([]);
    expect(
      evaluateTestEditWarnings({ filePath: "src/sum.test.ts", oldText: "", newText: before }),
    ).toEqual([]);
    expect(
      evaluateTestEditWarnings({ filePath: "tests/a.rs", oldText: before, newText: "" }),
    ).toEqual([]);
  });
});

describe("edit_file surfaces the warning", () => {
  it("still applies the edit but flags the weakened test", async () => {
    const content = "it('a', () => {\n  expect(sum(2, 3)).toBe(5);\n});\n";
    const ide = {
      fileExists: vi.fn(async () => true),
      readFile: vi.fn(async () => content),
      writeFile: vi.fn(async () => {}),
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
    } as unknown as IDE;
    const extras = {
      ide,
      llm: {} as ToolExtras["llm"],
      fetch: vi.fn(),
      tool: { function: { name: "builtin_edit_file" } } as ToolExtras["tool"],
    } as ToolExtras;
    const items = await editFileImpl(
      {
        filepath: "src/sum.test.ts",
        old_string: "  expect(sum(2, 3)).toBe(5);\n",
        new_string: "",
      },
      extras,
    );
    expect(ide.writeFile).toHaveBeenCalled();
    expect(items.some((i) => i.name === "Test guard")).toBe(true);
  });
});
