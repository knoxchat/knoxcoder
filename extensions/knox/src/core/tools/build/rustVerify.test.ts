import { describe, expect, it } from "vitest";

import {
  cargoOracleRed,
  cargoPackageForEditedPath,
  resolveRustIsLib,
  rustClippyCommand,
  rustOuterVerifyCommands,
  rustTestCommand,
} from "./rustVerify";
import {
  composeBuildCommand,
  destructiveBuildReason,
  resetBuildVerifyCircuits,
  runPostEditBuildVerify,
} from "./verifyCommand";

describe("cargoPackageForEditedPath (RL-47)", () => {
  it("maps a workspace member path to -p name", () => {
    expect(cargoPackageForEditedPath("crates/foo/src/lib.rs")).toBe("foo");
    expect(cargoPackageForEditedPath("crates/foo/Cargo.toml")).toBe("foo");
    expect(cargoPackageForEditedPath("foo/src/lib.rs")).toBe("foo");
    expect(cargoPackageForEditedPath("src/lib.rs")).toBeUndefined();
  });
});

describe("rustOuterVerifyCommands", () => {
  it("runs fmt then clippy without --all-features", () => {
    const stages = rustOuterVerifyCommands({
      filePath: "crates/foo/src/lib.rs",
      isLib: true,
    });
    expect(stages[0]).toBe("cargo fmt --check");
    expect(stages[1]).toContain("cargo clippy");
    expect(stages[1]).toContain("-p foo");
    expect(stages[1]).not.toMatch(/--workspace.*-p |-p .*--workspace/);
    expect(stages[1]).not.toContain("--workspace");
    expect(stages[1]).toContain("-D warnings");
    expect(stages[1]).toContain("clippy::unwrap_used");
    expect(stages[1]).not.toContain("--all-features");
  });
});

describe("cargoOracleRed / rustTestCommand", () => {
  it("treats rustfmt diffs and clippy -D errors as red", () => {
    expect(cargoOracleRed("Exit: 0\n")).toBe(false);
    expect(cargoOracleRed("Exit: 1\nDiff in src/lib.rs:\n")).toBe(true);
    expect(
      cargoOracleRed("error: used unwrap()\n  = note: `#[deny(clippy::unwrap_used)]`"),
    ).toBe(true);
    expect(rustTestCommand({ docTests: true, packageName: "mini_rust" })).toBe(
      "cargo test -p mini_rust --doc",
    );
    expect(rustTestCommand()).toBe("cargo test --workspace");
  });
});

describe("rustClippyCommand", () => {
  it("keeps workspace clippy as the default lint oracle", () => {
    expect(rustClippyCommand()).toContain("--workspace");
    expect(rustClippyCommand()).toContain("-D warnings");
    expect(rustClippyCommand()).not.toContain("--all-features");
  });
});

describe("resolveRustIsLib", () => {
  it("treats lib.rs / [lib] / existing src/lib.rs as a library crate", () => {
    expect(resolveRustIsLib({ filePath: "src/lib.rs" })).toBe(true);
    expect(resolveRustIsLib({ cargoToml: "[lib]\npath = \"src/lib.rs\"\n" })).toBe(
      true,
    );
    expect(resolveRustIsLib({ libRsExists: true })).toBe(true);
    expect(resolveRustIsLib({ filePath: "src/main.rs" })).toBe(false);
  });
});

describe("runPostEditBuildVerify rust stages (RL-41/42)", () => {
  it("after a green cargo check runs fmt then clippy -p member", async () => {
    resetBuildVerifyCircuits();
    const ran: string[] = [];
    const items = await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "cargo check --workspace --all-targets",
      filePath: "crates/foo/src/lib.rs",
      isLib: true,
      run: async (command) => {
        ran.push(command);
        if (command.includes("clippy")) {
          return [
            {
              name: "Build",
              description: "exited 1",
              content: [
                `Command: ${command}`,
                "Exit: 1",
                "error: used `unwrap()` on a `Result` value",
                " --> crates/foo/src/lib.rs:3:5",
                "  = note: `#[deny(clippy::unwrap_used)]`",
              ].join("\n"),
            },
          ];
        }
        return [
          {
            name: "Build",
            description: "ok",
            content: `Command: ${command}\nExit: 0\n`,
          },
        ];
      },
    });
    expect(ran[0]).toContain("cargo check");
    expect(ran[1]).toBe("cargo fmt --check");
    expect(ran[2]).toContain("clippy");
    expect(ran[2]).toContain("-p foo");
    expect(items.map((item) => item.content).join("\n")).toMatch(
      /unwrap_used|unwrap\(\)/,
    );
  });

  it("does not run fmt/clippy while cargo check is red", async () => {
    resetBuildVerifyCircuits();
    const ran: string[] = [];
    await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "cargo check --workspace --all-targets",
      run: async (command) => {
        ran.push(command);
        return [
          {
            name: "Build",
            description: "exited 1",
            content:
              "Command: cargo check\nExit: 1\nerror[E0425]: cannot find value `foo`\n --> src/lib.rs:2:5\n",
          },
        ];
      },
    });
    expect(ran).toEqual(["cargo check --workspace --all-targets --message-format=json-diagnostic-rendered-ansi"]);
  });

  it("appends a miri reminder when unsafe was touched", async () => {
    resetBuildVerifyCircuits();
    const items = await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "cargo check --workspace --all-targets",
      filePath: "src/lib.rs",
      unsafeTouched: true,
      staged: false,
      run: async (command) => [
        {
          name: "Build",
          description: "ok",
          content: `Command: ${command}\nExit: 0\n`,
        },
      ],
    });
    expect(items.map((item) => item.content).join("\n")).toMatch(
      /This edit touched `unsafe`/,
    );
  });

  it("refuses cargo fix --broken-code", () => {
    expect(
      destructiveBuildReason("cargo fix --allow-dirty --broken-code"),
    ).toMatch(/broken-code/);
  });

  it("composes -p from an edited member path", () => {
    expect(
      composeBuildCommand(
        { target: "crates/foo/src/lib.rs" },
        "cargo check --workspace --all-targets",
      ),
    ).toContain("-p foo");
  });
});

describe("cargo oracle is gated on Rust-related edits", () => {
  const okRun = (ran: string[]) => async (command: string) => {
    ran.push(command);
    return [
      { name: "Build", description: "ok", content: `Command: ${command}\nExit: 0\n` },
    ];
  };

  it.each(["index.html", "styles.css", "script.js", "README.md", "web/app.tsx"])(
    "does not run cargo after editing %s",
    async (filePath) => {
      resetBuildVerifyCircuits();
      const ran: string[] = [];
      const items = await runPostEditBuildVerify({
        toolName: "builtin_edit_file",
        command: "cargo check --workspace --all-targets",
        filePath,
        run: okRun(ran),
      });
      expect(ran).toEqual([]);
      expect(items).toEqual([]);
    },
  );

  it.each(["src/main.rs", "crates/foo/src/lib.rs", "Cargo.toml", "cli/Cargo.toml", "build.rs"])(
    "still runs cargo check -> fmt -> clippy after editing %s",
    async (filePath) => {
      resetBuildVerifyCircuits();
      const ran: string[] = [];
      await runPostEditBuildVerify({
        toolName: "builtin_edit_file",
        command: "cargo check --workspace --all-targets",
        filePath,
        run: okRun(ran),
      });
      expect(ran[0]).toContain("cargo check");
      expect(ran[1]).toBe("cargo fmt --check");
      expect(ran[2]).toContain("clippy");
    },
  );
});
