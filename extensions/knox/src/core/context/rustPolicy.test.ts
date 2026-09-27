import { describe, expect, it } from "vitest";

import { RUST_DEFAULT_EDITION, RUST_DEFAULT_VERSION } from "./rustDefaults";
import { buildRustPolicy, rustPolicyShouldEnable } from "./rustPolicy";

describe("rustPolicyShouldEnable", () => {
  it("enables on rust profile, cargo kind, or cargo verifyCommand", () => {
    expect(rustPolicyShouldEnable({ profile: "rust" })).toBe(true);
    expect(rustPolicyShouldEnable({ workspaceKind: "cargo" })).toBe(true);
    expect(
      rustPolicyShouldEnable({ verifyCommand: "cargo test --workspace" }),
    ).toBe(true);
    expect(rustPolicyShouldEnable({ verifyCommand: "make" })).toBe(false);
  });

  it("enables from a cargo codebase card without the exact check string", () => {
    expect(
      rustPolicyShouldEnable({
        card: "## Codebase Card\nThis workspace looks like a Cargo crate / workspace: demo.\nPinned crates: (none)",
      }),
    ).toBe(true);
    expect(
      rustPolicyShouldEnable({
        card: "## Codebase Card\nThis workspace looks like a Linux kernel.",
      }),
    ).toBe(false);
  });
});

describe("buildRustPolicy", () => {
  it("tells new crates to use edition 2024 and rust-version 1.98.1", () => {
    const policy = buildRustPolicy();
    expect(policy).toContain(`edition ${RUST_DEFAULT_EDITION}`);
    expect(policy).toContain(`rust-version ${RUST_DEFAULT_VERSION}`);
    expect(policy).toContain("Existing crates");
    expect(policy).toContain('Never write edition = "2021"');
  });
});
