import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  finalizeNewCargoProject,
  parseCargoNewCommand,
  planCargoNewFinalize,
} from "./rustNewProject";
import { RUST_DEFAULT_VERSION } from "./rustDefaults";

const CARGO_NEW_OUTPUT = `[package]
name = "snake"
version = "0.1.0"
edition = "2024"

[dependencies]
`;

describe("parseCargoNewCommand", () => {
  it("finds the target path for new and init", () => {
    expect(parseCargoNewCommand("cargo new snake")?.targetArg).toBe("snake");
    expect(
      parseCargoNewCommand("cargo new --edition 2024 --name foo apps/bar")
        ?.targetArg,
    ).toBe("apps/bar");
    expect(parseCargoNewCommand("cargo init")?.targetArg).toBe(".");
    expect(parseCargoNewCommand("cargo +nightly init --lib pkg")?.targetArg).toBe(
      "pkg",
    );
  });

  it("handles a leading cd and chained commands", () => {
    const parsed = parseCargoNewCommand("cd work && cargo new snake && cargo build");
    expect(parsed?.cdArg).toBe("work");
    expect(parsed?.targetArg).toBe("snake");
  });

  it("ignores other cargo commands and cargo new without a path", () => {
    expect(parseCargoNewCommand("cargo check")).toBeUndefined();
    expect(parseCargoNewCommand("cargo new --lib")).toBeUndefined();
  });
});

describe("finalizeNewCargoProject", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cargo-new-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Plan, then simulate what `cargo new <name>` writes. */
  function simulateCargoNew(command: string, name: string) {
    const plan = planCargoNewFinalize(command, root, root);
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Cargo.toml"), CARGO_NEW_OUTPUT);
    return { plan, dir };
  }

  it("adds rust-version and rust-toolchain.toml to a brand-new crate", () => {
    const { plan, dir } = simulateCargoNew("cargo new snake", "snake");
    expect(plan?.manifestExisted).toBe(false);
    const note = finalizeNewCargoProject(plan!);
    expect(note).toMatch(/pinned the new crate/);

    const manifest = fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
    expect(manifest).toContain('edition = "2024"');
    expect(manifest).toContain(`rust-version = "${RUST_DEFAULT_VERSION}"`);
    expect(manifest).toContain('name = "snake"');
    expect(fs.readFileSync(path.join(dir, "rust-toolchain.toml"), "utf8")).toContain(
      `channel = "${RUST_DEFAULT_VERSION}"`,
    );
  });

  it("does not touch a project whose Cargo.toml already existed", () => {
    const dir = path.join(root, "old");
    fs.mkdirSync(dir, { recursive: true });
    const legacy = '[package]\nname = "old"\nedition = "2021"\nrust-version = "1.70"\n';
    fs.writeFileSync(path.join(dir, "Cargo.toml"), legacy);
    fs.writeFileSync(path.join(dir, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.70.0"\n');

    const plan = planCargoNewFinalize("cargo init old", root, root);
    expect(plan?.manifestExisted).toBe(true);
    expect(finalizeNewCargoProject(plan!)).toBe("");
    expect(fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8")).toBe(legacy);
    expect(fs.readFileSync(path.join(dir, "rust-toolchain.toml"), "utf8")).toContain(
      "1.70.0",
    );
  });

  it("keeps an existing rust-version on a new crate", () => {
    const plan = planCargoNewFinalize("cargo new snake", root, root);
    const dir = path.join(root, "snake");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "Cargo.toml"),
      `${CARGO_NEW_OUTPUT}`.replace('edition = "2024"', 'edition = "2024"\nrust-version = "1.90"'),
    );
    finalizeNewCargoProject(plan!);
    const manifest = fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
    expect(manifest).toContain('rust-version = "1.90"');
    expect(manifest).not.toContain(`rust-version = "${RUST_DEFAULT_VERSION}"`);
  });

  it("does not shadow a parent workspace rust-toolchain file", () => {
    fs.writeFileSync(
      path.join(root, "rust-toolchain.toml"),
      '[toolchain]\nchannel = "1.80.0"\n',
    );
    const { plan, dir } = simulateCargoNew("cargo new snake", "snake");
    finalizeNewCargoProject(plan!);
    expect(fs.existsSync(path.join(dir, "rust-toolchain.toml"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8")).toContain(
      `rust-version = "${RUST_DEFAULT_VERSION}"`,
    );
  });

  it("does nothing when the command failed to create Cargo.toml", () => {
    const plan = planCargoNewFinalize("cargo new ghost", root, root);
    expect(finalizeNewCargoProject(plan!)).toBe("");
    expect(fs.existsSync(path.join(root, "ghost"))).toBe(false);
  });
});
