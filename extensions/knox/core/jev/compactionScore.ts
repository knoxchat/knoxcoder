/**
 * Optional Jev relevance scores for compaction when history is over budget.
 *
 * Fail-open to the heuristic scores from `scoreMessages`.
 */

import type { ScoredMessage } from "../compaction/types";
import { renderChatMessage } from "../util/messageContent";
import { createKnoxLogger } from "../util/knoxLog";
import { asScore } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime } from "./config";
import {
  COMPACTION_MAX_BATCH,
  COMPACTION_MESSAGE_MAX_CHARS,
  messageRelevanceQuestion,
} from "./questions";
import type { JevClient, JevQuestion, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

function lastUserQuery(scored: ScoredMessage[]): string {
  for (let i = scored.length - 1; i >= 0; i--) {
    if (scored[i].message.role === "user") {
      return renderChatMessage(scored[i].message).slice(0, 2_000);
    }
  }
  return "";
}

/**
 * Replace the keyword-overlap portion of heuristic scores for a shortlist
 * of old, non-protected messages. Recency / role / protected flags stay.
 */
export async function rescoreMessagesWithJev(
  scored: ScoredMessage[],
  options?: {
    query?: string;
    runtime?: JevRuntime;
    client?: JevClient;
    abortSignal?: AbortSignal;
  },
): Promise<ScoredMessage[]> {
  const runtime = options?.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, options?.client);
  if (!runtime.enabled || !client || scored.length === 0) {
    return scored;
  }

  const query = (options?.query ?? lastUserQuery(scored)).trim();
  if (!query) {
    return scored;
  }

  const candidates = scored
    .filter((item) => !item.isProtected)
    .slice(0, COMPACTION_MAX_BATCH);
  if (candidates.length === 0) {
    return scored;
  }

  const questions: Record<string, JevQuestion> = {};
  for (let i = 0; i < candidates.length; i++) {
    questions[`relevance_${i}`] = messageRelevanceQuestion(i);
  }

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          query,
          messages: candidates.map((item, index) => ({
            index,
            role: item.message.role,
            text: renderChatMessage(item.message).slice(
              0,
              COMPACTION_MESSAGE_MAX_CHARS,
            ),
          })),
        },
        questions,
      },
      { signal: options?.abortSignal, timeoutMs: runtime.timeoutMs },
    );

    const byIndex = new Map<number, number>();
    for (let i = 0; i < candidates.length; i++) {
      const score = asScore(result.answers, `relevance_${i}`);
      if (!score) {
        continue;
      }
      const normalized = Math.min(1, Math.max(0, score.score / 2));
      byIndex.set(candidates[i].index, normalized);
    }
    if (byIndex.size === 0) {
      return scored;
    }

    log.info(`compaction rescored ${byIndex.size} messages`);
    return scored.map((item) => {
      const jev = byIndex.get(item.index);
      if (jev === undefined) {
        return item;
      }
      return {
        ...item,
        relevanceScore: Math.min(1, item.relevanceScore * 0.5 + jev * 0.5),
      };
    });
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `compaction score failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return scored;
  }
}
