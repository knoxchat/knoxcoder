import { describe, expect, it } from "vitest";

import { lineDelta, merge3, unifiedDiff } from "./merge3";

const base = ["a", "b", "c", "d", "e", "f"].join("\n");

describe("merge3", () => {
  it("combines non-overlapping edits", () => {
    const user = base.replace("a", "A");
    const recipe = base.replace("f", "F");
    expect(merge3(base, user, recipe)).toEqual({ ok: true, text: "A\nb\nc\nd\ne\nF" });
  });
  it("conflicts on the same line", () => {
    const r = merge3(base, base.replace("c", "user"), base.replace("c", "recipe"));
    expect(r.ok).toBe(false);
  });
  it("conflicts on touching edits (conservative)", () => {
    expect(merge3(base, base.replace("b", "x"), base.replace("c", "y")).ok).toBe(false);
  });
  it("accepts identical edits", () => {
    const same = base.replace("c", "z");
    expect(merge3(base, same, same)).toEqual({ ok: true, text: same });
  });
  it("handles an untouched side", () => {
    expect(merge3(base, base, "x")).toEqual({ ok: true, text: "x" });
    expect(merge3(base, "x", base)).toEqual({ ok: true, text: "x" });
  });
  it("counts line deltas and renders a diff", () => {
    expect(lineDelta("a\nb", "a\nc\nd")).toEqual({ added: 2, removed: 1 });
    const d = unifiedDiff("x.ts", "a\nb", "a\nc");
    expect(d).toContain("-b");
    expect(d).toContain("+c");
    expect(unifiedDiff("n.ts", undefined, "hi")).toContain("/dev/null");
  });
});
