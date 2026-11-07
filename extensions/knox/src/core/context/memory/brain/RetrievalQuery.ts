/**
 * RetrievalQuery — Query hygiene and follow-up expansion (REL-01).
 *
 * Chat retrieval must not search raw continuation text ("continue", "ok now do it").
 * This module:
 *   - strips stopwords
 *   - classifies continuation vs new task
 *   - expands continuation queries with active topic + last substantial user turn
 *   - builds FTS5 MATCH strings that AND content words (never OR stopwords)
 *
 * C_goal / display text stays the user's current message. Only the retrieval
 * query is rewritten.
 */

import { CJK_RUN, cjkIndexTokens, isCjkToken } from "./cjkFts.js";

export type RetrievalIntent = "continuation" | "new_task";

export interface RetrievalQueryInput {
  message: string;
  topicKeywords?: string;
  lastSubstantialTurn?: string;
  /** When false, continuation queries are stripped but not expanded. Default true. */
  continuationExpand?: boolean;
  /** Jaccard below this vs active topic ⇒ new task. Default 0.35. */
  topicShiftJaccard?: number;
  /** AND content words in FTS5 (default true). */
  fts5UseAnd?: boolean;
  extraOrTerms?: string[];
}

export interface RetrievalQueryResult {
  intent: RetrievalIntent;
  original: string;
  contentWords: string[];
  /** Bag-of-content-words used for fusion / FTS / LIKE. Empty if nothing searchable. */
  retrievalQuery: string;
  fts5Query: string | null;
}

/** Max content words kept in an expanded retrieval query. */
export const RETRIEVAL_QUERY_WORD_CAP = 16;
/** AND at most this many (longest) terms so MATCH does not collapse to zero hits. */
export const FTS5_AND_TERM_CAP = 3;
/** Messages shorter than this with no content words count as continuation. */
export const SHORT_CONTINUATION_CHARS = 40;
/**
 * T6: a `new_task` whose content still overlaps the active topic at least this
 * much reuses continuation expansion (topic + last substantial turn).
 * Below this is a topic shift; do not mix last-turn terms in.
 */
export const NEW_TASK_TOPIC_EXPAND_JACCARD = 0.15;

/**
 * Shared stopword list for retrieval and topic keyword extraction.
 * Includes continuation filler that must never become `ok*` / `now*` FTS terms.
 */
export const RETRIEVAL_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "this", "that", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "and", "or", "but", "not",
  "just", "also", "like", "well", "yes", "yeah", "yep", "no", "ok", "okay",
  "sure", "please", "now", "then", "than", "too", "very", "still",
  "here", "there", "so", "if", "into", "up", "out", "about", "over",
  "again", "further", "once", "only", "own", "same", "than", "too",
  "think", "know", "want", "need", "get", "let", "make", "see",
  "how", "what", "why", "when", "where", "who", "which",
  "continue", "continuing", "continued",
]);

const CONTINUATION_PREFIX =
  /^(?:please\s+)?(?:continue|ok|okay|yes|yeah|yep|sure|and then|also|same for|do the same|keep going|go on|proceed)(?:\s*,?\s*(?:continue|please|now|then))?\b/i;

const NEW_QUESTION_PREFIX =
  /^(?:new question|new task|different question)\s*:?\s*/i;

export function isStopword(token: string): boolean {
  return RETRIEVAL_STOPWORDS.has(token.toLowerCase());
}

/** Content-bearing tokens (stopwords removed). CJK runs become overlapping bigrams. */
export function contentWords(text: string): string[] {
  if (!text?.trim()) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  const push = (token: string) => {
    if (!token || seen.has(token) || isStopword(token) || /^(AND|OR|NOT|NEAR)$/i.test(token)) {
      return;
    }
    seen.add(token);
    words.push(token);
  };
  for (const bg of cjkIndexTokens(text)) {
    push(bg);
  }
  const tokens = text
    .toLowerCase()
    .replace(CJK_RUN, " ")
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  for (const token of tokens) {
    push(token);
  }
  return words;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Classify the user turn: keep going on the current topic, or start a new task.
 */
export function detectIntent(
  message: string,
  topicKeywords?: string,
  topicShiftJaccard = 0.35,
): RetrievalIntent {
  const trimmed = message.trim();
  if (!trimmed) return "continuation";

  if (NEW_QUESTION_PREFIX.test(trimmed)) return "new_task";

  const words = contentWords(trimmed);
  const prefixMatch = CONTINUATION_PREFIX.exec(trimmed);

  if (prefixMatch) {
    const restWords = contentWords(trimmed.slice(prefixMatch[0].length));
    if (restWords.length <= 1) return "continuation";
    if (topicKeywords) {
      const overlap = jaccard(new Set(restWords), new Set(contentWords(topicKeywords)));
      if (overlap >= topicShiftJaccard) return "continuation";
    }
    return "new_task";
  }

  if (trimmed.length < SHORT_CONTINUATION_CHARS && words.length === 0) {
    return "continuation";
  }

  if (words.length === 0) return "continuation";
  return "new_task";
}

/**
 * Pick the most recent substantial user turn that is not the current message
 * and is not itself a pure continuation.
 */
export function pickLastSubstantialTurn(
  candidates: string[],
  currentMessage: string,
  minChars = SHORT_CONTINUATION_CHARS,
): string | undefined {
  const currentNorm = currentMessage.trim().toLowerCase();
  for (const raw of candidates) {
    const text = raw?.trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower === currentNorm) continue;
    const words = contentWords(text);
    if (detectIntent(text) === "continuation" && words.length < 2) continue;
    if (words.length >= 2 || text.length >= minChars) return text;
  }
  return undefined;
}

/**
 * Build an FTS5 MATCH query: AND content words, never OR stopwords.
 * Quoted phrases stay as phrases. Optional synonym terms are OR'd as extras.
 */
export function buildFts5Query(
  query: string,
  options?: { useAnd?: boolean; extraOrTerms?: string[] },
): string | null {
  const phrases: string[] = [];
  const withoutPhrases = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
    phrases.push(`"${phrase}"`);
    return "";
  });

  const terms = contentWords(withoutPhrases);
  const extra = (options?.extraOrTerms ?? [])
    .flatMap((t) => contentWords(t))
    .filter((t) => !terms.includes(t));

  if (terms.length === 0 && phrases.length === 0 && extra.length === 0) {
    return null;
  }

  const formatTerm = (term: string): string => {
    if (/^\w+$/.test(term)) return `${term}*`;
    return `"${term.replace(/"/g, "")}"`;
  };

  const useAnd = options?.useAnd !== false && !terms.some((t) => isCjkToken(t));
  const rankedTerms = useAnd && terms.length > FTS5_AND_TERM_CAP
    ? [...terms].sort((a, b) => b.length - a.length).slice(0, FTS5_AND_TERM_CAP)
    : terms;

  const contentParts = [...phrases, ...rankedTerms.map(formatTerm)];
  let contentClause: string | null = null;
  if (contentParts.length === 1) {
    contentClause = contentParts[0];
  } else if (contentParts.length > 1) {
    contentClause = contentParts.join(useAnd ? " AND " : " OR ");
  }

  const extraParts = extra.map(formatTerm);
  if (extraParts.length === 0) return contentClause;
  if (!contentClause) return extraParts.join(" OR ");
  return `(${contentClause}) OR ${extraParts.join(" OR ")}`;
}

function shouldExpandWithTopic(input: RetrievalQueryInput, intent: RetrievalIntent, original: string): boolean {
  if (input.continuationExpand === false) return false;
  if (intent === "continuation") return true;
  if (intent !== "new_task" || !input.topicKeywords) return false;
  const overlap = jaccard(
    new Set(contentWords(original)),
    new Set(contentWords(input.topicKeywords)),
  );
  return overlap >= NEW_TASK_TOPIC_EXPAND_JACCARD;
}

/**
 * Expand a user message into a retrieval query (pure; no I/O).
 *
 * Continuation: current content words ∪ topic keywords ∪ last substantial turn.
 * New task with mid Jaccard to the active topic: same expansion (T6).
 * New task that shifted topics: current content words only.
 */
export function expandRetrievalQuery(input: RetrievalQueryInput): RetrievalQueryResult {
  const original = input.message ?? "";
  const intent = detectIntent(original, input.topicKeywords, input.topicShiftJaccard);
  const bag: string[] = [...contentWords(original)];

  if (shouldExpandWithTopic(input, intent, original)) {
    if (input.topicKeywords) {
      bag.push(...contentWords(input.topicKeywords));
    }
    if (input.lastSubstantialTurn) {
      bag.push(...contentWords(input.lastSubstantialTurn).slice(0, 12));
    }
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const word of bag) {
    if (seen.has(word)) continue;
    seen.add(word);
    unique.push(word);
    if (unique.length >= RETRIEVAL_QUERY_WORD_CAP) break;
  }

  const retrievalQuery = unique.join(" ");
  const currentWords = contentWords(original);
  // AND the user's content words. Pure continuation (no content words) ORs
  // topic/last-turn terms so recall is not collapsed by AND-of-longest.
  const ftsSource = currentWords.length > 0 ? currentWords.join(" ") : retrievalQuery;
  const useAnd = input.fts5UseAnd !== false && currentWords.length > 0;

  return {
    intent,
    original,
    contentWords: unique,
    retrievalQuery,
    fts5Query: buildFts5Query(ftsSource, {
      useAnd,
      extraOrTerms: input.extraOrTerms,
    }),
  };
}

export interface WorkingMemoryQueryItem {
  content: string;
  source: string;
  added_at?: number;
}

/**
 * Resolve expansion context from session topic, episodic history, and working memory.
 * Dynamic-imports BrainStore to avoid a load-time cycle with RetrievalFusion.
 */
export async function resolveRetrievalQuery(options: {
  message: string;
  sessionId?: string;
  workingMemoryItems?: WorkingMemoryQueryItem[];
  retrievalQueryOverride?: string;
}): Promise<RetrievalQueryResult> {
  const message = options.message ?? "";

  if (options.retrievalQueryOverride !== undefined) {
    const override = options.retrievalQueryOverride.trim();
    return {
      intent: detectIntent(message),
      original: message,
      contentWords: contentWords(override),
      retrievalQuery: override,
      fts5Query: buildFts5Query(override),
    };
  }

  let continuationExpand = true;
  let topicShiftJaccard = 0.35;
  let fts5UseAnd = true;
  try {
    const { getMemoryConfig } = await import("./memoryConfigAccess.js");
    const cfg = getMemoryConfig();
    continuationExpand = cfg.retrieval_continuation_expand !== false;
    topicShiftJaccard = cfg.topic_shift_jaccard ?? 0.35;
    fts5UseAnd = cfg.fts5_use_and_for_content !== false;
  } catch {
    // Defaults
  }

  let topicKeywords: string | undefined;
  const candidates: string[] = [];

  if (options.sessionId) {
    try {
      const { BrainStore } = await import("./BrainStore.js");
      const topic = await BrainStore.getLatestSessionTopic(options.sessionId);
      if (topic) {
        topicKeywords = [topic.topic, topic.keywords].filter(Boolean).join(" ");
      }
      const recent = await BrainStore.getRecentUserMessages(options.sessionId, 8);
      candidates.push(...recent);
    } catch {
      // Store unavailable — still expand from WM
    }
  }

  if (options.workingMemoryItems?.length) {
    const wmTurns = [...options.workingMemoryItems]
      .filter((item) => item.source === "user" || item.source === "episodic")
      .sort((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0))
      .map((item) => item.content);
    candidates.push(...wmTurns);
  }

  const lastSubstantialTurn = pickLastSubstantialTurn(candidates, message);

  return expandRetrievalQuery({
    message,
    topicKeywords,
    lastSubstantialTurn,
    continuationExpand,
    topicShiftJaccard,
    fts5UseAnd,
  });
}

// ── MEM-65 as-of intent (lexical / regex only) ───────────────────────────────

export type AsOfKind = "date" | "relative" | "originally";

export interface AsOfIntent {
  /** Sqlite datetime (`YYYY-MM-DD HH:MM:SS`), UTC. */
  asOf: string;
  phrase: string;
  kind: AsOfKind;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** UTC sqlite datetime. */
export function toSqliteUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Rule-based detector. Default retrieve stays "valid now" when this returns null.
 * Undated "originally" / "before" / "used to" maps to one year ago so superseded
 * facts that were valid then enter Ω(q).
 */
export function detectAsOfIntent(text: string, now: Date = new Date()): AsOfIntent | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const iso = raw.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const asOf = `${iso[1]}-${iso[2]}-${iso[3]} 00:00:00`;
    if (!Number.isNaN(Date.parse(asOf.replace(" ", "T") + "Z"))) {
      return { asOf, phrase: iso[0], kind: "date" };
    }
  }

  const monthYear = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(20\d{2}|19\d{2})\b/,
  );
  if (monthYear) {
    const month = MONTHS[monthYear[1]!] ?? 0;
    const year = Number(monthYear[2]);
    return {
      asOf: toSqliteUtc(new Date(Date.UTC(year, month, 1))),
      phrase: monthYear[0],
      kind: "date",
    };
  }

  const nAgo = lower.match(/\b(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+ago\b/);
  if (nAgo) {
    const n = Number(nAgo[1]);
    const unit = nAgo[2]!;
    const d = new Date(now.getTime());
    if (unit.startsWith("day")) d.setUTCDate(d.getUTCDate() - n);
    else if (unit.startsWith("week")) d.setUTCDate(d.getUTCDate() - n * 7);
    else if (unit.startsWith("month")) d.setUTCMonth(d.getUTCMonth() - n);
    else d.setUTCFullYear(d.getUTCFullYear() - n);
    return { asOf: toSqliteUtc(d), phrase: nAgo[0], kind: "relative" };
  }

  if (/\byesterday\b/.test(lower)) {
    const d = startOfUtcDay(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return { asOf: toSqliteUtc(d), phrase: "yesterday", kind: "relative" };
  }
  if (/\blast\s+week\b/.test(lower)) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - 7);
    return { asOf: toSqliteUtc(d), phrase: "last week", kind: "relative" };
  }
  if (/\blast\s+month\b/.test(lower)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { asOf: toSqliteUtc(d), phrase: "last month", kind: "relative" };
  }
  if (/\blast\s+year\b/.test(lower)) {
    const d = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    return { asOf: toSqliteUtc(d), phrase: "last year", kind: "relative" };
  }

  if (
    /\b(?:what did we use before|originally|previously|used to|back then|at the time)\b/.test(lower)
  ) {
    const d = new Date(now.getTime());
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    const phrase =
      lower.match(/what did we use before|originally|previously|used to|back then|at the time/)?.[0]
      ?? "originally";
    return { asOf: toSqliteUtc(d), phrase, kind: "originally" };
  }
  return null;
}
