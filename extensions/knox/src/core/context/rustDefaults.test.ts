import { describe, expect, it } from "vitest";

import {
  applyNewRustProjectFileDefaults,
  cargoPackageNameFromPath,
  rewriteCargoNewCommand,
  RUST_DEFAULT_EDITION,
  RUST_DEFAULT_VERSION,
} from "./rustDefaults";

describe("rustDefaults", () => {
  it("pins new crates to edition 2024 and rustc 1.98.1", () => {
    expect(RUST_DEFAULT_EDITION).toBe("2024");
    expect(RUST_DEFAULT_VERSION).toBe("1.98.1");
  });

  it("names the package from the parent directory", () => {
    expect(cargoPackageNameFromPath("snake/Cargo.toml")).toBe("snake");
    expect(cargoPackageNameFromPath("Cargo.toml")).toBe("app");
    expect(cargoPackageNameFromPath("My App/Cargo.toml")).toBe("my-app");
  });

  it("rewrites LLM cargo-new Cargo.toml from edition 2021 to 2024", () => {
    const written = applyNewRustProjectFileDefaults(
      "snake/Cargo.toml",
      `[package]
name = "snake"
version = "0.1.0"
edition = "2021"
`,
    );
    expect(written).toContain(`edition = "${RUST_DEFAULT_EDITION}"`);
    expect(written).toContain(`rust-version = "${RUST_DEFAULT_VERSION}"`);
    expect(written).not.toContain('edition = "2021"');
    expect(written).toContain('version = "0.1.0"');
  });

  it("pins rust-toolchain.toml channel", () => {
    expect(
      applyNewRustProjectFileDefaults(
        "rust-toolchain.toml",
        '[toolchain]\nchannel = "stable"\n',
      ),
    ).toContain(`channel = "${RUST_DEFAULT_VERSION}"`);
  });

  it("leaves non-manifest files unchanged", () => {
    expect(applyNewRustProjectFileDefaults("src/main.rs", "fn main() {}")).toBe(
      "fn main() {}",
    );
  });

  it("adds --edition 2024 to cargo new and cargo init", () => {
    expect(rewriteCargoNewCommand("cargo new snake")).toBe(
      `cargo new --edition ${RUST_DEFAULT_EDITION} snake`,
    );
    expect(rewriteCargoNewCommand("cargo init --bin")).toBe(
      `cargo init --edition ${RUST_DEFAULT_EDITION} --bin`,
    );
    expect(rewriteCargoNewCommand("cargo new --edition 2021 foo")).toBe(
      `cargo new --edition ${RUST_DEFAULT_EDITION} foo`,
    );
    expect(rewriteCargoNewCommand("cargo check")).toBe("cargo check");
  });
});
