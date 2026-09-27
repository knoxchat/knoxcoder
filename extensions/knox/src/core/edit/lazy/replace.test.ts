import { describe, expect, it } from "vitest";

import { getReplacementByMatching } from "./replace.js";

const OLD = [
  "import a from 'a';",
  "",
  "function keep() {",
  "  return 1;",
  "}",
  "",
  "function change() {",
  "  return 2;",
  "}",
  "",
  "function tail() {",
  "  return 3;",
  "}",
].join("\n");

describe("getReplacementByMatching", () => {
  it("fills a mid-file UNCHANGED gap from surrounding context", () => {
    const before = ["function keep() {", "  return 1;", "}"];
    const after = ["function change() {", "  return 2;", "}"];
    const replacement = getReplacementByMatching(OLD, before, after);
    expect(replacement).toBe("");
  });

  it("handles UNCHANGED CODE at the very top of the file", () => {
    const after = [
      "function change() {",
      "  return 2;",
      "}",
      "",
      "function tail() {",
    ];
    const replacement = getReplacementByMatching(OLD, [], after);
    expect(replacement).toBe(
      [
        "import a from 'a';",
        "",
        "function keep() {",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("handles UNCHANGED CODE at the bottom of the file", () => {
    const before = [
      "function change() {",
      "  return 2;",
      "}",
      "",
    ];
    const replacement = getReplacementByMatching(OLD, before, []);
    expect(replacement).toBe(
      ["function tail() {", "  return 3;", "}"].join("\n"),
    );
  });

  it("returns the whole file when UNCHANGED is the entire content", () => {
    expect(getReplacementByMatching(OLD, [], [])).toBe(OLD);
  });

  it("returns undefined when after-context does not exist in the old file", () => {
    const after = ["function doesNotExist() {", "  return 0;", "}"];
    expect(getReplacementByMatching(OLD, [], after)).toBeUndefined();
  });
});
