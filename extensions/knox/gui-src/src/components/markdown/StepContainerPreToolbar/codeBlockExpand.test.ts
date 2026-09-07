import { describe, expect, it } from "vitest";

import {
  hasVisibleCodeContent,
  initialCodeBlockExpanded,
  shouldAutoExpandGeneratingCodeBlock,
} from "./codeBlockExpand";

describe("codeBlockExpand", () => {
  it("treats blank or whitespace-only fences as having no visible code", () => {
    expect(hasVisibleCodeContent("")).toBe(false);
    expect(hasVisibleCodeContent("\n")).toBe(false);
    expect(hasVisibleCodeContent("  \n  ")).toBe(false);
    expect(hasVisibleCodeContent("const x = 1;")).toBe(true);
  });

  it("starts collapsed when a read-style preview has no code", () => {
    expect(initialCodeBlockExpanded("")).toBe(false);
    expect(initialCodeBlockExpanded("\n", false)).toBe(false);
  });

  it("starts expanded when there is code unless explicitly collapsed", () => {
    expect(initialCodeBlockExpanded("fn main() {}")).toBe(true);
    expect(initialCodeBlockExpanded("fn main() {}", false)).toBe(false);
    expect(initialCodeBlockExpanded("", true)).toBe(true);
  });

  it("does not auto-expand empty generating blocks", () => {
    expect(shouldAutoExpandGeneratingCodeBlock(true, "")).toBe(false);
    expect(shouldAutoExpandGeneratingCodeBlock(true, "\n")).toBe(false);
    expect(shouldAutoExpandGeneratingCodeBlock(true, "let x = 1;")).toBe(true);
    expect(shouldAutoExpandGeneratingCodeBlock(true, "let x = 1;", false)).toBe(
      false,
    );
    expect(shouldAutoExpandGeneratingCodeBlock(false, "let x = 1;")).toBe(false);
  });
});
