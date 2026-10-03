/**
 * K-027: what instructions are loaded for a turn, and what they cost.
 *
 * Pure functions over already-discovered rules and skills, so they are cheap to
 * test and can be shown from a slash command or the GUI.
 */

import type { SkillInfo } from "../skills/types";
import { skillAppliesToPaths } from "../skills/skillManager";

import { ruleAppliesToPaths, type RuleFile } from "./rules";

/** One instruction file above this is likely to crowd out the task. */
export const INSTRUCTION_FILE_WARN_TOKENS = 2_000;
/** Everything always-on together above this deserves a trim. */
export const INSTRUCTION_TOTAL_WARN_TOKENS = 6_000;

export function estimateInstructionTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type InstructionKind = "rule" | "skill";

export interface InstructionEntry {
  kind: InstructionKind;
  /** File name for rules, skill name for skills. */
  name: string;
  path: string;
  /** global | workspace | folder for rules; skill location class for skills. */
  source: string;
  /** Tokens added to every turn while loaded (rule body, or skill listing line). */
  tokens: number;
  /** Skills only: tokens added when the model loads the skill body. */
  bodyTokens?: number;
  scope: string[];
  loaded: boolean;
  /** Why an entry is not loaded. */
  skippedReason?: "scoped out" | "empty";
  oversized: boolean;
}

export interface InstructionReport {
  entries: InstructionEntry[];
  /** Tokens of everything loaded on every turn (rules plus skill listing). */
  loadedTokens: number;
  warnings: string[];
}

function basename(p: string): string {
  const clean = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

/** Same line cost as `buildSkillToolDescription` pays per skill. */
function skillListingTokens(skill: SkillInfo): number {
  return estimateInstructionTokens(
    `<skill><name>${skill.name}</name><description>${skill.description}</description><location>${skill.location}</location></skill>`,
  );
}

function skillSource(location: string): string {
  const p = location.replace(/\\/g, "/");
  if (p.includes("/core/skills/bundled/") || p.includes("/skills/bundled/")) return "bundled";
  if (/\/\.knoxcoder\/skills\//.test(p)) return "user";
  if (/\/\.(claude|agents|opencode)\//.test(p)) return "external";
  return "project";
}

export function buildInstructionReport(input: {
  /** Rules in load order (lowest priority first), as returned by `discoverRules`. */
  rules: RuleFile[];
  skills?: SkillInfo[];
  activePaths?: string[] | null;
}): InstructionReport {
  const entries: InstructionEntry[] = [];

  for (const rule of input.rules) {
    const tokens = estimateInstructionTokens(rule.content);
    const empty = rule.content.trim().length === 0;
    const applies = ruleAppliesToPaths(rule, input.activePaths);
    const loaded = !empty && applies;
    entries.push({
      kind: "rule",
      name: basename(rule.filePath),
      path: rule.filePath,
      source: rule.source,
      tokens,
      scope: rule.applyTo,
      loaded,
      skippedReason: empty ? "empty" : applies ? undefined : "scoped out",
      oversized: tokens > INSTRUCTION_FILE_WARN_TOKENS,
    });
  }

  for (const skill of input.skills ?? []) {
    const applies = skillAppliesToPaths(skill, input.activePaths);
    const tokens = skillListingTokens(skill);
    const bodyTokens = estimateInstructionTokens(skill.content);
    entries.push({
      kind: "skill",
      name: skill.name,
      path: skill.location,
      source: skillSource(skill.location),
      tokens,
      bodyTokens,
      scope: skill.globs ?? [],
      loaded: applies,
      skippedReason: applies ? undefined : "scoped out",
      oversized: bodyTokens > INSTRUCTION_FILE_WARN_TOKENS,
    });
  }

  const loadedTokens = entries
    .filter((e) => e.loaded)
    .reduce((sum, e) => sum + e.tokens, 0);

  const warnings: string[] = [];
  for (const e of entries) {
    if (e.oversized) {
      const size = e.kind === "skill" ? e.bodyTokens : e.tokens;
      warnings.push(
        `${e.name} is large (~${size} tokens, limit ${INSTRUCTION_FILE_WARN_TOKENS}). ` +
          (e.kind === "rule"
            ? "Trim it or scope it with `applyTo`."
            : "Move detail into files the skill links to."),
      );
    }
  }
  if (loadedTokens > INSTRUCTION_TOTAL_WARN_TOKENS) {
    warnings.push(
      `Always-on instructions total ~${loadedTokens} tokens (limit ${INSTRUCTION_TOTAL_WARN_TOKENS}). Scope or trim some of them.`,
    );
  }

  return { entries, loadedTokens, warnings };
}

export function formatInstructionReport(report: InstructionReport): string {
  const rules = report.entries.filter((e) => e.kind === "rule");
  const skills = report.entries.filter((e) => e.kind === "skill");
  const line = (e: InstructionEntry): string => {
    const state = e.loaded ? "loaded" : `skipped (${e.skippedReason})`;
    const scope = e.scope.length ? `, scope ${e.scope.join(" ")}` : "";
    const cost =
      e.kind === "skill"
        ? `~${e.tokens} tok listed, ~${e.bodyTokens} on load`
        : `~${e.tokens} tok`;
    return `- **${e.name}** [${e.source}] ${state}, ${cost}${scope}\n  \`${e.path}\``;
  };

  const out: string[] = [
    `## Instructions for this turn`,
    `Always-on cost: ~${report.loadedTokens} tokens.`,
    "",
    `### Rules (${rules.length}, in load order; later overrides earlier)`,
    rules.length ? rules.map(line).join("\n") : "None found.",
    "",
    `### Skills (${skills.length})`,
    skills.length ? skills.map(line).join("\n") : "None loaded.",
  ];
  if (report.warnings.length) {
    out.push("", "### Warnings", ...report.warnings.map((w) => `- ${w}`));
  }
  return out.join("\n");
}
