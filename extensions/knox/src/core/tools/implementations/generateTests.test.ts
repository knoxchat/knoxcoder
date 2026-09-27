import { describe, expect, it } from "vitest";

import { defaultTestPath } from "./generateTests";

describe("defaultTestPath", () => {
  it("keeps Rust unit tests in the same file, never src/foo_test.rs", () => {
    expect(defaultTestPath("src/lib.rs")).toBe("src/lib.rs");
    expect(defaultTestPath("src/foo.rs")).toBe("src/foo.rs");
    expect(defaultTestPath("src/foo.rs")).not.toMatch(/foo_test\.rs/);
    expect(defaultTestPath("tests/integration.rs")).toBe("tests/integration.rs");
  });

  it("keeps language-specific paths for python and go", () => {
    expect(defaultTestPath("pkg/util.py")).toMatch(/test_util\.py$/);
    expect(defaultTestPath("pkg/util.go")).toBe("pkg/util_test.go");
  });
});
