import { describe, expect, it } from "vitest";

import {
  detectCheckpointPresetKind,
  RUST_CHECKPOINT_IGNORE_PATTERNS,
} from "./checkpointIgnore";

describe("checkpoint ignore presets (HL-41)", () => {
  it("detects a kernel tree before a generic Makefile C++ preset", () => {
    expect(
      detectCheckpointPresetKind(["Kconfig", "arch", "Makefile", "mm"]),
    ).toBe("kernel");
  });

  it("detects QEMU from meson.build + target", () => {
    expect(
      detectCheckpointPresetKind(["meson.build", "target", "accel"]),
    ).toBe("qemu");
  });

  it("falls back to cpp for a bare Makefile", () => {
    expect(detectCheckpointPresetKind(["Makefile", "src"])).toBe("cpp");
  });

  it("detects Cargo and ignores target/ plus rlib cache (RL-54)", () => {
    expect(detectCheckpointPresetKind(["Cargo.toml", "src"])).toBe("rust");
    expect(RUST_CHECKPOINT_IGNORE_PATTERNS).toEqual(
      expect.arrayContaining(["target/", "**/*.rlib", "**/*.rmeta"]),
    );
  });
});
