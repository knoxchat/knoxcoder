import { describe, expect, it } from "vitest";

import type { ContextItem } from "../../index.js";
import {
  LSP_CLEAN_MARKER,
  deriveEditOracle,
  oracleFromBuildEvent,
  oracleKindForCommand,
} from "./oracleVerdict.js";

const item = (name: string, content: string): ContextItem => ({
  name,
  description: "",
  content,
});

describe("deriveEditOracle", () => {
  it("returns undefined when nothing verified the edit", () => {
    expect(deriveEditOracle([])).toBeUndefined();
    expect(deriveEditOracle([item("edit", "updated")])).toBeUndefined();
  });

  it("never treats skipped, refused, or errored verification as a pass", () => {
    expect(
      deriveEditOracle([
        item("Auto-Verification Skipped", "Skipped LSP auto-verification"),
        item("Auto-Verification Error", "Auto-verification failed"),
        item("Build verification", "refused: make clean"),
      ]),
    ).toBeUndefined();
  });

  it("reads a passing build oracle line", () => {
    expect(
      deriveEditOracle([item("Oracle", "oracle: cargo check -> pass")]),
    ).toEqual({ kind: "build", passed: true, command: "cargo check" });
  });

  it("classifies test commands as test oracles", () => {
    expect(
      deriveEditOracle([item("Oracle", "oracle: npx vitest run -> pass (exit 0)")]),
    ).toMatchObject({ kind: "test", passed: true });
    expect(oracleKindForCommand("make -j8")).toBe("build");
    expect(oracleKindForCommand("go test ./...")).toBe("test");
  });

  it("reads a failing oracle", () => {
    expect(
      deriveEditOracle([item("Oracle", "oracle: make -> fail (3 errors)")]),
    ).toMatchObject({ kind: "build", passed: false, command: "make" });
  });

  it("reads the LSP clean marker and 'now clean' result as pass", () => {
    expect(
      deriveEditOracle([item("Auto-Verification Result", LSP_CLEAN_MARKER)]),
    ).toEqual({ kind: "lsp", passed: true });
    expect(
      deriveEditOracle([
        item(
          "Auto-Verification Result",
          "Auto-verification: fixed 2 diagnostic issue(s) in 1 iteration(s). File is now clean.",
        ),
      ]),
    ).toMatchObject({ kind: "lsp", passed: true });
  });

  it("reads remaining LSP issues as fail", () => {
    expect(
      deriveEditOracle([
        item(
          "Auto-Verification Result",
          "Auto-verification: 1 diagnostic issue(s) detected but could not be auto-fixed: Line 3: x",
        ),
      ]),
    ).toMatchObject({ kind: "lsp", passed: false });
  });

  it("any failure wins over a pass", () => {
    expect(
      deriveEditOracle([
        item("Auto-Verification Result", LSP_CLEAN_MARKER),
        item("Oracle", "oracle: make -> fail (1 error)"),
      ]),
    ).toMatchObject({ passed: false, command: "make" });
  });
});

describe("oracleFromBuildEvent", () => {
  it("maps build events and ignores others", () => {
    expect(oracleFromBuildEvent("build:pass", "ok")).toEqual({
      kind: "build",
      passed: true,
    });
    expect(oracleFromBuildEvent("build:fail", "sig")).toEqual({
      kind: "build",
      passed: false,
      signature: "sig",
    });
    expect(oracleFromBuildEvent("qemu:panic", "rip")).toBeUndefined();
    expect(oracleFromBuildEvent("bisect:step", "3")).toBeUndefined();
  });
});
