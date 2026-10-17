import { describe, expect, it } from "vitest";

import {
  applyEditsAgainstOriginal,
  FileEditMatchError,
  findLineSequence,
  fuzzyFindText,
  normalizeForFuzzyMatch,
} from "./fileEditCore";

describe("fileEditCore", () => {
  it("applies disjoint edits against the original file", () => {
    const result = applyEditsAgainstOriginal(
      "const a = 1;\nconst b = 2;\n",
      [
        { oldText: "const a = 1;", newText: "const a = 9;" },
        { oldText: "const b = 2;", newText: "const b = 8;" },
      ],
      "a.ts",
    );
    expect(result.next).toBe("const a = 9;\nconst b = 8;\n");
    expect(result.usedFuzzyMatch).toBe(false);
  });

  it("rejects overlapping edits instead of applying them sequentially", () => {
    expect(() =>
      applyEditsAgainstOriginal(
        "foo bar baz\n",
        [
          { oldText: "foo bar", newText: "FOO" },
          { oldText: "bar baz", newText: "BAZ" },
        ],
        "a.ts",
      ),
    ).toThrow(FileEditMatchError);
  });

  it("fuzzy-matches smart quotes and trailing spaces", () => {
    const content = 'const msg = "hi";  \n';
    const oldText = "const msg = \u201Chi\u201D;";
    const hit = fuzzyFindText(normalizeForFuzzyMatch(content), oldText);
    expect(hit.found).toBe(true);
    const applied = applyEditsAgainstOriginal(
      content,
      [{ oldText, newText: 'const msg = "ok";' }],
      "a.ts",
    );
    expect(applied.next).toBe('const msg = "ok";\n');
    expect(applied.usedFuzzyMatch).toBe(true);
  });

  it("finds a line sequence after trailing-whitespace drift", () => {
    expect(
      findLineSequence(["const b = 2;  "], ["const b = 2;"]),
    ).toEqual([0]);
  });
});
