/**
 * Per-turn Jev judgments: model route + skill hint.
 *
 * Fail-open to the existing regex / token-overlap heuristics.
 */

import {
  resolveAgentProfile,
  workspaceHintsDisagree,
  type AgentProfileSetting,
  type ResolvedAgentProfile,
  type WorkspaceProfileHints,
} from "../config/agentProfile";
import type { SkillInfo } from "../skills/types";
import {
  formatJevSkillHint,
  formatMatchedSkillsHint,
  matchSkillsByIntent,
} from "../skills/skillMatcher";
import { analyzeForViewReadModel } from "../tools/modelRouting";
import { createKnoxLogger } from "../util/knoxLog";
import { asChoice, asNoul, asScore } from "./answers";
import { isCjkHeavy } from "./cjk";
import { JevClientError, resolveJevClient } from "./client";
import { setJevConfirmedProfile } from "./config";
import {
  composeGuardrail,
  guardrailInputQuestions,
  type GuardrailResult,
} from "./guardrail";
import { composeAutoProfile, shouldConfirmAutoProfile } from "./profileConfirm";
import {
  DIFFICULTY_ESCALATE,
  NEED_SKILL_MIN,
  NEEDS_MUTATION_OVERRIDE,
  ROUTE_CONFIDENCE_FLOOR,
  SKILL_NONE_OPTION,
  CLARIFY_HINT,
  difficultyQuestion,
  needSkillQuestion,
  needsMutationQuestion,
  profileQuestion,
  routeQuestion,
  skillChoiceCriteria,
  skillChoiceQuestion,
  type JevRouteChoice,
} from "./questions";
import type { JevClient, JevQuestion, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export type AgentTurnSource = "jev" | "heuristic";

export interface AgentTurnJudgment {
  source: AgentTurnSource;
  shouldUseViewRead: boolean;
  route: JevRouteChoice | "heuristic";
  confidence: number;
  reason: string;
  skillHint: string;
  skillName?: string;
  clarifyHint?: string;
  profile?: ResolvedAgentProfile;
  difficulty?: number;
  guardrail?: GuardrailResult;
}

export interface EvaluateAgentTurnInput {
  userMessage: string;
  skills?: SkillInfo[];
  hasViewRead: boolean;
  hasContext?: boolean;
  agentProfileSetting?: AgentProfileSetting;
  workspaceHints?: boolean | WorkspaceProfileHints;
  runtime: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}

function heuristicProfile(
  input: EvaluateAgentTurnInput,
): ResolvedAgentProfile | undefined {
  if (input.agentProfileSetting !== "auto") {
    setJevConfirmedProfile(undefined);
    return undefined;
  }
  const profile = resolveAgentProfile("auto", input.workspaceHints ?? false);
  setJevConfirmedProfile(profile);
  return profile;
}

function heuristicJudgment(input: EvaluateAgentTurnInput): AgentTurnJudgment {
  const analysis = analyzeForViewReadModel(
    input.userMessage,
    input.hasContext ?? false,
  );
  const matches = matchSkillsByIntent(input.userMessage, input.skills ?? [], {
    limit: 3,
    minScore: 0.18,
  });
  return {
    source: "heuristic",
    shouldUseViewRead: Boolean(input.hasViewRead && analysis.shouldUseViewRead),
    route: analysis.shouldUseViewRead ? "view_read" : "chat",
    confidence: analysis.confidence,
    reason: analysis.reason,
    skillHint: formatMatchedSkillsHint(matches),
    skillName: matches[0]?.skill.name,
    profile: heuristicProfile(input),
  };
}

function composeRoute(
  answers: Record<string, { type: string }>,
  hasViewRead: boolean,
): Pick<AgentTurnJudgment, "shouldUseViewRead" | "route" | "confidence" | "reason"> {
  const route = asChoice(answers, "route");
  const needsMutation = asNoul(answers, "needs_mutation");
  const difficulty = asScore(answers, "difficulty");
  if (!route) {
    throw new JevClientError("Jev turn is missing route");
  }

  const choice = route.choice as JevRouteChoice;
  const confidence = route.confidence;
  if (confidence < ROUTE_CONFIDENCE_FLOOR) {
    return {
      shouldUseViewRead: false,
      route: "chat",
      confidence,
      reason: `Jev route confidence ${confidence.toFixed(2)} below ${ROUTE_CONFIDENCE_FLOOR}; using chat`,
    };
  }
  if (
    (choice === "view_read" || choice === "clarify") &&
    (needsMutation?.noul ?? 0) >= NEEDS_MUTATION_OVERRIDE
  ) {
    return {
      shouldUseViewRead: false,
      route: "chat",
      confidence,
      reason: `Jev needs_mutation ${needsMutation?.noul.toFixed(2)} overrides ${choice}`,
    };
  }
  if ((difficulty?.score ?? 0) >= DIFFICULTY_ESCALATE) {
    return {
      shouldUseViewRead: false,
      route: choice === "chat_high" ? "chat_high" : "chat",
      confidence,
      reason: `Jev difficulty ${difficulty?.score.toFixed(2)} stays on chat`,
    };
  }
  if (choice === "view_read" && hasViewRead) {
    return {
      shouldUseViewRead: true,
      route: "view_read",
      confidence,
      reason: "Jev classified the turn as view/read",
    };
  }
  if (choice === "clarify") {
    return {
      shouldUseViewRead: false,
      route: "clarify",
      confidence,
      reason: "Jev asked to clarify before acting",
    };
  }
  return {
    shouldUseViewRead: false,
    route: choice === "chat_high" ? "chat_high" : "chat",
    confidence,
    reason: `Jev classified the turn as ${choice}`,
  };
}

function composeSkillHint(
  answers: Record<string, { type: string }>,
  skills: SkillInfo[],
): { skillHint: string; skillName?: string } {
  const needSkill = asNoul(answers, "need_skill");
  const skill = asChoice(answers, "skill");
  if ((needSkill?.noul ?? 0) < NEED_SKILL_MIN) {
    return { skillHint: "" };
  }
  const name = skill?.choice?.trim();
  if (!name || name === SKILL_NONE_OPTION) {
    return { skillHint: "" };
  }
  const matched = skills.find((item) => item.name === name);
  if (!matched) {
    return { skillHint: "" };
  }
  return { skillHint: formatJevSkillHint(matched), skillName: matched.name };
}

function resolveClient(input: EvaluateAgentTurnInput): JevClient | undefined {
  return resolveJevClient(input.runtime, input.client);
}

export async function evaluateAgentTurn(
  input: EvaluateAgentTurnInput,
): Promise<AgentTurnJudgment> {
  const fallback = () => heuristicJudgment(input);
  const client = resolveClient(input);
  if (!input.runtime.enabled || !client) {
    return fallback();
  }

  const skills = input.skills ?? [];
  const skillCriteria = skillChoiceCriteria(skills);
  const askProfile = shouldConfirmAutoProfile(
    input.agentProfileSetting,
    input.workspaceHints ?? false,
  );
  const questions: Record<string, JevQuestion> = {
    route: routeQuestion(),
    needs_mutation: needsMutationQuestion(),
    difficulty: difficultyQuestion(),
    need_skill: needSkillQuestion(),
    skill: skillChoiceQuestion(skillCriteria),
    ...guardrailInputQuestions(),
  };
  if (askProfile) {
    questions.profile = profileQuestion();
  }

  try {
    const result = await client.systemOne(
      {
        model: input.runtime.model,
        state: {
          user_message: input.userMessage.slice(0, 8_000),
          has_open_context: Boolean(input.hasContext),
          workspace_hints: input.workspaceHints ?? {},
          skill_index: skills.slice(0, 80).map((skill) => ({
            name: skill.name,
            description: skill.description.slice(0, 240),
          })),
        },
        questions,
      },
      { signal: input.abortSignal, timeoutMs: input.runtime.timeoutMs },
    );
    const routeAnswer = asChoice(result.answers, "route");
    if (
      isCjkHeavy(input.userMessage) &&
      (routeAnswer?.confidence ?? 0) < ROUTE_CONFIDENCE_FLOOR
    ) {
      log.info(
        `CJK turn confidence ${routeAnswer?.confidence ?? 0}; using heuristic`,
      );
      return fallback();
    }
    const routed = composeRoute(result.answers, input.hasViewRead);
    const skill = composeSkillHint(result.answers, skills);
    const difficulty = asScore(result.answers, "difficulty");
    const clarifyHint = routed.route === "clarify" ? CLARIFY_HINT : undefined;
    let profile: ResolvedAgentProfile | undefined;
    if (input.agentProfileSetting === "auto") {
      const heuristic = resolveAgentProfile(
        "auto",
        input.workspaceHints ?? false,
      );
      if (askProfile) {
        const choice = asChoice(result.answers, "profile");
        profile = composeAutoProfile({
          heuristic,
          hintsDisagree: workspaceHintsDisagree(input.workspaceHints ?? false),
          choice: choice?.choice,
          confidence: choice?.confidence,
          difficulty: difficulty?.score,
        });
      } else {
        profile = heuristic;
      }
      setJevConfirmedProfile(profile);
    } else {
      setJevConfirmedProfile(undefined);
    }
    const guardrail = composeGuardrail(result.answers, "input");
    const judgment: AgentTurnJudgment = {
      source: "jev",
      ...routed,
      ...skill,
      clarifyHint,
      profile,
      difficulty: difficulty?.score,
      guardrail,
    };
    log.info(
      `turn source=jev route=${judgment.route} viewRead=${judgment.shouldUseViewRead} skill=${judgment.skillName ?? "none"} profile=${judgment.profile ?? "-"} guardrail=${guardrail.action} confidence=${judgment.confidence.toFixed(2)}`,
    );
    return judgment;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!input.runtime.failOpen) {
      throw error;
    }
    log.warn(`Jev turn failed open: ${message}`);
    return fallback();
  }
}
