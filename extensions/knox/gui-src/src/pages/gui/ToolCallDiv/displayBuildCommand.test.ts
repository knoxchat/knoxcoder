import { describe, expect, it } from "vitest";

import { displayBuildCommand } from "./displayBuildCommand";

describe("displayBuildCommand", () => {
  it("previews cargo check from action + extraArgs", () => {
    expect(
      displayBuildCommand({ action: "check", extraArgs: "--release" }),
    ).toBe("cargo check --release");
  });

  it("prefers an explicit command override", () => {
    expect(
      displayBuildCommand({
        command: "cargo check -p foo",
        action: "check",
      }),
    ).toBe("cargo check -p foo");
  });

  it("previews rustc --explain and rustdoc lookup", () => {
    expect(displayBuildCommand({ explain: "error[E0502]" })).toBe(
      "rustc --explain E0502",
    );
    expect(displayBuildCommand({ action: "doc", doc: "tokio::sync::Mutex" })).toBe(
      "rustdoc tokio::sync::Mutex",
    );
  });

  it("falls back to project build", () => {
    expect(displayBuildCommand(undefined)).toBe("project build");
    expect(displayBuildCommand({})).toBe("project build");
  });
});
