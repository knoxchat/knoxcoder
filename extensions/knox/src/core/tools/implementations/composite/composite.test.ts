import { describe, expect, it } from "vitest";

import { allTools, compositeTools } from "../../index";
import {
  analyzeCompositeSource,
  detectProjectType,
  formatCargoHealthMessage,
  shouldUseJsHeuristics,
} from "./index";

describe("composite tools (HL-39)", () => {
  it("are not on the default allTools catalog", () => {
    const names = new Set(allTools.map((tool) => tool.function.name));
    for (const tool of compositeTools) {
      expect(names.has(tool.function.name)).toBe(false);
    }
  });

  it("skips JS import/export heuristics on C sources", () => {
    expect(shouldUseJsHeuristics("mm/filemap.c")).toBe(false);
    expect(shouldUseJsHeuristics("arch/x86/entry/entry_64.S")).toBe(false);
    expect(shouldUseJsHeuristics("src/app.ts")).toBe(true);
    const analysis = analyzeCompositeSource(
      "mm/filemap.c",
      'class foo {}\nimport "x";\n',
    );
    expect(analysis.skippedJsHeuristics).toBe(true);
    expect(
      (analysis as { hasClasses?: boolean }).hasClasses,
    ).toBeUndefined();
  });

  it("detects a Cargo crate instead of recommending eslint (RL-53)", () => {
    const detected = detectProjectType([
      ["Cargo.toml", 1],
      ["src", 2],
      ["rust-toolchain.toml", 1],
    ]);
    expect(detected.type).toBe("Rust");
    expect(detected.buildTools).toContain("Cargo");
    expect(detected.languages).toContain("Rust");
  });

  it("lists rustfmt/clippy/lock/toolchain and forbids eslint (RL-53)", () => {
    expect(
      formatCargoHealthMessage([
        "Cargo.toml",
        "rustfmt.toml",
        "clippy.toml",
        "Cargo.lock",
        "rust-toolchain.toml",
      ]),
    ).toMatch(/Found Cargo health files:.*rustfmt\.toml/);
    expect(
      formatCargoHealthMessage(["Cargo.toml", "package.json"]),
    ).toMatch(/Do not run eslint/);
  });
});
