import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bundledGateScriptPath,
  composeFallbackGateCommand,
  composeGateScriptCommand,
  formatGateVerdict,
  gateRed,
  gateRefusedReason,
  looksLikeCargoGateScript,
  parseGateResult,
  readBundledGateScript,
  resolveGateMode,
  RUST_GATE_SCRIPT,
} from "./rustGate";

describe("resolveGateMode", () => {
  it("defaults to full and accepts quick/strict", () => {
    expect(resolveGateMode(undefined)).toBe("full");
    expect(resolveGateMode("nonsense")).toBe("full");
    expect(resolveGateMode(" Quick ")).toBe("quick");
    expect(resolveGateMode("STRICT")).toBe("strict");
  });
});

describe("gateRefusedReason", () => {
  it("refuses git-hook management flags", () => {
    expect(gateRefusedReason("--install-hook")).toMatch(/git hooks/);
    expect(gateRefusedReason("--quick --uninstall-hook")).toMatch(/user's decision/);
    expect(gateRefusedReason("--from-hook")).toBeDefined();
    expect(gateRefusedReason("--quick --offline")).toBeUndefined();
    expect(gateRefusedReason("")).toBeUndefined();
  });
});

describe("composeGateScriptCommand", () => {
  it("maps modes to script flags", () => {
    expect(composeGateScriptCommand({ mode: "full" })).toBe(
      `bash ${RUST_GATE_SCRIPT}`,
    );
    expect(composeGateScriptCommand({ mode: "quick" })).toBe(
      `bash ${RUST_GATE_SCRIPT} --quick`,
    );
    expect(composeGateScriptCommand({ mode: "strict", fix: true })).toBe(
      `bash ${RUST_GATE_SCRIPT} --strict --fix`,
    );
  });

  it("passes only plain --flags from extraArgs (no shell injection)", () => {
    const command = composeGateScriptCommand({
      mode: "quick",
      extraArgs: "--offline --dir=crates/a ; rm -rf / $(whoami) --keep-going",
    });
    expect(command).toBe(
      `bash ${RUST_GATE_SCRIPT} --quick --offline --dir=crates/a --keep-going`,
    );
    expect(command).not.toMatch(/rm -rf|\$\(|;/);
  });
});

describe("composeFallbackGateCommand", () => {
  it("chains fmt → check → clippy → test for full", () => {
    const command = composeFallbackGateCommand({ mode: "full" });
    const order = [
      "cargo fmt --all -- --check",
      "cargo check --workspace --all-targets",
      "cargo clippy --workspace --all-targets",
      "-D warnings",
      "cargo test --workspace",
    ].map((part) => command.indexOf(part));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(command.split(" && ")).toHaveLength(4);
  });

  it("quick has no tests; strict adds doc and extra lints", () => {
    expect(composeFallbackGateCommand({ mode: "quick" })).not.toContain(
      "cargo test",
    );
    const strict = composeFallbackGateCommand({ mode: "strict" });
    expect(strict).toContain("cargo test --workspace");
    expect(strict).toContain("RUSTDOCFLAGS=\"-D warnings\" cargo doc");
    expect(strict).toContain("clippy::undocumented_unsafe_blocks");
  });

  it("honours fix and offline", () => {
    const command = composeFallbackGateCommand({
      mode: "quick",
      fix: true,
      offline: true,
    });
    expect(command.startsWith("cargo fmt --all && cargo fmt --all -- --check")).toBe(
      true,
    );
    expect(command).toContain("cargo check --workspace --all-targets --offline");
  });
});

describe("looksLikeCargoGateScript", () => {
  it("accepts cargo pre-commit scripts, rejects unrelated ones", () => {
    expect(looksLikeCargoGateScript("#!/bin/sh\ncargo fmt --check --quick\n")).toBe(true);
    expect(looksLikeCargoGateScript("#!/bin/sh\nnpm run lint\n")).toBe(false);
    expect(looksLikeCargoGateScript("")).toBe(false);
  });
});

describe("parseGateResult / gateRed / formatGateVerdict", () => {
  const pass = "noise\nknox-gate: PASS mode=full crates=1 steps=6\n";
  const fail =
    "noise\nknox-gate: FAIL mode=quick crates=2 failed=fmt[a],clippy[b]\n";

  it("parses the machine-readable line", () => {
    expect(parseGateResult(pass)).toMatchObject({ status: "pass", failedSteps: [] });
    expect(parseGateResult(fail)).toMatchObject({
      status: "fail",
      failedSteps: ["fmt[a]", "clippy[b]"],
    });
    expect(parseGateResult("knox-gate: SKIP reason=x").status).toBe("skip");
    expect(parseGateResult("nothing").status).toBe("unknown");
  });

  it("gateRed is true for FAIL or a non-zero exit without a result line", () => {
    expect(gateRed(pass)).toBe(false);
    expect(gateRed(fail)).toBe(true);
    expect(gateRed("Exit: 101")).toBe(true);
    expect(gateRed("all quiet")).toBe(false);
  });

  it("verdict never lets a failure read as done", () => {
    const red = formatGateVerdict(fail, { usedScript: true, mode: "quick" });
    expect(red.description).toBe("fail");
    expect(red.content).toContain("FAILED (quick): fmt[a], clippy[b]");
    expect(red.content).toMatch(/Do not claim done/);
    expect(red.content).toMatch(/Do not edit or delete tests/);

    const green = formatGateVerdict(pass, { usedScript: true, mode: "full" });
    expect(green.description).toBe("pass");
    expect(green.content).toContain("PASSED (full)");

    const unknown = formatGateVerdict("no result", {
      usedScript: false,
      mode: "full",
    });
    expect(unknown.description).toBe("unknown");
    expect(unknown.content).toMatch(/do not assume it passed/i);

    // Inline fallback: exit code is the only signal.
    const inlineGreen = formatGateVerdict("Exit: 0\nDuration: 5ms", {
      usedScript: false,
      mode: "full",
    });
    expect(inlineGreen.description).toBe("pass");
    const inlineRed = formatGateVerdict("Exit: 101", {
      usedScript: false,
      mode: "full",
    });
    expect(inlineRed.description).toBe("fail");
    // A script that printed nothing and exited 0 is NOT trusted.
    expect(
      formatGateVerdict("Exit: 0", { usedScript: true, mode: "full" })
        .description,
    ).toBe("unknown");
  });
});

describe("bundled gate script", () => {
  it("ships with the rust skill and is executable-shaped", () => {
    expect(fs.existsSync(bundledGateScriptPath())).toBe(true);
    const script = readBundledGateScript();
    expect(script?.startsWith("#!/usr/bin/env bash")).toBe(true);
    for (const flag of [
      "--quick",
      "--strict",
      "--fix",
      "--install-hook",
      "--keep-going",
      "--offline",
      "--from-hook",
    ]) {
      expect(script).toContain(flag);
    }
    for (const cmd of [
      "fmt --all -- --check",
      "check --workspace",
      "clippy --workspace",
      "-D warnings",
      "test --workspace",
    ]) {
      expect(script).toContain(cmd);
    }
    expect(script).toContain("knox-gate: PASS");
    expect(script).toContain("knox-gate: FAIL");
  });
});
