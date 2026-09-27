import { afterEach, describe, expect, it } from "vitest";

import {
  resetRustPolicyForTests,
  setRustPolicyEnabled,
  setRustUserTask,
} from "../context/rustPolicy";
import {
  CLONE_DENSITY_MARKER,
  TEST_TAMPER_MARKER,
  UNSAFE_SAFETY_MARKER,
  evaluateRustEditGuard,
  looksLikeTestTamper,
  unjustifiedShareConstructs,
} from "./rustEditGuard";

afterEach(() => {
  resetRustPolicyForTests();
});

describe("looksLikeTestTamper", () => {
  it("flags deleted asserts and #[ignore]", () => {
    expect(
      looksLikeTestTamper("assert_eq!(add(2, 3), 5);", "// gone"),
    ).toBe(true);
    expect(
      looksLikeTestTamper("#[test] fn t() {}", "#[ignore]\n#[test] fn t() {}"),
    ).toBe(true);
    expect(
      looksLikeTestTamper("assert_eq!(1, 1);", "assert_eq!(1, 1);"),
    ).toBe(false);
  });
});

describe("unjustifiedShareConstructs", () => {
  it("flags new .clone() without a share/owned comment", () => {
    expect(
      unjustifiedShareConstructs("let x = acc;", "let x = acc.clone();"),
    ).toEqual([".clone()"]);
    expect(
      unjustifiedShareConstructs(
        "let x = acc;",
        "let x = acc.clone(); // share: snapshot for the log",
      ),
    ).toEqual([]);
  });
});

describe("evaluateRustEditGuard", () => {
  it("rejects test-tamper on the rust profile", () => {
    setRustPolicyEnabled(true);
    const result = evaluateRustEditGuard({
      filePath: "src/lib.rs",
      oldText: `#[cfg(test)]\nmod tests {\n    assert_eq!(add(2, 3), 5);\n}\n`,
      newText: `#[cfg(test)]\nmod tests {\n    #[ignore]\n    fn skipped() {}\n}\n`,
    });
    expect(result.block?.content).toContain(TEST_TAMPER_MARKER);
  });

  it("allows test edits when the user asked to change tests", () => {
    setRustPolicyEnabled(true);
    setRustUserTask("Update the tests to match the new API.");
    const result = evaluateRustEditGuard({
      filePath: "tests/add.rs",
      oldText: "assert_eq!(add(2, 3), 5);",
      newText: "assert_eq!(add(2, 3), 6);",
    });
    expect(result.block).toBeUndefined();
  });

  it("warns on unjustified clone and bare unsafe", () => {
    setRustPolicyEnabled(true);
    const clone = evaluateRustEditGuard({
      filePath: "src/borrow.rs",
      oldText: "let snapshot = acc.as_str();",
      newText: "let snapshot = acc.clone();",
    });
    expect(clone.warnings[0]?.content).toContain(CLONE_DENSITY_MARKER);
    const uns = evaluateRustEditGuard({
      filePath: "src/lib.rs",
      oldText: "pub fn add(a: i32, b: i32) -> i32 { a + b }",
      newText: "pub fn add(a: i32, b: i32) -> i32 { unsafe { a + b } }",
    });
    expect(uns.warnings[0]?.content).toContain(UNSAFE_SAFETY_MARKER);
    const unsFn = evaluateRustEditGuard({
      filePath: "src/lib.rs",
      oldText: "pub fn dabble() {}",
      newText: "pub unsafe fn dabble() {}",
    });
    expect(unsFn.warnings[0]?.content).toContain(UNSAFE_SAFETY_MARKER);
  });

  it("is a no-op when rust policy is off", () => {
    const result = evaluateRustEditGuard({
      filePath: "src/lib.rs",
      oldText: "assert_eq!(1, 1);",
      newText: "",
    });
    expect(result.block).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
});
