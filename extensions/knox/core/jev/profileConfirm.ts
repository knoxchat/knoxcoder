/**
 * Confirm `auto` agent profile when workspace hints disagree.
 *
 * Kernel+Cargo.toml currently always becomes systems. Jev can pick rust
 * for a rustc turn in that tree. Fail-open to the workspace heuristic.
 */

import {
  overlayAutoProfile,
  resolveAgentProfile,
  workspaceHintsDisagree,
  type ResolvedAgentProfile,
  type WorkspaceProfileHints,
} from "../config/agentProfile";
import { createKnoxLogger } from "../util/knoxLog";
import { asChoice, asScore } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime, setJevConfirmedProfile } from "./config";
import {
  DIFFICULTY_ESCALATE,
  PROFILE_CONFIDENCE_FLOOR,
  PROFILE_OVERRIDE_CONFIDENCE,
  difficultyQuestion,
  profileQuestion,
  type JevProfileChoice,
} from "./questions";
import type { JevClient, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export function shouldConfirmAutoProfile(
  setting: unknown,
  workspace: boolean | WorkspaceProfileHints = false,
): boolean {
  if (setting !== "auto") {
    return false;
  }
  const heuristic = resolveAgentProfile("auto", workspace);
  return workspaceHintsDisagree(workspace) || heuristic === "default";
}

export function composeAutoProfile(input: {
  heuristic: ResolvedAgentProfile;
  hintsDisagree: boolean;
  choice?: string;
  confidence?: number;
  difficulty?: number;
}): ResolvedAgentProfile {
  const choice = input.choice as JevProfileChoice | undefined;
  const confidence = input.confidence ?? 0;
  if (
    !choice ||
    (choice !== "default" && choice !== "rust" && choice !== "systems")
  ) {
    return input.heuristic;
  }
  if (confidence < PROFILE_CONFIDENCE_FLOOR) {
    return input.heuristic;
  }
  if (input.hintsDisagree && (choice === "rust" || choice === "systems")) {
    return choice;
  }
  if (
    input.heuristic === "default" &&
    (input.difficulty ?? 0) >= DIFFICULTY_ESCALATE &&
    (choice === "rust" || choice === "systems")
  ) {
    return choice;
  }
  if (
    choice !== input.heuristic &&
    confidence >= PROFILE_OVERRIDE_CONFIDENCE &&
    choice !== "default"
  ) {
    return choice;
  }
  return input.heuristic;
}

export async function confirmAutoProfile(input: {
  setting: unknown;
  workspaceHints?: boolean | WorkspaceProfileHints;
  userMessage: string;
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}): Promise<ResolvedAgentProfile> {
  const hints = input.workspaceHints ?? false;
  const heuristic = resolveAgentProfile(input.setting, hints);
  if (input.setting !== "auto") {
    setJevConfirmedProfile(undefined);
    return heuristic;
  }

  const runtime = input.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client || !shouldConfirmAutoProfile("auto", hints)) {
    setJevConfirmedProfile(heuristic);
    return heuristic;
  }

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          user_message: input.userMessage.slice(0, 8_000),
          workspace_hints: hints,
        },
        questions: {
          profile: profileQuestion(),
          difficulty: difficultyQuestion(),
        },
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );
    const profile = asChoice(result.answers, "profile");
    const difficulty = asScore(result.answers, "difficulty");
    const confirmed = composeAutoProfile({
      heuristic,
      hintsDisagree: workspaceHintsDisagree(hints),
      choice: profile?.choice,
      confidence: profile?.confidence,
      difficulty: difficulty?.score,
    });
    setJevConfirmedProfile(confirmed);
    log.info(
      `auto profile heuristic=${heuristic} confirmed=${confirmed} choice=${profile?.choice ?? "?"} confidence=${(profile?.confidence ?? 0).toFixed(2)}`,
    );
    return confirmed;
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `auto profile failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    setJevConfirmedProfile(heuristic);
    return heuristic;
  }
}

export function loopProfileFromExperimental(
  experimental:
    | {
        agentProfile?: unknown;
        agentProfileSetting?: unknown;
      }
    | undefined,
  workspace: boolean | WorkspaceProfileHints = false,
  confirmed?: ResolvedAgentProfile | null,
): ResolvedAgentProfile {
  return overlayAutoProfile(experimental, workspace, confirmed);
}
