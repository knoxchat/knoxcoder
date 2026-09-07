import { Tool } from "../..";
import { BuiltInToolNames } from "../builtIn";

export const SUBAGENT_PROFILES = [
  "explore",
  "general",
  "review",
  "rust-review",
  "rust-borrowck",
  "rust-architect",
] as const;
export type SubagentProfile = (typeof SUBAGENT_PROFILES)[number];

export function isSubagentProfile(value: unknown): value is SubagentProfile {
  return (
    typeof value === "string" &&
    (SUBAGENT_PROFILES as readonly string[]).includes(value)
  );
}

export const DEFAULT_SUBAGENT_MAX_STEPS: Record<SubagentProfile, number> = {
  explore: 12,
  general: 20,
  review: 12,
  "rust-review": 12,
  "rust-borrowck": 12,
  "rust-architect": 16,
};

export const SYSTEMS_SUBAGENT_MAX_STEPS: Record<SubagentProfile, number> = {
  explore: 40,
  general: 80,
  review: 40,
  "rust-review": 40,
  "rust-borrowck": 40,
  "rust-architect": 40,
};

export const DEFAULT_SUBAGENT_ABSOLUTE_CAP = 40;
export const SYSTEMS_SUBAGENT_ABSOLUTE_CAP = 200;

const CHILD_BLOCKED_TOOLS = new Set<string>([
  BuiltInToolNames.Task,
  BuiltInToolNames.AskUser,
]);

const MEMORY_RECALL_TOOLS = new Set<string>([
  BuiltInToolNames.Memory,
  BuiltInToolNames.MemoryGraph,
  BuiltInToolNames.MemorySessions,
]);

const READONLY_PROFILES = new Set<SubagentProfile>([
  "explore",
  "review",
  "rust-review",
  "rust-borrowck",
]);

export function isReadonlySubagentProfile(profile: SubagentProfile): boolean {
  return READONLY_PROFILES.has(profile);
}

export function resolveSubagentProfile(raw: unknown): SubagentProfile {
  return isSubagentProfile(raw) ? raw : "explore";
}

export function resolveSubagentMaxSteps(
  profile: SubagentProfile,
  raw: unknown,
  opts?: { systems?: boolean },
): number {
  const systems = Boolean(opts?.systems);
  const cap = systems
    ? SYSTEMS_SUBAGENT_ABSOLUTE_CAP
    : DEFAULT_SUBAGENT_ABSOLUTE_CAP;
  const defaults = systems
    ? SYSTEMS_SUBAGENT_MAX_STEPS
    : DEFAULT_SUBAGENT_MAX_STEPS;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), cap);
  }
  return defaults[profile];
}

export function toolsForSubagentProfile(
  profile: SubagentProfile,
  catalog: Tool[],
): Tool[] {
  return catalog.filter((tool) => {
    const name = tool.function.name;
    if (CHILD_BLOCKED_TOOLS.has(name)) {
      return false;
    }
    if (isReadonlySubagentProfile(profile)) {
      return !!tool.readonly || MEMORY_RECALL_TOOLS.has(name);
    }
    return true;
  });
}

export function subagentSystemPrompt(profile: SubagentProfile): string {
  const shared = [
    "You are a child agent. Complete only the assigned task.",
    "Return a concise summary the parent agent can use. Do not greet the user.",
    "Prefer tools over guessing. Do not spawn further subagents.",
  ];
  if (profile === "explore") {
    return [
      ...shared,
      "Profile: explore (read-only). Answer codebase questions. Do not edit files or run mutating commands. You may recall or search memory; do not store or delete memories.",
    ].join(" ");
  }
  if (profile === "review") {
    return [
      ...shared,
      "Profile: review (read-only). Focus on diffs, risks, and concrete findings. Do not edit files. You may recall or search memory; do not store or delete memories.",
    ].join(" ");
  }
  if (profile === "rust-review") {
    return [
      ...shared,
      "Profile: rust-review (read-only, adversarial). Hunt unwrap/expect, unjustified .clone()/Arc/Mutex/RefCell, missing #[must_use], non-Send futures, missing // SAFETY:, test weakening, public API docs/examples, semver, and traits/generics with one impl. Do not edit files.",
    ].join(" ");
  }
  if (profile === "rust-borrowck") {
    return [
      ...shared,
      "Profile: rust-borrowck (read-only). Restate the ownership graph. Remedy menu only: split borrows, index access, std::mem::take, pass &mut down, restructure, arena/slotmap — not sprinkle clone. Point at rustc --explain / the Nomicon; do not dump The Book. Do not edit files.",
    ].join(" ");
  }
  if (profile === "rust-architect") {
    return [
      ...shared,
      "Profile: rust-architect. No implementation until a short ADR via builtin_plan (or a markdown ADR path the user already uses): data layout, ownership topology, error type, module boundaries. Stay scoped to the design.",
    ].join(" ");
  }
  return [
    ...shared,
    "Profile: general. You may use write tools for this unit of work. Stay scoped to the prompt.",
  ].join(" ");
}
