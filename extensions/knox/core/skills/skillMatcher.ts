/**
 * Lightweight intent matcher for skills.
 *
 * Scores name + description token overlap against the user message.
 * Full skill bodies still load via `builtin_skill`; this only suggests
 * which skills are relevant so the model knows to call the tool.
 */

import type { SkillInfo } from "./types";

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
  const limit = options?.limit ?? 3;
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

/**
 * Format a short system hint listing matched skills (names + descriptions).
 */
export function formatMatchedSkillsHint(matches: SkillMatch[]): string {
  if (matches.length === 0) {
    return "";
  }

  const lines = matches.map(
    (match) =>
      `- \`${match.skill.name}\`: ${match.skill.description}`,
  );

  return [
    "## Suggested Skills",
    "These skills look relevant to the user's request. Load full instructions with the skill tool when needed:",
    ...lines,
  ].join("\n");
}

/**
 * One-skill hint used when Jev picks a roster entry (Hermes-style).
 */
export function formatJevSkillHint(skill: SkillInfo): string {
  const roster = formatMatchedSkillsHint([{ skill, score: 1 }]);
  return [
    "<skill_relevance>",
    `Relevant to the current request: ${skill.name}. Ignore this if it does not fit what the user actually asked for.`,
    "</skill_relevance>",
    roster,
  ].join("\n");
}
