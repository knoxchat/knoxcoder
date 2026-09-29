import { describe, expect, it } from "vitest";

import {
  findMissingCrossCompiler,
  gccNameForPrefix,
  isNativeArch,
  missingCrossCompilerMessage,
} from "./crossCompile";

describe("cross toolchain detection (HL-35)", () => {
  it("does not require a cross gcc for x86_64", async () => {
    expect(isNativeArch("x86_64")).toBe(true);
    const missing = await findMissingCrossCompiler({
      arch: "x86_64",
      which: async () => false,
    });
    expect(missing).toBeUndefined();
  });

  it("returns a structured error when aarch64-linux-gnu-gcc is missing", async () => {
    const missing = await findMissingCrossCompiler({
      arch: "arm64",
      which: async () => false,
    });
    expect(missing).toContain("aarch64-linux-gnu-gcc");
    expect(missing).toContain("CROSS_COMPILE=");
    expect(missing).toContain("did not start make");
  });

  it("accepts an explicit CROSS_COMPILE that exists on PATH", async () => {
    const missing = await findMissingCrossCompiler({
      arch: "arm64",
      crossCompile: "aarch64-linux-gnu-",
      which: async (name) => name === "aarch64-linux-gnu-gcc",
    });
    expect(missing).toBeUndefined();
    expect(gccNameForPrefix("aarch64-linux-gnu-")).toBe(
      "aarch64-linux-gnu-gcc",
    );
  });

  it("formats a missing-compiler message without a make log", () => {
    const text = missingCrossCompilerMessage({
      arch: "arm64",
      prefix: "aarch64-linux-gnu-",
      gcc: "aarch64-linux-gnu-gcc",
    });
    expect(text).not.toMatch(/error:/);
    expect(text.split("\n").length).toBeLessThan(10);
  });
});
