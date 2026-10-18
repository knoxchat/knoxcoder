import { describe, expect, it } from "vitest";

import {
  applyEditsAgainstOriginal,
  FileEditMatchError,
  findClosestLines,
  findCollapsedWhitespaceSpan,
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

  it("finds a line sequence when only indent differs", () => {
    expect(
      findLineSequence(["    const b = 2;"], ["  const b = 2;"]),
    ).toEqual([0]);
  });

  it("maps a wrap-drifted needle onto the original one-line span", () => {
    const content =
      "spliced at msgsCopy, then moves it to the head (:509). The volatile plan/serial injects therefore sit inside the same system message that\n";
    const needle =
      "spliced at msgsCopy, then moves it to\nthe head\n(:509). The volatile plan/serial injects therefore sit inside the same system message that";
    const span = findCollapsedWhitespaceSpan(content, needle);
    expect(span).toEqual({ start: 0, end: content.trimEnd().length });
  });

  it("hints the paragraph when wrap hides the first needle line", () => {
    const content =
      "The helper is spliced at `msgsCopy.splice(-1, 0, ...)` (`countTokens.ts:440-456`), then moved to the head.\n";
    const closest = findClosestLines(
      content,
      "spliced at `msgsCopy.splice(-1, 0, ...)` (`countTokens.ts:440-452`), then moves it to",
    );
    expect(closest.join("\n")).toMatch(/1:.*msgsCopy/);
  });
});
