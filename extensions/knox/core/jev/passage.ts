/**
 * Passage gate: keep / conflict / drop retrieved text.
 *
 * Fail-open to keep. Used by auto-context, memory inject, and web search.
 */

import type { ContextItem } from "..";
import { createKnoxLogger } from "../util/knoxLog";
import { asNoul } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime } from "./config";
import {
  CONTRADICTS_CONFLICT,
  INSTRUCTS_MODEL_DROP,
  PASSAGE_MAX_BATCH,
  PASSAGE_MAX_CHARS,
  RELEVANT_KEEP,
  SAME_TASK_KEEP,
  USABLE_KEEP,
  contradictsQueryQuestion,
  instructsModelQuestion,
  relevantQuestion,
  sameTaskQuestion,
  usableEvidenceQuestion,
} from "./questions";
import type { JevClient, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export type PassageDisposition = "keep" | "conflict" | "drop";

export interface PassageGateResult {
  source: "jev" | "heuristic";
  disposition: PassageDisposition;
  reason: string;
}

export interface PassageCandidate {
  query: string;
  passage: string;
  sourcePath?: string;
}

function composeDisposition(answers: Record<string, { type: string }>): PassageGateResult {
  const instructs = asNoul(answers, "instructs_model")?.noul ?? 0;
  const contradicts = asNoul(answers, "contradicts_query")?.noul ?? 0;
  const relevant = asNoul(answers, "relevant")?.noul ?? 0;
  const usable = asNoul(answers, "usable_evidence")?.noul ?? 0;
  const sameTask = asNoul(answers, "same_task")?.noul;
  if (instructs >= INSTRUCTS_MODEL_DROP) {
    return {
      source: "jev",
      disposition: "drop",
      reason: `prompt injection (instructs_model=${instructs.toFixed(2)})`,
    };
  }
  if (sameTask !== undefined && sameTask < SAME_TASK_KEEP) {
    return {
      source: "jev",
      disposition: "drop",
      reason: `different task (same_task=${sameTask.toFixed(2)})`,
    };
  }
  if (contradicts >= CONTRADICTS_CONFLICT) {
    return {
      source: "jev",
      disposition: "conflict",
      reason: `contradicts query (${contradicts.toFixed(2)})`,
    };
  }
  if (relevant >= RELEVANT_KEEP && usable >= USABLE_KEEP) {
    return {
      source: "jev",
      disposition: "keep",
      reason: `relevant=${relevant.toFixed(2)} usable=${usable.toFixed(2)}`,
    };
  }
  return {
    source: "jev",
    disposition: "drop",
    reason: `not usable (relevant=${relevant.toFixed(2)} usable=${usable.toFixed(2)})`,
  };
}

const KEEP: PassageGateResult = {
  source: "heuristic",
  disposition: "keep",
  reason: "Jev passage gate skipped",
};

export async function gatePassage(
  input: PassageCandidate & {
    runtime?: JevRuntime;
    client?: JevClient;
    abortSignal?: AbortSignal;
    /** Memory inject: also ask Noul(same_task) after FTS. */
    sameTask?: boolean;
  },
): Promise<PassageGateResult> {
  const runtime = input.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client) {
    return KEEP;
  }
  const passage = input.passage.slice(0, PASSAGE_MAX_CHARS);
  if (!passage.trim()) {
    return {
      source: "heuristic",
      disposition: "drop",
      reason: "empty passage",
    };
  }
  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          query: input.query.slice(0, 2_000),
          passage,
          source_path: input.sourcePath ?? "",
        },
        questions: {
          relevant: relevantQuestion(),
          usable_evidence: usableEvidenceQuestion(),
          contradicts_query: contradictsQueryQuestion(),
          instructs_model: instructsModelQuestion(),
          ...(input.sameTask ? { same_task: sameTaskQuestion() } : {}),
        },
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );
    const gate = composeDisposition(result.answers);
    log.info(
      `passage ${gate.disposition} path=${input.sourcePath ?? "-"} ${gate.reason}`,
    );
    return gate;
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `passage gate failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return KEEP;
  }
}

export async function gatePassages(
  query: string,
  items: Array<{ passage: string; sourcePath?: string }>,
  options?: {
    runtime?: JevRuntime;
    client?: JevClient;
    abortSignal?: AbortSignal;
    sameTask?: boolean;
  },
): Promise<PassageGateResult[]> {
  const shortlist = items.slice(0, PASSAGE_MAX_BATCH);
  const gated = await Promise.all(
    shortlist.map((item) =>
      gatePassage({
        query,
        passage: item.passage,
        sourcePath: item.sourcePath,
        runtime: options?.runtime,
        client: options?.client,
        abortSignal: options?.abortSignal,
        sameTask: options?.sameTask,
      }),
    ),
  );
  if (items.length <= shortlist.length) {
    return gated;
  }
  return [
    ...gated,
    ...items.slice(shortlist.length).map(() => KEEP),
  ];
}

/** Drop injected context that looks like prompt injection or off-topic noise. */
export async function filterContextItems(
  query: string,
  items: ContextItem[],
  options?: {
    runtime?: JevRuntime;
    client?: JevClient;
    sameTask?: boolean;
  },
): Promise<ContextItem[]> {
  if (items.length === 0) {
    return items;
  }
  const runtime = options?.runtime ?? getActiveJevRuntime();
  if (!runtime.enabled) {
    return items;
  }
  const gates = await gatePassages(
    query,
    items.map((item) => ({
      passage: item.content,
      sourcePath: item.uri?.value ?? item.name,
    })),
    options,
  );
  return items.flatMap((item, index) => {
    const gate = gates[index] ?? KEEP;
    if (gate.disposition === "drop") {
      return [];
    }
    if (gate.disposition === "conflict") {
      return [
        {
          ...item,
          description: `${item.description} (conflicting evidence)`,
        },
      ];
    }
    return [item];
  });
}
