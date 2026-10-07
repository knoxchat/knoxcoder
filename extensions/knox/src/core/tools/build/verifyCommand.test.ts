import { describe, expect, it } from "vitest";
import type { IDE } from "../..";

import {
  attachBuildDiagnostics,
  BuildErrorCircuit,
  CARGO_CHECK_COMMAND,
  CARGO_JSON_MESSAGE_FORMAT,
  composeBuildCommand,
  detectBuildCommand,
  destructiveBuildReason,
  resolveVerifyMode,
  runPostEditBuildVerify,
} from "./verifyCommand";

describe("composeBuildCommand", () => {
  it("adds -j, target, and kbuild env", () => {
    expect(
      composeBuildCommand(
        {
          jobs: 8,
          target: "net/ipv4/",
          env: { ARCH: "x86_64", CROSS_COMPILE: "x86_64-linux-gnu-" },
        },
        "make",
      ),
    ).toBe("ARCH=x86_64 CROSS_COMPILE=x86_64-linux-gnu- make -j8 net/ipv4/");
  });

  it("uses an explicit command override", () => {
    expect(composeBuildCommand({ command: "ninja -C build" })).toBe(
      "ninja -C build",
    );
  });

  it("composes cargo check with -j, -p, extraArgs, and JSON diagnostics", () => {
    expect(
      composeBuildCommand(
        { jobs: 8, target: "mini-rust", extraArgs: "--features foo" },
        CARGO_CHECK_COMMAND,
      ),
    ).toBe(
      `${CARGO_CHECK_COMMAND} -j8 -p mini-rust --features foo ${CARGO_JSON_MESSAGE_FORMAT}`,
    );
  });

  it("appends JSON format to an explicit cargo check override", () => {
    expect(composeBuildCommand({ command: "cargo check" })).toBe(
      `cargo check ${CARGO_JSON_MESSAGE_FORMAT}`,
    );
  });
});

describe("destructiveBuildReason", () => {
  it("refuses clean / mrproper", () => {
    expect(destructiveBuildReason("make clean")).toMatch(/clean/);
    expect(destructiveBuildReason("make mrproper")).toMatch(/mrproper/);
    expect(destructiveBuildReason("make -j8 net/ipv4/")).toBeUndefined();
  });

  it("refuses cargo clean / publish / login / yank", () => {
    expect(destructiveBuildReason("cargo clean")).toMatch(/cargo clean/);
    expect(destructiveBuildReason("cargo publish --allow-dirty")).toMatch(
      /publish/,
    );
    expect(destructiveBuildReason("cargo login")).toMatch(/login/);
    expect(destructiveBuildReason("cargo yank -p foo --version 1.0.0")).toMatch(
      /yank/,
    );
    expect(destructiveBuildReason("cargo check --workspace")).toBeUndefined();
  });
});

describe("resolveVerifyMode", () => {
  it("treats a set command as the compile oracle", () => {
    expect(resolveVerifyMode(undefined, "make -j8")).toBe("command");
    expect(resolveVerifyMode("diagnostics", "make")).toBe("command");
    expect(resolveVerifyMode("diagnostics", "")).toBe("diagnostics");
    expect(resolveVerifyMode("off", "make")).toBe("off");
  });
});

describe("detectBuildCommand", () => {
  it("prefers Makefile then ninja", async () => {
    const files = new Set(["file:///tmp/ws/Makefile"]);
    const ide = {
      getWorkspaceDirs: async () => ["file:///tmp/ws"],
      fileExists: async (uri: string) => files.has(uri),
    } as unknown as IDE;
    expect(await detectBuildCommand(ide)).toBe("make");
    files.clear();
    files.add("file:///tmp/ws/build.ninja");
    expect(await detectBuildCommand(ide)).toBe("ninja");
  });

  it("detects cargo check from a Cargo.toml-only crate", async () => {
    const ide = {
      getWorkspaceDirs: async () => ["file:///tmp/crate"],
      listDir: async () => [
        ["Cargo.toml", 1],
        ["src", 2],
      ],
      fileExists: async (uri: string) => uri.endsWith("/Cargo.toml"),
    } as unknown as IDE;
    expect(await detectBuildCommand(ide)).toBe(CARGO_CHECK_COMMAND);
  });

  it("prefers cargo over an incidental Makefile in a pure crate", async () => {
    const ide = {
      getWorkspaceDirs: async () => ["file:///tmp/crate"],
      listDir: async () => [
        ["Cargo.toml", 1],
        ["Makefile", 1],
        ["src", 2],
      ],
      fileExists: async () => true,
    } as unknown as IDE;
    expect(await detectBuildCommand(ide)).toBe(CARGO_CHECK_COMMAND);
  });

  it("keeps make on a kernel tree that also has Cargo.toml", async () => {
    const ide = {
      getWorkspaceDirs: async () => ["file:///tmp/linux"],
      listDir: async () => [
        ["Kconfig", 1],
        ["Makefile", 1],
        ["arch", 2],
        ["Cargo.toml", 1],
      ],
      fileExists: async (uri: string) =>
        uri.endsWith("/Makefile") || uri.endsWith("/Cargo.toml"),
    } as unknown as IDE;
    expect(await detectBuildCommand(ide)).toBe("make");
  });

  it("detects a Cargo.toml in a later workspace root", async () => {
    const ide = {
      getWorkspaceDirs: async () => ["file:///tmp/docs", "file:///tmp/crate"],
      listDir: async (uri: string) =>
        uri.includes("/crate")
          ? [
              ["Cargo.toml", 1],
              ["src", 2],
            ]
          : [["README.md", 1]],
      fileExists: async (uri: string) => uri === "file:///tmp/crate/Cargo.toml",
    } as unknown as IDE;
    expect(await detectBuildCommand(ide)).toBe(CARGO_CHECK_COMMAND);
  });
});

describe("BuildErrorCircuit", () => {
  it("trips after N identical error signatures", () => {
    const circuit = new BuildErrorCircuit(2);
    expect(circuit.observe("err:a").tripped).toBe(false);
    expect(circuit.observe("err:a").tripped).toBe(true);
    expect(circuit.observe("ok").tripped).toBe(false);
  });
});

describe("runPostEditBuildVerify", () => {
  it("appends parsed gcc errors after an edit", async () => {
    const items = await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "make",
      maxIterations: 8,
      circuitKey: "test-edit-verify",
      run: async () => [
        {
          name: "Build",
          description: "exited 1",
          content:
            "Command: make\nExit: 1\nsrc/foo.c:2:3: error: implicit declaration of function 'bar'\n",
        },
      ],
    });
    expect(items.some((item) => item.name === "Build diagnostics")).toBe(true);
    expect(items.map((item) => item.content).join("\n")).toContain("src/foo.c:2:3");
  });

  it("skips after identical signatures hit the cap", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      return [
        {
          name: "Build",
          description: "exited 1",
          content: "src/foo.c:1:1: error: boom\n",
        },
      ];
    };
    await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "make",
      maxIterations: 2,
      circuitKey: "test-circuit",
      run,
    });
    await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "make",
      maxIterations: 2,
      circuitKey: "test-circuit",
      run,
    });
    const skipped = await runPostEditBuildVerify({
      toolName: "builtin_edit_file",
      command: "make",
      maxIterations: 2,
      circuitKey: "test-circuit",
      run,
    });
    expect(runs).toBe(2);
    expect(skipped[0]?.description).toMatch(/circuit/);
  });
});

describe("attachBuildDiagnostics", () => {
  it("labels a clean log", () => {
    const items = attachBuildDiagnostics([
      { name: "Build", description: "ok", content: "Exit: 0\n  CC foo.o\n" },
    ]);
    expect(items.at(-1)?.description).toBe("clean");
  });
});
