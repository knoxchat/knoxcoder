/**
 * RelevanceGate — Post-fusion mismatch filter (REL-03).
 *
 * A candidate is dropped only if ALL evidence checks fail:
 *   1. ≥1 shared content word (title ∪ keywords ∪ first N chars of content)
 *   2. shared knowledge-graph entity with the query
 *   3. fts5 + trigram ≥ LEXICAL_SCORE_MIN (after REL-02 absolute scaling)
 *
 * Recency and importance never qualify a miss. Pinned items skip the lexical
 * requirement but still need an explicit reason starting with "pinned".
 */

import { isKnownEntityAlias, textMentionsEntityAliases } from "./entityResolution.js";
import { contentWords, isStopword } from "./RetrievalQuery.js";
import type { InjectedMemoryItem, SemanticMemory } from "./types.js";

export const LEXICAL_SCORE_MIN = 0.25;
export const CONTENT_SNIPPET_CHARS = 280;
/** REL-14: demote lasts this many days unless pinned. */
export const MISMATCH_TTL_DAYS = 7;
/** REL-12/REL-14: fusion penalty per mismatch_count. */
export const MISMATCH_SCORE_PENALTY = 0.15;

/**
 * MC-50: verbs/fillers that appear in nearly every task message and every memory
 * ("write a haiku" vs "Write unit tests"). Sharing only these is not evidence.
 */
export const GENERIC_GATE_WORDS: ReadonlySet<string> = new Set([
  "write", "make", "use", "using", "used", "add", "create", "change", "update", "fix", "build", "run", "set",
  "get", "new", "need", "want", "work", "works", "code", "file", "files", "thing", "things", "help", "show",
  "how", "should", "does", "check", "implement", "do", "try", "find", "convert", "about", "this", "that",
]);

export interface RelevanceGateInput {
  query: string;
  title?: string;
  keywords?: string;
  content?: string;
  fts5?: number;
  trigram?: number;
  pinned?: boolean;
  /** Entity names already resolved for this query. */
  queryEntities?: string[];
  /** Skip lexical/entity requirement (REL-20 debug). */
  requireLexical?: boolean;
  /** REL-14: user marked this item not relevant for the current topic. */
  demoted?: boolean;
  /**
   * MC-50: this memory preceded verified turns and never a revert (outcome history, or a verified
   * recipe link). Lowers the lexical-score bar to half; never admits a miss without any lexical signal.
   */
  verified?: boolean;
  /** MC-50: times the user said "Not relevant". A weak lexical score alone no longer admits it. */
  mismatchCount?: number;
  /** MC-47: override for `LEXICAL_SCORE_MIN` (offline sweeps; production uses the default). */
  lexicalScoreMin?: number;
  /**
   * MEM-23: exact / identifier hit from the ripgrep channel (memory corpus
   * or a project-file hit mapped to this row). Counts as lexical evidence.
   */
  ripgrepHit?: boolean;
}

export interface RelevanceGateResult {
  passed: boolean;
  reason: string;
  lexicalOverlap: string[];
  sharedEntities: string[];
  lexicalScore: number;
}

/** Title + keywords + leading content used for overlap checks. */
export function memoryGateText(
  input: Pick<RelevanceGateInput, "title" | "keywords" | "content">,
): string {
  const snippet = (input.content ?? "").slice(0, CONTENT_SNIPPET_CHARS);
  return [input.title, input.keywords, snippet].filter(Boolean).join(" ");
}

/** CamelCase / quoted / snake_case tokens that look like entity names. */
export function extractEntityLikeTokens(text: string): string[] {
  if (!text?.trim()) return [];
  const out: string[] = [];
  const quoted = text.match(/"([^"]{3,})"|'([^']{3,})'|`([^`]{3,})`/g);
  if (quoted) {
    for (const q of quoted) {
      out.push(q.slice(1, -1).trim());
    }
  }
  const idents = text.match(
    /\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]+)+\b|\b[A-Z]{2,}[a-zA-Z0-9]*\b|\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g,
  );
  if (idents) out.push(...idents);
  return uniquePreserve(out);
}

export function entitiesRelevantToQuery(entityNames: string[], query: string): string[] {
  const qWords = new Set(contentWords(query));
  const like = new Set(extractEntityLikeTokens(query).map((t) => t.toLowerCase()));
  return uniquePreserve(
    entityNames.filter((name) => {
      const n = name.trim();
      if (!n) return false;
      if (n.length < 3 && !isKnownEntityAlias(n)) return false;
      if (contentWords(n).some((w) => qWords.has(w))) return true;
      if (like.has(n.toLowerCase())) return true;
      return textMentionsEntityAliases(query, n);
    }),
  );
}

export function evaluateRelevanceGate(input: RelevanceGateInput): RelevanceGateResult {
  const queryWords = gateTokens(input.query);
  const memoryWords = new Set(gateTokens(memoryGateText(input)));
  const rawOverlap = queryWords.filter((w) => memoryWords.has(w));
  // MC-50: generic words never count as lexical evidence on their own.
  const lexicalOverlap = rawOverlap.filter((w) => !GENERIC_GATE_WORDS.has(w));

  const lexicalScore = (input.fts5 ?? 0) + (input.trigram ?? 0);
  const scoreMin = input.lexicalScoreMin ?? LEXICAL_SCORE_MIN;
  const bar = input.verified === true ? scoreMin / 2 : scoreMin;
  // MC-50: a memory the user already rejected must show real overlap/entity evidence, not a score.
  const scoreCounts = (input.mismatchCount ?? 0) <= 0 || input.pinned === true;
  const lexicalStrong = scoreCounts && lexicalScore > 0 && lexicalScore >= bar;

  const sharedEntities = findSharedEntities(
    input.queryEntities ?? [],
    memoryGateText(input),
    input.query,
  );

  const requireLexical = input.requireLexical !== false;
  const evidencePassed =
    input.pinned === true ||
    lexicalOverlap.length >= 1 ||
    sharedEntities.length > 0 ||
    lexicalStrong ||
    input.ripgrepHit === true;
  const passed = input.demoted === true
    ? input.pinned === true
    : !requireLexical || evidencePassed;

  return {
    passed,
    reason: input.demoted && !input.pinned
      ? "demoted"
      : formatGateReason({
          pinned: input.pinned === true,
          lexicalOverlap,
          sharedEntities,
          lexicalScore,
          lexicalStrong,
          ripgrepHit: input.ripgrepHit === true,
        }),
    lexicalOverlap,
    sharedEntities,
    lexicalScore,
  };
}

/**
 * REL-06 / REL-03: Brainstem→Thalamus may only re-attend items that passed
 * the mismatch gate. Working/goal/summary kinds never qualify.
 */
export function injectedItemPassedGate(
  item: Pick<InjectedMemoryItem, "kind" | "reason">,
): boolean {
  if (item.kind !== "semantic" && item.kind !== "episodic") return false;
  const reason = item.reason?.trim() ?? "";
  if (!reason || reason === "no-evidence" || reason === "demoted") return false;
  return /^(pinned\b|lexical:|entity:|lexical-score:)/.test(reason);
}

/** REL-14: demote is active and applies to this retrieval topic. */
export function isMismatchActive(
  mem: Pick<SemanticMemory, "mismatch_until" | "mismatch_topic_id"> | undefined,
  currentTopicId: number | null | undefined,
  now = Date.now(),
): boolean {
  if (!mem?.mismatch_until) return false;
  const until = Date.parse(mem.mismatch_until);
  if (!Number.isFinite(until) || until <= now) return false;
  if (mem.mismatch_topic_id == null || currentTopicId == null) return true;
  return mem.mismatch_topic_id === currentTopicId;
}

/**
 * REL-14: leftover subtract while the 7-day demote is active.
 * After `mismatch_until` the count is history, not a score — a 0.15 scar is
 * ~10× one RRF channel and would permanently zero a real hit (MEM-21).
 */
export function applyMismatchPenalty(
  score: number,
  mismatchCount: number | undefined,
  pinned: boolean,
  demoted = true,
): number {
  if (pinned || !demoted) return score;
  const n = mismatchCount ?? 0;
  if (n <= 0) return score;
  return Math.max(0, score - MISMATCH_SCORE_PENALTY * n);
}

export function formatGateReason(input: {
  pinned: boolean;
  lexicalOverlap: string[];
  sharedEntities: string[];
  lexicalScore: number;
  lexicalStrong: boolean;
  ripgrepHit?: boolean;
}): string {
  const parts: string[] = [];
  if (input.pinned) parts.push("pinned");
  if (input.lexicalOverlap.length > 0) {
    parts.push(`lexical: ${input.lexicalOverlap.slice(0, 4).join(", ")}`);
  }
  if (input.sharedEntities.length > 0) {
    parts.push(`entity: ${input.sharedEntities.slice(0, 3).join(", ")}`);
  }
  if (
    input.lexicalStrong &&
    input.lexicalOverlap.length === 0 &&
    input.sharedEntities.length === 0 &&
    !input.pinned
  ) {
    parts.push(`lexical-score: ${input.lexicalScore.toFixed(2)}`);
  }
  if (
    input.ripgrepHit &&
    input.lexicalOverlap.length === 0 &&
    input.sharedEntities.length === 0 &&
    !input.lexicalStrong &&
    !input.pinned
  ) {
    parts.push("lexical: exact");
  }
  return parts.join("; ") || "no-evidence";
}

export async function resolveQueryEntities(query: string, limit = 8): Promise<string[]> {
  const tokens = extractEntityLikeTokens(query);
  try {
    const { KnowledgeGraph } = await import("./KnowledgeGraph.js");
    const found = await KnowledgeGraph.searchEntities(query, undefined, limit);
    return entitiesRelevantToQuery(
      [...tokens, ...found.map((e) => e.name)],
      query,
    );
  } catch {
    return entitiesRelevantToQuery(tokens, query);
  }
}

function findSharedEntities(
  queryEntities: string[],
  memoryText: string,
  query: string,
): string[] {
  const names = entitiesRelevantToQuery(
    queryEntities.length > 0 ? queryEntities : extractEntityLikeTokens(query),
    query,
  );
  if (names.length === 0 || !memoryText.trim()) return [];
  const haystack = memoryText;
  const shared: string[] = [];
  for (const name of names) {
    if (hasWordBoundary(haystack, name) || textMentionsEntityAliases(haystack, name)) {
      shared.push(name);
    }
  }
  return uniquePreserve(shared);
}

export function hasWordBoundary(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:[^A-Za-z0-9_]|$)`, "i");
  return re.test(haystack);
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

/** Content words plus hyphen/underscore parts so `galaxy-nebula-alpha` overlaps `galaxy`. */
function gateTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of contentWords(text)) {
    const parts = /[-_]/.test(word) ? [word, ...word.split(/[-_]/)] : [word];
    for (const part of parts) {
      if (part.length < 2 || isStopword(part) || seen.has(part)) continue;
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}
