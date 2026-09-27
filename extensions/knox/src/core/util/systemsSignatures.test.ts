import { describe, expect, it } from "vitest";

import {
  getSystemsFallbackSignatures,
  headerLooksLikeCpp,
} from "./systemsSignatures";

describe("getSystemsFallbackSignatures", () => {
  it("extracts GNU as macros from a kernel .S file", () => {
    const src = [
      "asmlinkage",
      "SYM_FUNC_START(copy_to_user)",
      "\tret",
      "SYM_FUNC_END(copy_to_user)",
      "ENTRY(memcpy)",
      "END(memcpy)",
    ].join("\n");
    const sigs = getSystemsFallbackSignatures("arch/x86/lib/copy_user.S", src);
    expect(sigs).toContain("SYM_FUNC_START(copy_to_user)");
    expect(sigs).toContain("ENTRY(memcpy)");
    expect(sigs.some((s) => s.includes("asmlinkage"))).toBe(true);
  });

  it("extracts Makefile targets and Kconfig symbols", () => {
    expect(
      getSystemsFallbackSignatures("Makefile", "obj-y += mm/\nvmlinux:\n\t$(Q)$(MAKE)\n"),
    ).toContain("vmlinux:");
    expect(
      getSystemsFallbackSignatures("Kconfig", "config MMU\n\tbool\nmenuconfig EXPERT\n"),
    ).toEqual(["config MMU", "menuconfig EXPERT"]);
  });
});

describe("headerLooksLikeCpp", () => {
  it("detects C++ keywords in a kernel-style header", () => {
    expect(headerLooksLikeCpp("class Foo { template <typename T> void bar(); };")).toBe(
      true,
    );
    expect(headerLooksLikeCpp("struct page { unsigned long flags; };")).toBe(false);
  });
});
