import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureCargoTargetIgnored,
  findCargoTargetRoot,
  gitignoreCoversCargoTarget,
  shellInvokesCargo,
  withCargoTargetIgnored,
} from "./rustGitignore";

describe("shellInvokesCargo", () => {
  it("detects cargo anywhere in a chain", () => {
    expect(shellInvokesCargo("cargo build")).toBe(true);
    expect(shellInvokesCargo("cd app && cargo +nightly test")).toBe(true);
    expect(shellInvokesCargo("FOO=1 cargo check; ls")).toBe(true);
    expect(shellInvokesCargo("echo cargoish")).toBe(false);
    expect(shellInvokesCargo("ls -la")).toBe(false);
  });

  it("treats the Rust gate script as a cargo run (it builds target/)", () => {
    expect(shellInvokesCargo("bash scripts/pre-commit.sh --quick")).toBe(true);
    expect(shellInvokesCargo("./scripts/pre-commit.sh")).toBe(true);
    expect(shellInvokesCargo("cd app && sh app/scripts/pre-commit.sh")).toBe(true);
    expect(shellInvokesCargo("cat scripts/pre-commit.sh.bak")).toBe(false);
    expect(shellInvokesCargo("git commit -m pre-commit")).toBe(false);
  });
});

describe("gitignoreCoversCargoTarget", () => {
  it("accepts the usual spellings", () => {
    for (const rule of ["target", "target/", "/target", "/target/", "**/target", "target/*"]) {
      expect(gitignoreCoversCargoTarget(`${rule}\n`)).toBe(true);
    }
  });

  it("ignores comments, unrelated rules and lookalikes", () => {
    expect(gitignoreCoversCargoTarget("# target\n*.log\n")).toBe(false);
    expect(gitignoreCoversCargoTarget("targets/\nmy-target\n")).toBe(false);
  });

  it("lets a later negation win", () => {
    expect(gitignoreCoversCargoTarget("target/\n!target\n")).toBe(false);
    expect(gitignoreCoversCargoTarget("!target\ntarget/\n")).toBe(true);
  });

  it("resolves anchored rules relative to the crate", () => {
    expect(gitignoreCoversCargoTarget("/app/target/\n", "app")).toBe(true);
    expect(gitignoreCoversCargoTarget("/target/\n", "app")).toBe(false);
    expect(gitignoreCoversCargoTarget("app/target\n", "app")).toBe(true);
  });
});

describe("withCargoTargetIgnored", () => {
  it("creates, appends, or leaves alone", () => {
    expect(withCargoTargetIgnored(undefined)).toBe("/target/\n");
    expect(withCargoTargetIgnored("")).toBe("/target/\n");
    expect(withCargoTargetIgnored("*.log")).toBe("*.log\n/target/\n");
    expect(withCargoTargetIgnored("*.log\n")).toBe("*.log\n/target/\n");
    expect(withCargoTargetIgnored("*.log\r\n")).toBe("*.log\r\n/target/\r\n");
    expect(withCargoTargetIgnored("/target\n")).toBeUndefined();
  });
});

describe("ensureCargoTargetIgnored", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cargo-ignore-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write = (rel: string, body: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("creates .gitignore for an existing crate that has none", () => {
    write("Cargo.toml", '[package]\nname = "a"\n');
    const note = ensureCargoTargetIgnored([root], root);
    expect(note).toMatch(/target\//);
    expect(read(".gitignore")).toBe("/target/\n");
  });

  it("appends to an existing .gitignore and is idempotent", () => {
    write("Cargo.toml", '[package]\nname = "a"\n');
    write(".gitignore", "*.log");
    expect(ensureCargoTargetIgnored([root], root)).not.toBe("");
    expect(read(".gitignore")).toBe("*.log\n/target/\n");
    expect(ensureCargoTargetIgnored([root], root)).toBe("");
    expect(read(".gitignore")).toBe("*.log\n/target/\n");
  });

  it("leaves a .gitignore that already ignores target untouched", () => {
    write("Cargo.toml", '[package]\nname = "a"\n');
    write(".gitignore", "target\n");
    expect(ensureCargoTargetIgnored([root], root)).toBe("");
    expect(read(".gitignore")).toBe("target\n");
  });

  it("does nothing outside a Cargo project", () => {
    write("package.json", "{}");
    expect(ensureCargoTargetIgnored([root], root)).toBe("");
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
  });

  it("uses the workspace root for member crates", () => {
    write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\n');
    write("crates/a/Cargo.toml", '[package]\nname = "a"\n');
    expect(findCargoTargetRoot(path.join(root, "crates/a/src"), root)).toBe(root);
    ensureCargoTargetIgnored([path.join(root, "crates/a")], root);
    expect(read(".gitignore")).toBe("/target/\n");
    expect(fs.existsSync(path.join(root, "crates/a/.gitignore"))).toBe(false);
  });

  it("respects a parent .gitignore inside the workspace", () => {
    write(".gitignore", "**/target\n");
    write("apps/snake/Cargo.toml", '[package]\nname = "snake"\n');
    expect(ensureCargoTargetIgnored([path.join(root, "apps/snake")], root)).toBe("");
    expect(fs.existsSync(path.join(root, "apps/snake/.gitignore"))).toBe(false);
  });

  it("ignores a nested crate that has no ancestor rule", () => {
    write("apps/snake/Cargo.toml", '[package]\nname = "snake"\n');
    ensureCargoTargetIgnored([path.join(root, "apps/snake")], root);
    expect(read("apps/snake/.gitignore")).toBe("/target/\n");
  });

  it("never escapes the workspace root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cargo-out-"));
    try {
      fs.writeFileSync(path.join(outside, "Cargo.toml"), '[package]\nname = "x"\n');
      expect(ensureCargoTargetIgnored([outside], root)).toBe("");
      expect(fs.existsSync(path.join(outside, ".gitignore"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
