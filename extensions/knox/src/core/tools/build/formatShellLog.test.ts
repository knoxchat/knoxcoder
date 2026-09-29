import { describe, expect, it } from "vitest";

import {
  compactShellBody,
  isVerboseBuildCommand,
  tailLines,
} from "./formatShellLog";

describe("isVerboseBuildCommand", () => {
  it("matches make/ninja/gcc/qemu", () => {
    expect(isVerboseBuildCommand("make -j8")).toBe(true);
    expect(isVerboseBuildCommand("ninja")).toBe(true);
    expect(isVerboseBuildCommand("gcc -c foo.c")).toBe(true);
    expect(isVerboseBuildCommand("qemu-system-x86_64 -kernel bzImage")).toBe(
      true,
    );
    expect(isVerboseBuildCommand("./configure --target-list=x86_64-softmmu")).toBe(
      true,
    );
  });

  it("does not match ordinary commands", () => {
    expect(isVerboseBuildCommand("echo hi")).toBe(false);
    expect(isVerboseBuildCommand("npm test")).toBe(false);
    expect(isVerboseBuildCommand("git status")).toBe(false);
    expect(isVerboseBuildCommand("cargo check --workspace")).toBe(true);
    expect(isVerboseBuildCommand("cargo test")).toBe(true);
    expect(isVerboseBuildCommand("cargo clippy -- -D warnings")).toBe(true);
    expect(isVerboseBuildCommand("cargo metadata")).toBe(false);
    expect(isVerboseBuildCommand("cargo fmt --check")).toBe(false);
  });
});

describe("compactShellBody", () => {
  it("returns parsed gcc errors and a tail instead of CC spam", () => {
    const spam = Array.from(
      { length: 400 },
      (_, i) => `  CC      file${i}.o`,
    ).join("\n");
    const stdout = `${spam}\nfoo.c:12:3: error: implicit declaration of function 'bar'\nmake: *** [foo] Error 1\n`;
    const text = compactShellBody({
      stdout,
      stderr: "",
      logPath: "/tmp/.knox/jobs/sh_1.log",
    });
    expect(text).toContain("foo.c:12:3");
    expect(text).toContain("Full log: /tmp/.knox/jobs/sh_1.log");
    expect(text).not.toContain("file0.o");
    expect(text.length).toBeLessThan(8_000);
  });

  it("tails the last N lines", () => {
    expect(tailLines("a\nb\nc", 2)).toBe("b\nc");
  });

  it("compacts a large cargo log while keeping the rustc E-code", () => {
    const spam = Array.from(
      { length: 400 },
      (_, i) => `   Compiling crate${i} v0.1.0`,
    ).join("\n");
    const stdout = `${spam}\nerror[E0502]: cannot borrow \`x\` as mutable\n --> src/borrow.rs:12:9\n`;
    const text = compactShellBody({
      stdout,
      stderr: "",
      logPath: "/tmp/.knox/jobs/sh_cargo.log",
    });
    expect(text).toContain("E0502");
    expect(text).toContain("src/borrow.rs:12:9");
    expect(text).toContain("Full log: /tmp/.knox/jobs/sh_cargo.log");
    expect(text).not.toContain("crate0 v0.1.0");
    expect(text.length).toBeLessThan(8_000);
  });
});
