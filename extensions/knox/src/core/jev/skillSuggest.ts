/**
 * Two-pass skill suggestion (skill_suggestion cookbook).
 *
 * Call 1 ranks the roster by Choice probabilities and gates with the mean of
 * three request nouls (one inverted). Call 2 re-reads the top 3 with SKILL.md
 * excerpts and can reject all of them. Fail-open to the first-pass winner if
 * the rerank call errors. A quiet result still injects "nothing applies".
 */

import type { SkillInfo } from "../skills/types";
import {
  formatJevNoSkillHint,
  formatJevSkillHint,
} from "../skills/skillMatcher";
import { createKnoxLogger } from "../util/knoxLog";
import { asChoice, asNoul } from "./answers";
import {
  FITS_THRESHOLD,
  GATE_THRESHOLD,
  SKILL_EXCERPT_CHARS,
  SKILL_NONE_OPTION,
  SKILL_RERANK_MIN_REMAINING_MS,
  SKILL_SHORTLIST,
  skillChoiceCriteria,
  skillChoiceQuestion,
  skillFitsQuestion,
  skillGateQuestions,
  skillRerankQuestion,
} from "./questions";
import type { JevAnswer, JevClient, JevJson, JevQuestion, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export function skillTurnQuestions(
  skills: SkillInfo[],
): Record<string, JevQuestion> {
  const criteria = skillChoiceCriteria(skills);
  if (Object.keys(criteria).length === 0) {
    return {};
  }
  return {
    ...skillGateQuestions(),
    skill: skillChoiceQuestion(criteria),
  };
}

const SKILL_GATE_KEYS = [
  "acts_on_user_system",
  "would_follow_documented_procedure",
  "prose_suffices",
] as const;

/** Mean of the three cookbook gate nouls; `prose_suffices` is inverted. */
export function skillGateScore(
  answers: Record<string, JevAnswer>,
): number | undefined {
  const oriented: number[] = [];
  for (const key of SKILL_GATE_KEYS) {
    const noul = asNoul(answers, key);
    if (!noul) {
      continue;
    }
    oriented.push(key === "prose_suffices" ? 1 - noul.noul : noul.noul);
  }
  if (oriented.length === 0) {
    return undefined;
  }
  return oriented.reduce((sum, value) => sum + value, 0) / oriented.length;
}

function quietSkillHint(skills: SkillInfo[]): { skillHint: string } {
  return { skillHint: skills.length > 0 ? formatJevNoSkillHint() : "" };
}

export function rankSkillShortlist(
  answers: Record<string, JevAnswer>,
  skills: SkillInfo[],
): SkillInfo[] {
  const gate = skillGateScore(answers);
  if (gate === undefined || gate < GATE_THRESHOLD) {
    return [];
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const choice = asChoice(answers, "skill");
  const ranked: Array<{ name: string; mass: number }> = [];
  if (choice?.probabilities) {
    for (const [name, mass] of Object.entries(choice.probabilities)) {
      if (name === SKILL_NONE_OPTION || !byName.has(name)) {
        continue;
      }
      ranked.push({ name, mass });
    }
    ranked.sort((a, b) => b.mass - a.mass);
  }
  if (ranked.length === 0 && choice?.choice) {
    const name = choice.choice.trim();
    if (name && name !== SKILL_NONE_OPTION && byName.has(name)) {
      ranked.push({ name, mass: 1 });
    }
  }
  const seen = new Set<string>();
  const shortlist: SkillInfo[] = [];
  for (const item of ranked) {
    if (seen.has(item.name)) {
      continue;
    }
    seen.add(item.name);
    const skill = byName.get(item.name);
    if (skill) {
      shortlist.push(skill);
    }
    if (shortlist.length >= SKILL_SHORTLIST) {
      break;
    }
  }
  return shortlist;
}

export function firstPassSkillHint(
  answers: Record<string, JevAnswer>,
  skills: SkillInfo[],
): { skillHint: string; skillName?: string } {
  const winner = rankSkillShortlist(answers, skills)[0];
  if (!winner) {
    return quietSkillHint(skills);
  }
  return { skillHint: formatJevSkillHint(winner), skillName: winner.name };
}

function excerpt(skill: SkillInfo): string {
  const body = (skill.content || "").replace(/\s+/g, " ").trim();
  const text = body || skill.description || skill.name;
  return text.slice(0, SKILL_EXCERPT_CHARS);
}

export function rerankSkillQuestions(
  shortlist: SkillInfo[],
): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  for (const skill of shortlist) {
    criteria[skill.name] = `${skill.description} — ${excerpt(skill)}`;
  }
  const questions: Record<string, JevQuestion> = {
    which: skillRerankQuestion(criteria),
  };
  for (const skill of shortlist) {
    questions[`fits::${skill.name}`] = skillFitsQuestion(
      skill.name,
      skill.description,
    );
  }
  return questions;
}

function isRerankResult(
  answers: Record<string, JevAnswer>,
  shortlist: SkillInfo[],
): boolean {
  if (asChoice(answers, "which")) {
    return true;
  }
  return shortlist.some(
    (skill) => asNoul(answers, `fits::${skill.name}`) !== undefined,
  );
}

export function pickRerankWinner(
  answers: Record<string, JevAnswer>,
  shortlist: SkillInfo[],
): SkillInfo | undefined {
  if (shortlist.length === 0) {
    return undefined;
  }
  const fits = shortlist.map(
    (skill) => asNoul(answers, `fits::${skill.name}`)?.noul ?? 0,
  );
  const best = Math.max(...fits);
  if (best < FITS_THRESHOLD) {
    return undefined;
  }
  const which = asChoice(answers, "which")?.choice?.trim();
  const byName = new Map(shortlist.map((skill) => [skill.name, skill]));
  if (which && byName.has(which)) {
    return byName.get(which);
  }
  return shortlist[fits.indexOf(best)];
}

export async function suggestSkill(input: {
  answers: Record<string, JevAnswer>;
  skills: SkillInfo[];
  userMessage: string;
  recentContext?: JevJson;
  client: JevClient;
  runtime: JevRuntime;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ skillHint: string; skillName?: string }> {
  const fallback = firstPassSkillHint(input.answers, input.skills);
  const shortlist = rankSkillShortlist(input.answers, input.skills);
  if (shortlist.length === 0) {
    return quietSkillHint(input.skills);
  }

  const timeoutMs = input.timeoutMs ?? input.runtime.timeoutMs;
  if (timeoutMs < SKILL_RERANK_MIN_REMAINING_MS) {
    log.info("skill rerank skipped; first-pass timeout remaining too small");
    return fallback;
  }

  try {
    const result = await input.client.systemOne(
      {
        model: input.runtime.model,
        state: {
          user_message: input.userMessage.slice(0, 8_000),
          recent_context: input.recentContext ?? [],
        },
        questions: rerankSkillQuestions(shortlist),
      },
      { signal: input.abortSignal, timeoutMs },
    );
    if (!isRerankResult(result.answers, shortlist)) {
      return fallback;
    }
    const winner = pickRerankWinner(result.answers, shortlist);
    if (!winner) {
      log.info("skill rerank rejected the shortlist");
      return quietSkillHint(input.skills);
    }
    log.info(`skill rerank winner=${winner.name}`);
    return { skillHint: formatJevSkillHint(winner), skillName: winner.name };
  } catch (error) {
    if (!input.runtime.failOpen) {
      throw error;
    }
    log.warn(
      `skill rerank failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallback;
  }
}
