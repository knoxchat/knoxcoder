import { describe, expect, it } from "vitest";

import {
  AGENT_PROFILE_DEFAULTS,
  detectCargoWorkspace,
  detectSystemsWorkspaceKind,
  detectWorkspaceKind,
  detectWorkspaceKindFromIde,
  isSystemsWorkspace,
  overlayAutoProfile,
  resolveAgentLoopSettings,
  resolveAgentMaxSteps,
  resolveAgentProfile,
  resolveDoomLoopThreshold,
  RUST_VERIFY_COMMAND,
  workspaceKindHints,
} from "./agentProfile";

describe("isSystemsWorkspace", () => {
  it("detects a kernel-like tree", () => {
    expect(isSystemsWorkspace(["Kconfig", "Makefile", "arch", "mm"])).toBe(
      true,
    );
    expect(isSystemsWorkspace(["Kconfig", "arch"])).toBe(true);
  });

  it("detects a QEMU-like tree", () => {
    expect(isSystemsWorkspace(["meson.build", "target", "accel"])).toBe(true);
  });

  it("does not treat a Node app Makefile as systems", () => {
    expect(isSystemsWorkspace(["package.json", "Makefile", "src"])).toBe(
      false,
    );
    expect(isSystemsWorkspace(["CMakeLists.txt", "src"])).toBe(false);
  });

  it("classifies kernel vs qemu", () => {
    expect(
      detectSystemsWorkspaceKind(["Kconfig", "Makefile", "arch"]),
    ).toBe("kernel");
    expect(
      detectSystemsWorkspaceKind(["meson.build", "target", "accel"]),
    ).toBe("qemu");
  });
});

describe("detectWorkspaceKind (RL-01)", () => {
  const fixtures: Array<{
    name: string;
    entries: string[];
    cargo: boolean;
    kind: ReturnType<typeof detectWorkspaceKind>;
    systems: boolean;
  }> = [
    {
      name: "pure crate",
      entries: ["Cargo.toml", "src", "Cargo.lock"],
      cargo: true,
      kind: "cargo",
      systems: false,
    },
    {
      name: "cargo workspace root",
      entries: ["Cargo.toml", "crates", "target"],
      cargo: true,
      kind: "cargo",
      systems: false,
    },
    {
      name: "crate with leftover Makefile",
      entries: ["Cargo.toml", "src", "Makefile"],
      cargo: true,
      kind: "cargo",
      systems: false,
    },
    {
      name: "kernel without Cargo.toml",
      entries: ["Kconfig", "Makefile", "arch", "mm"],
      cargo: false,
      kind: "kernel",
      systems: true,
    },
    {
      name: "kernel with rust/ subtree (no root Cargo.toml)",
      entries: ["Kconfig", "Makefile", "arch", "rust", "mm"],
      cargo: false,
      kind: "kernel",
      systems: true,
    },
    {
      name: "kernel with root Cargo.toml (do not steal)",
      entries: ["Kconfig", "Makefile", "arch", "Cargo.toml", "rust"],
      cargo: true,
      kind: "kernel",
      systems: true,
    },
    {
      name: "qemu",
      entries: ["meson.build", "target", "accel"],
      cargo: false,
      kind: "qemu",
      systems: true,
    },
    {
      name: "qemu with root Cargo.toml (do not steal)",
      entries: ["meson.build", "target", "accel", "Cargo.toml"],
      cargo: true,
      kind: "qemu",
      systems: true,
    },
    {
      name: "node app with leftover Makefile",
      entries: ["package.json", "Makefile", "src"],
      cargo: false,
      kind: null,
      systems: false,
    },
    {
      name: "python app",
      entries: ["pyproject.toml", "src"],
      cargo: false,
      kind: null,
      systems: false,
    },
    {
      name: "bare Makefile / CMake",
      entries: ["CMakeLists.txt", "src"],
      cargo: false,
      kind: null,
      systems: false,
    },
    {
      name: "Cargo.toml with trailing slash in listing",
      entries: ["Cargo.toml/", "src/"],
      cargo: true,
      kind: "cargo",
      systems: false,
    },
  ];

  it.each(fixtures)("$name", ({ entries, cargo, kind, systems }) => {
    expect(detectCargoWorkspace(entries)).toBe(cargo);
    expect(detectWorkspaceKind(entries)).toBe(kind);
    expect(isSystemsWorkspace(entries)).toBe(systems);
    expect(detectSystemsWorkspaceKind(entries)).toBe(
      kind === "cargo" ? null : kind,
    );
  });

  it("reads workspace root entries from the IDE", async () => {
    const kind = await detectWorkspaceKindFromIde({
      getWorkspaceDirs: async () => ["file:///tmp/crate"],
      listDir: async () => [
        ["Cargo.toml", 1],
        ["src", 2],
      ],
    });
    expect(kind).toBe("cargo");
  });

  it("returns null when listDir is missing", async () => {
    const kind = await detectWorkspaceKindFromIde({
      getWorkspaceDirs: async () => ["file:///tmp/crate"],
    });
    expect(kind).toBeNull();
  });
});

describe("resolveAgentProfile", () => {
  it("requires an explicit systems/rust or auto+detection", () => {
    expect(resolveAgentProfile(undefined)).toBe("default");
    expect(resolveAgentProfile("auto", false)).toBe("default");
    expect(resolveAgentProfile("auto", true)).toBe("systems");
    expect(resolveAgentProfile("systems", false)).toBe("systems");
    expect(resolveAgentProfile("rust")).toBe("rust");
    expect(resolveAgentProfile("auto", { cargo: true })).toBe("rust");
    expect(resolveAgentProfile("auto", { systems: true, cargo: true })).toBe(
      "systems",
    );
    expect(resolveAgentProfile("auto", { cargo: true, systems: false })).toBe(
      "rust",
    );
  });
});

describe("overlayAutoProfile", () => {
  it("lets Jev confirm auto when hints disagree", () => {
    expect(
      overlayAutoProfile(
        { agentProfile: "systems", agentProfileSetting: "auto" },
        { systems: true, cargo: true },
        "rust",
      ),
    ).toBe("rust");
  });

  it("does not override an explicit systems profile", () => {
    expect(
      overlayAutoProfile(
        { agentProfile: "systems", agentProfileSetting: "systems" },
        false,
        "rust",
      ),
    ).toBe("systems");
  });
});

describe("resolveAgentLoopSettings", () => {
  it("keeps app defaults when unset", () => {
    const loop = resolveAgentLoopSettings(undefined);
    expect(loop.profile).toBe("default");
    expect(loop.maxSteps).toBeNull();
    expect(loop.doomLoopThreshold).toBe(
      AGENT_PROFILE_DEFAULTS.default.doomLoopThreshold,
    );
    expect(loop.verifyMode).toBe("diagnostics");
    expect(loop.verifyCommand).toBe("");
  });

  it("applies systems doom-loop and make oracle without a step cap", () => {
    const loop = resolveAgentLoopSettings({ agentProfile: "systems" });
    expect(loop.maxSteps).toBeNull();
    expect(loop.doomLoopThreshold).toBe(5);
    expect(loop.verifyMode).toBe("command");
    expect(loop.verifyCommand).toBe("make");
  });

  it("applies rust defaults for explicit rust and auto+Cargo.toml", () => {
    const explicit = resolveAgentLoopSettings({ agentProfile: "rust" });
    expect(explicit.profile).toBe("rust");
    expect(explicit.maxSteps).toBeNull();
    expect(explicit.doomLoopThreshold).toBe(4);
    expect(explicit.verifyMode).toBe("command");
    expect(explicit.verifyCommand).toBe(RUST_VERIFY_COMMAND);

    const autoCargo = resolveAgentLoopSettings(
      { agentProfile: "auto" },
      workspaceKindHints("cargo"),
    );
    expect(autoCargo.profile).toBe("rust");
    expect(autoCargo.verifyCommand).toBe(RUST_VERIFY_COMMAND);

    const autoKernel = resolveAgentLoopSettings(
      { agentProfile: "auto" },
      workspaceKindHints("kernel"),
    );
    expect(autoKernel.profile).toBe("systems");
    expect(autoKernel.verifyCommand).toBe("make");

    const mixed = resolveAgentLoopSettings(
      { agentProfile: "auto" },
      { systems: true, cargo: true },
    );
    expect(mixed.profile).toBe("systems");

    const jevRust = resolveAgentLoopSettings(
      { agentProfile: "systems", agentProfileSetting: "auto" },
      { systems: true, cargo: true },
      "rust",
    );
    expect(jevRust.profile).toBe("rust");
    expect(jevRust.verifyCommand).toBe(RUST_VERIFY_COMMAND);
  });

  it("lets explicit fields override the profile", () => {
    const loop = resolveAgentLoopSettings({
      agentProfile: "systems",
      agentMaxSteps: 80,
      agentDoomLoopThreshold: 4,
      agentVerifyCommand: "ninja",
    });
    expect(loop.maxSteps).toBe(80);
    expect(loop.doomLoopThreshold).toBe(4);
    expect(loop.verifyCommand).toBe("ninja");
    expect(loop.verifyMode).toBe("command");
  });

  it("lets explicit verifyCommand win over rust defaults", () => {
    const loop = resolveAgentLoopSettings({
      agentProfile: "rust",
      agentVerifyCommand: "cargo test --workspace",
    });
    expect(loop.profile).toBe("rust");
    expect(loop.verifyCommand).toBe("cargo test --workspace");
    expect(loop.verifyMode).toBe("command");
  });

  it("treats maxSteps 0 as unlimited", () => {
    expect(resolveAgentMaxSteps(0, "systems")).toBeNull();
    expect(resolveDoomLoopThreshold(0, "systems")).toBeNull();
  });
});
