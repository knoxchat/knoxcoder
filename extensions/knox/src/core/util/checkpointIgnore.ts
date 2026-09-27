/**
 * Checkpoint ignore helpers for kernel / QEMU trees (HL-41).
 * Used by the VS Code IgnorePatternPresets host.
 */

import {
  detectSystemsWorkspaceKind,
  type SystemsWorkspaceKind,
} from "../config/agentProfile";

export const LINUX_KERNEL_IGNORE_PATTERNS: string[] = [
  "# Linux kernel artifacts",
  "vmlinux",
  "vmlinux.bin",
  "vmlinux.o",
  ".tmp_vmlinux*",
  "System.map",
  "Module.symvers",
  "modules.order",
  "modules.builtin",
  "modules.builtin.modinfo",
  "*.ko",
  "*.ko.cmd",
  "*.mod",
  "*.mod.c",
  "*.o",
  "*.a",
  "*.dtb",
  "*.dtbo",
  "*.elf",
  "",
];

export const QEMU_IGNORE_PATTERNS: string[] = [
  "# QEMU artifacts",
  "qemu-system-*",
  "qemu-img",
  "pc-bios/",
  "build/",
  "*.o",
  "*.a",
  "",
];

/** Cargo incremental / rlib artifacts (RL-54). `target/` is the main ignore. */
export const RUST_CHECKPOINT_IGNORE_PATTERNS: string[] = [
  "target/",
  "**/*.rlib",
  "**/*.rmeta",
  "**/*.d",
  "incremental/",
];

export type CheckpointPresetKind =
  | SystemsWorkspaceKind
  | "cpp"
  | "node"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "dotnet"
  | "ruby"
  | "php"
  | "minimal";

export function detectCheckpointPresetKind(
  entryNames: Iterable<string>,
): CheckpointPresetKind {
  const systems = detectSystemsWorkspaceKind(entryNames);
  if (systems) {
    return systems;
  }
  const names = new Set(
    [...entryNames].map((name) => name.replace(/\/+$/, "")),
  );
  if (names.has("package.json")) {
    return "node";
  }
  if (names.has("Cargo.toml")) {
    return "rust";
  }
  if (
    names.has("requirements.txt") ||
    names.has("setup.py") ||
    names.has("pyproject.toml")
  ) {
    return "python";
  }
  if (
    names.has("pom.xml") ||
    names.has("build.gradle") ||
    names.has("build.gradle.kts")
  ) {
    return "java";
  }
  if (names.has("go.mod")) {
    return "go";
  }
  if (names.has("CMakeLists.txt") || names.has("Makefile")) {
    return "cpp";
  }
  if ([...names].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) {
    return "dotnet";
  }
  if (names.has("Gemfile") || names.has("Rakefile")) {
    return "ruby";
  }
  if (names.has("composer.json")) {
    return "php";
  }
  return "minimal";
}
