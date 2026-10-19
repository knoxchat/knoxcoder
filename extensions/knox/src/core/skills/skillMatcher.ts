/**
 * Lightweight intent matcher for skills.
 *
 * Scores name + description token overlap against the user message.
 * Full skill bodies still load via `builtin_skill`; this only suggests
 * which skills are relevant so the model knows to call the tool.
 */

import type { ResolvedAgentProfile, WorkspaceKind } from "../config/agentProfile";
import { skillAppliesToPaths } from "./skillManager";
import type { SkillInfo } from "./types";

/** Product cap: names + one-line descriptions only (K-074). */
export const MAX_SKILL_HINTS = 3;
const HINT_DESCRIPTION_CHARS = 120;

export type SkillMatch = {
  skill: SkillInfo;
  score: number;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "this",
  "that",
  "it",
  "as",
  "at",
  "by",
  "from",
  "use",
  "using",
  "please",
  "help",
  "me",
  "my",
  "your",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function scoreSkill(messageTokens: string[], skill: SkillInfo): number {
  if (messageTokens.length === 0) {
    return 0;
  }

  const nameTokens = tokenize(skill.name.replace(/[-_]/g, " "));
  const descTokens = tokenize(skill.description);
  const haystack = new Set([...nameTokens, ...descTokens]);
  if (haystack.size === 0) {
    return 0;
  }

  let hits = 0;
  let nameHits = 0;
  for (const token of messageTokens) {
    if (haystack.has(token)) {
      hits += 1;
    }
    if (nameTokens.includes(token)) {
      nameHits += 1;
    }
    // Partial containment for compound tokens (e.g. "refactoring" vs "refactor")
    for (const candidate of haystack) {
      if (
        candidate.length >= 4 &&
        token.length >= 4 &&
        (candidate.includes(token) || token.includes(candidate))
      ) {
        hits += 0.5;
        break;
      }
    }
  }

  const overlap = hits / messageTokens.length;
  const nameBoost = nameHits > 0 ? 0.25 : 0;
  return Math.min(1, overlap + nameBoost);
}

/**
 * Rank skills by relevance to a user message.
 */
export function matchSkillsByIntent(
  message: string,
  skills: SkillInfo[],
  options?: { limit?: number; minScore?: number },
): SkillMatch[] {
  const limit = options?.limit ?? MAX_SKILL_HINTS;
  const minScore = options?.minScore ?? 0.18;
  const messageTokens = tokenize(message);
  if (messageTokens.length === 0 || skills.length === 0) {
    return [];
  }

  return skills
    .map((skill) => ({ skill, score: scoreSkill(messageTokens, skill) }))
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function oneLineDescription(text: string): string {
  const line = text.split(/\r?\n/).find((part) => part.trim())?.trim() ?? "";
  if (line.length <= HINT_DESCRIPTION_CHARS) {
    return line;
  }
  return `${line.slice(0, HINT_DESCRIPTION_CHARS - 1)}…`;
}

function pinnedBundledSkillName(
  profile?: ResolvedAgentProfile,
  workspaceKind?: WorkspaceKind,
): "kbuild" | "rust" | undefined {
  if (profile === "systems" || workspaceKind === "kernel" || workspaceKind === "qemu") {
    return "kbuild";
  }
  if (profile === "rust" || workspaceKind === "cargo") {
    return "rust";
  }
  return undefined;
}

export interface SelectTurnSkillsInput {
  message: string;
  skills: SkillInfo[];
  openPaths?: string[] | null;
  /** Jev-picked name; fail-open — never blocks glob or heuristic matches. */
  jevSkillName?: string;
  profile?: ResolvedAgentProfile;
  workspaceKind?: WorkspaceKind;
}

/**
 * Per-turn skill shortlist (K-074): glob on the open file, then Jev, then
 * heuristic. At most 3 names; systems/rust may pin kbuild/rust extra.
 */
export function selectTurnSkills(input: SelectTurnSkillsInput): SkillMatch[] {
  const seen = new Set<string>();
  const ranked: SkillMatch[] = [];
  const push = (skill: SkillInfo | undefined, score: number) => {
    if (!skill || seen.has(skill.name)) {
      return;
    }
    seen.add(skill.name);
    ranked.push({ skill, score });
  };

  const byName = new Map(input.skills.map((skill) => [skill.name, skill]));
  for (const skill of input.skills) {
    if (skill.globs?.length && skillAppliesToPaths(skill, input.openPaths)) {
      push(skill, 1);
    }
  }
  if (input.jevSkillName) {
    push(byName.get(input.jevSkillName), 0.9);
  }
  for (const match of matchSkillsByIntent(input.message, input.skills, {
    limit: MAX_SKILL_HINTS,
    minScore: 0.18,
  })) {
    push(match.skill, match.score);
  }

  const capped = ranked.slice(0, MAX_SKILL_HINTS);
  const pin = pinnedBundledSkillName(input.profile, input.workspaceKind);
  if (pin) {
    const skill = byName.get(pin);
    if (skill && !capped.some((match) => match.skill.name === pin)) {
      return [{ skill, score: 1 }, ...capped];
    }
  }
  return capped;
}

/**
 * Format a short system hint listing matched skills (names + one-line
 * descriptions). Never includes SKILL.md bodies.
 */
export function formatMatchedSkillsHint(matches: SkillMatch[]): string {
  if (matches.length === 0) {
    return "";
  }

  const lines = matches.slice(0, MAX_SKILL_HINTS + 1).map(
    (match) =>
      `- \`${match.skill.name}\`: ${oneLineDescription(match.skill.description)}`,
  );

  return [
    "## Suggested Skills",
    "These skills look relevant. Load full instructions with builtin_skill when needed:",
    ...lines,
  ].join("\n");
}

/**
 * One-skill hint used when Jev picks a roster entry (Hermes-style).
 */
export function formatJevSkillHint(skill: SkillInfo): string {
  return [
    "<skill_relevance>",
    `Relevant to the current request: ${skill.name}. Ignore this if it does not fit what the user actually asked for.`,
    "</skill_relevance>",
  ].join("\n");
}

/** Cookbook quiet result: oppose the roster so the agent does not guess. */
export function formatJevNoSkillHint(): string {
  return [
    "<skill_relevance>",
    "No skill in the roster appears relevant to this request.",
    "</skill_relevance>",
  ].join("\n");
}
