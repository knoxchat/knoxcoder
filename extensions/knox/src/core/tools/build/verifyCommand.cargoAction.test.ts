import { describe, expect, it } from "vitest";

import {
  CARGO_CLIPPY_COMMAND,
  CARGO_FMT_COMMAND,
  CARGO_TEST_COMMAND,
  composeCargoActionCommand,
} from "./verifyCommand";

describe("composeCargoActionCommand (RL-41–43)", () => {
  it("composes clippy -D warnings without --all-features", () => {
    const command = composeCargoActionCommand("clippy", { target: "foo" });
    expect(command).toContain("cargo clippy");
    expect(command).toContain("-p foo");
    expect(command).not.toContain("--workspace");
    expect(command).toContain("-D warnings");
    expect(command).not.toContain("--all-features");
    expect(CARGO_CLIPPY_COMMAND).toContain("-D warnings");
  });

  it("composes fmt --check and workspace tests", () => {
    expect(composeCargoActionCommand("fmt")).toBe(CARGO_FMT_COMMAND);
    expect(composeCargoActionCommand("test")).toBe(CARGO_TEST_COMMAND);
    expect(composeCargoActionCommand("test", { target: "mini_rust" })).toBe(
      "cargo test -p mini_rust",
    );
    expect(composeCargoActionCommand("doc")).toBeUndefined();
  });

  it("composes optional supply-chain / rustfix / expand actions", () => {
    expect(composeCargoActionCommand("deny")).toBe("cargo deny check");
    expect(composeCargoActionCommand("audit")).toBe("cargo audit");
    expect(composeCargoActionCommand("tree")).toBe("cargo tree");
    expect(composeCargoActionCommand("expand", { target: "foo" })).toBe(
      "cargo expand -p foo",
    );
    expect(composeCargoActionCommand("fix")).toBe("cargo fix --allow-dirty");
  });
});
