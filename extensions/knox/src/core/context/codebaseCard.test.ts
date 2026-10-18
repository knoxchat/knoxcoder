import { describe, expect, it } from "vitest";

import {
  buildCodebaseCard,
  inferArchFromConfig,
  parseCargoManifest,
} from "./codebaseCard";

describe("buildCodebaseCard", () => {
  it("injects make ARCH=… and subsystem dirs for a kernel-like tree", () => {
    const card = buildCodebaseCard({
      entryNames: ["Kconfig", "Makefile", "arch", "mm", "fs", "kernel"],
      topDirs: ["arch", "mm", "fs", "kernel", "drivers"],
      configText: "CONFIG_X86_64=y\nCONFIG_MMU=y\n",
    });
    expect(card).toContain("Codebase Card");
    expect(card).toContain("make ARCH=x86_64");
    expect(card).toContain("mm/");
    expect(card).toContain("arch/");
    expect(card).toContain("builtin_maintainers");
    expect(card).not.toContain("CONFIG_MMU=y");
  });

  it("injects cargo check and crate facts for a Cargo workspace", () => {
    const card = buildCodebaseCard({
      entryNames: ["Cargo.toml", "src", "crates"],
      topDirs: ["src", "crates", "target"],
      cargoToml: `[package]
name = "mini-rust"
edition = "2024"
rust-version = "1.98.1"

[workspace]
members = ["crates/foo", "crates/bar"]

[dependencies]
serde = "1.0"
`,
      cargoLock: `[[package]]
name = "serde"
version = "1.0.210"
`,
      rustToolchain: true,
      rustToolchainText: `[toolchain]\nchannel = "1.98.1"\n`,
      clippyToml: true,
    });
    expect(card).toContain("Codebase Card");
    expect(card).toContain("mini-rust");
    expect(card).toContain("edition 2024");
    expect(card).toContain("foo");
    expect(card).toContain("bar");
    expect(card).toContain("cargo check --workspace --all-targets");
    expect(card).toContain("builtin_build");
    expect(card).toMatch(/Do not cargo clean/);
    expect(card).toMatch(/fileType rust/);
    expect(card).toContain("rust-analyzer");
    expect(card).toContain("rust-toolchain.toml");
    expect(card).toContain("clippy.toml");
    expect(card).toMatch(/channel 1\.98\.1/);
    expect(card).toMatch(/package\.rust-version 1\.98\.1/);
    expect(card).toContain("Pinned crates");
    expect(card).toContain("serde 1.0.210");
  });

  it("asks for cargo generate-lockfile instead of inventing versions", () => {
    const card = buildCodebaseCard({
      entryNames: ["Cargo.toml", "src"],
      cargoToml: `[package]
name = "mini-rust"
edition = "2024"

[dependencies]
axum = "0.7"
`,
    });
    expect(card).toContain("Pinned crates");
    expect(card).toContain("cargo generate-lockfile");
    expect(card).not.toMatch(/axum 0\.\d/);
  });

  it("describes a QEMU tree", () => {
    const card = buildCodebaseCard({
      entryNames: ["meson.build", "target", "accel", "hw"],
      topDirs: ["target", "accel", "hw", "include"],
    });
    expect(card).toMatch(/QEMU/i);
    expect(card).toContain("ninja");
    expect(card).toContain("target/");
  });

  it("names the package manager and scripts for a Node app", () => {
    const card = buildCodebaseCard({
      entryNames: ["package.json", "pnpm-lock.yaml", "src"],
      topDirs: ["src", "test"],
      packageJson: JSON.stringify({
        name: "demo-app",
        scripts: { test: "vitest", lint: "eslint .", build: "tsc" },
      }),
    });
    expect(card).toContain("Codebase Card");
    expect(card).toContain("demo-app");
    expect(card).toContain("pnpm");
    expect(card).toContain("pnpm test --silent");
    expect(card).toContain("lint");
    expect(card).toContain("build");
    expect(card).not.toContain("pnpm-lock.yaml contents");
  });

  it("describes pytest/ruff for a Python tree", () => {
    const card = buildCodebaseCard({
      entryNames: ["pyproject.toml", "pytest.ini", "src"],
      pyproject: "[tool.ruff]\nline-length = 100\n",
    });
    expect(card).toMatch(/Python/i);
    expect(card).toContain("pytest");
    expect(card).toContain("ruff");
  });

  it("names go test for a Go module", () => {
    const card = buildCodebaseCard({
      entryNames: ["go.mod", "go.sum"],
    });
    expect(card).toContain("go test ./...");
  });

  it("describes CMake without make mrproper", () => {
    const card = buildCodebaseCard({
      entryNames: ["CMakeLists.txt", "src"],
    });
    expect(card).toMatch(/CMake/i);
    expect(card).toContain("cmake --build build");
    expect(card).not.toMatch(/mrproper/);
  });

  it("describes this editor fork", () => {
    const card = buildCodebaseCard({
      entryNames: ["package.json", "src", "extensions", "product.json", "scripts"],
    });
    expect(card).toContain("KnoxCoder");
    expect(card).toContain("gulp compile-extension:knox");
    expect(card).toContain("scripts/code.sh");
  });
});

describe("parseCargoManifest", () => {
  it("reads package name, edition, and workspace member names", () => {
    const parsed = parseCargoManifest(`
[package]
name = "demo"
edition = "2024"

[workspace]
members = [
  "crates/alpha",
  "crates/beta",
]
`);
    expect(parsed.name).toBe("demo");
    expect(parsed.edition).toBe("2024");
    expect(parsed.workspaceMembers).toEqual(["alpha", "beta"]);
  });
});

describe("inferArchFromConfig", () => {
  it("reads ARCH from .config symbols without dumping the file", () => {
    expect(inferArchFromConfig("CONFIG_ARM64=y\n")).toBe("arm64");
    expect(inferArchFromConfig("# comment\n")).toBeUndefined();
  });
});
