import { describe, expect, it } from "vitest";

import {
  compileSearchPattern,
  findMatchRanges,
  textMatchesPattern,
} from "./findWidgetSearch";

describe("compileSearchPattern", () => {
  it("compiles literal case-insensitive by default", () => {
    const p = compileSearchPattern("Foo", {
      caseSensitive: false,
      useRegex: false,
    });
    expect(p).toEqual({
      kind: "literal",
      value: "foo",
      caseSensitive: false,
    });
  });

  it("compiles valid regex", () => {
    const p = compileSearchPattern("fo+", {
      caseSensitive: true,
      useRegex: true,
    });
    expect(p.kind).toBe("regex");
  });

  it("returns invalid for bad regex", () => {
    const p = compileSearchPattern("(", {
      caseSensitive: false,
      useRegex: true,
    });
    expect(p.kind).toBe("invalid");
  });
});

describe("findMatchRanges", () => {
  it("finds literal matches", () => {
    const p = compileSearchPattern("ab", {
      caseSensitive: false,
      useRegex: false,
    });
    expect(findMatchRanges("abXab", p)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  it("finds regex matches", () => {
    const p = compileSearchPattern("a+", {
      caseSensitive: true,
      useRegex: true,
    });
    expect(findMatchRanges("baaac", p)).toEqual([{ start: 1, end: 4 }]);
  });

  it("returns empty for invalid pattern", () => {
    const p = compileSearchPattern("(", {
      caseSensitive: false,
      useRegex: true,
    });
    expect(findMatchRanges("abc", p)).toEqual([]);
  });
});

describe("textMatchesPattern", () => {
  it("matches literals case-insensitively", () => {
    const p = compileSearchPattern("Hi", {
      caseSensitive: false,
      useRegex: false,
    });
    expect(textMatchesPattern("say hi there", p)).toBe(true);
    expect(textMatchesPattern("nope", p)).toBe(false);
  });
});
