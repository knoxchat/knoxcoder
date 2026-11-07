/**
 * MEM-79: lexical answer grader. LongMemEval / LoCoMo may use an LLM as an
 * evaluator of the final answer; that never touches memory ranking.
 * Default (no LLM) grades retrieved context against the gold answer by
 * normalized-token overlap.
 */
import { contentWords } from "../../brain/RetrievalQuery.js";

export interface GradeResult {
  score: number;
  method: "lexical" | "contains";
  overlap: number;
}

function tokensOf(text: string): Set<string> {
  return new Set(contentWords(text.toLowerCase()).filter((w) => w.length >= 2));
}

/** Token F1 of `got` vs `gold`. Empty gold is 1 (nothing to miss). */
export function lexicalGrade(got: string, gold: string): GradeResult {
  const want = tokensOf(gold);
  if (want.size === 0) {
    return { score: 1, method: "lexical", overlap: 0 };
  }
  const have = tokensOf(got);
  let overlap = 0;
  for (const tok of want) {
    if (have.has(tok)) overlap++;
  }
  const recall = overlap / want.size;
  const precision = have.size ? overlap / have.size : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const contains = [...want].every((tok) => have.has(tok));
  return {
    score: contains ? Math.max(f1, 0.99) : f1,
    method: contains ? "contains" : "lexical",
    overlap,
  };
}

export function meanScore(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
