/** Token/importance heuristics and cache invalidation. */

import { MemorySnapshot } from "../MemorySnapshot.js";
import { brainRuntime } from "./state.js";

// ── Utility Helpers ────────────────────────────────────────────────────────

/**
 * Rough token estimate (4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate importance of a message based on heuristics.
 */
export function estimateImportance(content: string, role: string): number {
  let score = 0.5;

  // User messages that are questions are more important
  if (role === "user") {
    score += 0.1;
    if (content.includes("?")) score += 0.05;
    // Longer messages tend to be more substantial
    if (content.length > 200) score += 0.1;
  }

  // Messages with code blocks are more important
  if (content.includes("```")) score += 0.1;

  // Messages mentioning errors, fixes, decisions
  const importantTerms = ["error", "fix", "decision", "important", "remember", "always", "never", "convention", "pattern", "rule"];
  for (const term of importantTerms) {
    if (content.toLowerCase().includes(term)) {
      score += 0.05;
    }
  }

  return Math.min(1.0, score);
}

/**
 * Extract keywords from text for search indexing.
 */
export function extractKeywords(text: string): string {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why",
    "how", "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "no", "nor", "not", "only", "own", "same", "so",
    "than", "too", "very", "just", "because", "but", "and", "or", "if",
    "this", "that", "these", "those", "it", "its", "i", "me", "my",
    "we", "our", "you", "your", "he", "she", "they", "them", "what",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Count frequency and return top keywords
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w)
    .join(", ");
}

/**
 * Clear derived read caches after any write that can change retrieval output.
 */
export function invalidateMemoryCaches(): void {
  brainRuntime.memoryCache.clear();
  MemorySnapshot.invalidateAll();
}
