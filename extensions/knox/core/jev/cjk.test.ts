import { describe, expect, it } from "vitest";

import { isCjkHeavy } from "./cjk";

describe("isCjkHeavy", () => {
  it("is false for English coding requests", () => {
    expect(isCjkHeavy("What does copy_to_user do in mm/filemap.c?")).toBe(
      false,
    );
  });

  it("is true for Chinese-only questions", () => {
    expect(
      isCjkHeavy("这个函数 copy_to_user 在内核里是做什么的，请解释一下实现"),
    ).toBe(true);
  });

  it("ignores short fragments", () => {
    expect(isCjkHeavy("你好")).toBe(false);
  });
});
