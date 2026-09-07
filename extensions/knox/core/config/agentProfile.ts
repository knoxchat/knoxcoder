/**
 * Agent loop profile (HL-12 / RL-01 / RL-02): app-sized defaults vs
 * kernel/QEMU systems work vs Cargo crates.
 *
 * Explicit `systems` / `rust` set the doom-loop threshold and post-edit
 * oracle (`make` vs `cargo check`). Tool-round caps default to unlimited
 * (stop with Cancel). `auto` becomes systems on kernel/QEMU trees and rust
 * on a root Cargo.toml (kernel wins if both).
 */

export const AGENT_PROFILE_SETTINGS = [
  "default",
  "systems",
  "rust",
  "auto",
] as const;
export type AgentProfileSetting = (typeof AGENT_PROFILE_SETTINGS)[number];
export type ResolvedAgentProfile = "default" | "systems" | "rust";

/** 0 = unlimited. Applied when `agentMaxSteps` is unset. Stop with Cancel. */
export const DEFAULT_AGENT_MAX_STEPS = 0;
export const RUST_AGENT_MAX_STEPS = 0;
export const SYSTEMS_AGENT_MAX_STEPS = 0;
export const ABSOLUTE_MAX_AGENT_STEPS = 1000;
export const DEFAULT_DOOM_LOOP_THRESHOLD = 3;
export const RUST_DOOM_LOOP_THRESHOLD = 4;
export const SYSTEMS_DOOM_LOOP_THRESHOLD = 5;
export const SYSTEMS_VERIFY_COMMAND = "make";
export const RUST_VERIFY_COMMAND = "cargo check --workspace --all-targets";

/** Workspace flags for `auto` profile resolution. Boolean `true` = systems. */
export type WorkspaceProfileHints = {
  systems?: boolean;
  cargo?: boolean;
};

export type SystemsWorkspaceKind = "kernel" | "qemu" | null;

/** Classified workspace: systems first, then a root Cargo.toml crate. */
export type WorkspaceKind = SystemsWorkspaceKind | "cargo";

export const AGENT_PROFILE_DEFAULTS: Record<
  ResolvedAgentProfile,
  {
    maxSteps: number;
    doomLoopThreshold: number;
    verifyMode: "diagnostics" | "command";
    verifyCommand: string;
  }
> = {
  default: {
    maxSteps: DEFAULT_AGENT_MAX_STEPS,
    doomLoopThreshold: DEFAULT_DOOM_LOOP_THRESHOLD,
    verifyMode: "diagnostics",
    verifyCommand: "",
  },
  rust: {
    maxSteps: RUST_AGENT_MAX_STEPS,
    doomLoopThreshold: RUST_DOOM_LOOP_THRESHOLD,
    verifyMode: "command",
    verifyCommand: RUST_VERIFY_COMMAND,
  },
  systems: {
    maxSteps: SYSTEMS_AGENT_MAX_STEPS,
    doomLoopThreshold: SYSTEMS_DOOM_LOOP_THRESHOLD,
    verifyMode: "command",
    verifyCommand: SYSTEMS_VERIFY_COMMAND,
  },
};

export function isAgentProfileSetting(value: unknown): value is AgentProfileSetting {
  return (
    value === "default" ||
    value === "systems" ||
    value === "rust" ||
    value === "auto"
  );
}

export function workspaceKindHints(kind: WorkspaceKind): WorkspaceProfileHints {
  return {
    systems: kind === "kernel" || kind === "qemu",
    cargo: kind === "cargo",
  };
}

function normalizeWorkspaceHints(
  workspace: boolean | WorkspaceProfileHints = false,
): Required<WorkspaceProfileHints> {
  if (typeof workspace === "boolean") {
    return { systems: workspace, cargo: false };
  }
  return {
    systems: Boolean(workspace.systems),
    cargo: Boolean(workspace.cargo),
  };
}

export function parseAgentProfileSetting(raw: unknown): AgentProfileSetting {
  return isAgentProfileSetting(raw) ? raw : "default";
}

function normalizedEntrySet(entryNames: Iterable<string>): Set<string> {
  return new Set([...entryNames].map((name) => name.replace(/\/+$/, "")));
}

/**
 * Kernel: Kconfig + arch/ or Makefile. QEMU: meson.build + target/ or accel/.
 * Bare Makefile / CMakeLists is not enough (app repos often have those).
 */
export function detectSystemsWorkspaceKind(
  entryNames: Iterable<string>,
): SystemsWorkspaceKind {
  const names = normalizedEntrySet(entryNames);
  const kconfig =
    names.has("Kconfig") ||
    names.has("Kconfig.mk") ||
    [...names].some((name) => name.startsWith("Kconfig."));
  if (
    kconfig &&
    (names.has("arch") || names.has("Makefile") || names.has("Kbuild"))
  ) {
    return "kernel";
  }
  if (
    names.has("meson.build") &&
    (names.has("target") || names.has("accel") || names.has("hw"))
  ) {
    return "qemu";
  }
  return null;
}

export function isSystemsWorkspace(entryNames: Iterable<string>): boolean {
  return detectSystemsWorkspaceKind(entryNames) !== null;
}

/**
 * Root-level Cargo.toml only. Nested `rust/Cargo.toml` (linux kernel) does
 * not count — listDir of the workspace root would show `rust`, not the file.
 */
export function detectCargoWorkspace(entryNames: Iterable<string>): boolean {
  return normalizedEntrySet(entryNames).has("Cargo.toml");
}

/**
 * kernel > qemu > cargo > null. A kernel/QEMU tree that also has a root
 * Cargo.toml stays systems so rust-for-linux is not stolen.
 */
export function detectWorkspaceKind(
  entryNames: Iterable<string>,
): WorkspaceKind {
  const systems = detectSystemsWorkspaceKind(entryNames);
  if (systems) {
    return systems;
  }
  if (detectCargoWorkspace(entryNames)) {
    return "cargo";
  }
  return null;
}

/** listDir the workspace root and apply kernel/QEMU detection. */
export async function detectSystemsWorkspace(
  ide: {
    getWorkspaceDirs(): Promise<string[]>;
    listDir?(uri: string): Promise<[string, number][]>;
  },
): Promise<boolean> {
  return (await detectSystemsWorkspaceKindFromIde(ide)) !== null;
}

export async function detectSystemsWorkspaceKindFromIde(
  ide: {
    getWorkspaceDirs(): Promise<string[]>;
    listDir?(uri: string): Promise<[string, number][]>;
  },
): Promise<SystemsWorkspaceKind> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root || typeof ide.listDir !== "function") {
    return null;
  }
  try {
    const entries = await ide.listDir(root);
    return detectSystemsWorkspaceKind(entries.map(([name]) => name));
  } catch {
    return null;
  }
}

export async function detectWorkspaceKindFromIde(
  ide: {
    getWorkspaceDirs(): Promise<string[]>;
    listDir?(uri: string): Promise<[string, number][]>;
  },
): Promise<WorkspaceKind> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root || typeof ide.listDir !== "function") {
    return null;
  }
  try {
    const entries = await ide.listDir(root);
    return detectWorkspaceKind(entries.map(([name]) => name));
  } catch {
    return null;
  }
}

export function resolveAgentProfile(
  raw: unknown,
  workspace: boolean | WorkspaceProfileHints = false,
): ResolvedAgentProfile {
  if (raw === "systems") {
    return "systems";
  }
  if (raw === "rust") {
    return "rust";
  }
  if (raw === "auto") {
    const hints = normalizeWorkspaceHints(workspace);
    if (hints.systems) {
      return "systems";
    }
    if (hints.cargo) {
      return "rust";
    }
  }
  return "default";
}

/** Copy VS Code knoxchat.* host settings onto experimental (unset YAML wins later). */
export function ideSettingsToExperimental(ide: {
  agentProfile?: unknown;
  agentMaxSteps?: unknown;
  agentDoomLoopThreshold?: unknown;
  agentVerifyCommand?: unknown;
  agentVerifyMode?: unknown;
  agentVerifyMaxIterations?: unknown;
}): {
  agentProfile?: AgentProfileSetting;
  agentMaxSteps?: number;
  agentDoomLoopThreshold?: number;
  agentVerifyCommand?: string;
  agentVerifyMode?: "diagnostics" | "command" | "off";
  agentVerifyMaxIterations?: number;
} {
  const out: ReturnType<typeof ideSettingsToExperimental> = {};
  if (isAgentProfileSetting(ide.agentProfile)) {
    out.agentProfile = ide.agentProfile;
  }
  if (typeof ide.agentMaxSteps === "number" && Number.isFinite(ide.agentMaxSteps)) {
    out.agentMaxSteps = ide.agentMaxSteps;
  }
  if (
    typeof ide.agentDoomLoopThreshold === "number" &&
    Number.isFinite(ide.agentDoomLoopThreshold)
  ) {
    out.agentDoomLoopThreshold = ide.agentDoomLoopThreshold;
  }
  if (typeof ide.agentVerifyCommand === "string") {
    out.agentVerifyCommand = ide.agentVerifyCommand;
  }
  if (
    ide.agentVerifyMode === "diagnostics" ||
    ide.agentVerifyMode === "command" ||
    ide.agentVerifyMode === "off"
  ) {
    out.agentVerifyMode = ide.agentVerifyMode;
  }
  if (
    typeof ide.agentVerifyMaxIterations === "number" &&
    Number.isFinite(ide.agentVerifyMaxIterations)
  ) {
    out.agentVerifyMaxIterations = ide.agentVerifyMaxIterations;
  }
  return out;
}

export function resolveAgentMaxSteps(
  raw: unknown,
  profile: ResolvedAgentProfile = "default",
): number | null {
  if (raw === 0) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), ABSOLUTE_MAX_AGENT_STEPS);
  }
  const fallback = AGENT_PROFILE_DEFAULTS[profile].maxSteps;
  return fallback > 0 ? fallback : null;
}

export function resolveDoomLoopThreshold(
  raw: unknown,
  profile: ResolvedAgentProfile = "default",
): number | null {
  if (raw === 0) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 2) {
    return Math.min(Math.floor(raw), 20);
  }
  return AGENT_PROFILE_DEFAULTS[profile].doomLoopThreshold;
}

export interface AgentLoopSettings {
  profile: ResolvedAgentProfile;
  maxSteps: number | null;
  doomLoopThreshold: number | null;
  verifyMode: "diagnostics" | "command" | "off";
  verifyCommand: string;
}

/**
 * Resolve profile + oracle for one Agent turn. Explicit experimental fields
 * win over profile defaults.
 */
export function resolveAgentLoopSettings(
  experimental:
    | {
        agentProfile?: unknown;
        agentMaxSteps?: unknown;
        agentDoomLoopThreshold?: unknown;
        agentVerifyMode?: unknown;
        agentVerifyCommand?: unknown;
      }
    | undefined,
  workspace: boolean | WorkspaceProfileHints = false,
): AgentLoopSettings {
  const profile = resolveAgentProfile(
    experimental?.agentProfile,
    workspace,
  );
  const defaults = AGENT_PROFILE_DEFAULTS[profile];
  const explicitCommand =
    typeof experimental?.agentVerifyCommand === "string"
      ? experimental.agentVerifyCommand.trim()
      : "";
  const verifyCommand = explicitCommand || defaults.verifyCommand;
  const modeRaw = experimental?.agentVerifyMode;
  let verifyMode: AgentLoopSettings["verifyMode"];
  if (modeRaw === "off" || modeRaw === "command" || modeRaw === "diagnostics") {
    verifyMode =
      modeRaw === "diagnostics" && verifyCommand ? "command" : modeRaw;
  } else {
    verifyMode = verifyCommand ? "command" : defaults.verifyMode;
  }

  return {
    profile,
    maxSteps: resolveAgentMaxSteps(experimental?.agentMaxSteps, profile),
    doomLoopThreshold: resolveDoomLoopThreshold(
      experimental?.agentDoomLoopThreshold,
      profile,
    ),
    verifyMode,
    verifyCommand,
  };
}
