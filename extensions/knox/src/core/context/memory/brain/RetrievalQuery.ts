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

/** Content-bearing tokens (stopwords removed). */
export function contentWords(text: string): string[] {
  if (!text?.trim()) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !isStopword(t) && !/^(AND|OR|NOT|NEAR)$/i.test(t));
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    words.push(token);
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

  const useAnd = options?.useAnd !== false;
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

/**
 * Expand a user message into a retrieval query (pure; no I/O).
 *
 * Continuation: current content words ∪ topic keywords ∪ last substantial turn.
 * New task: current content words only (stopwords stripped). Last turn is not mixed in.
 */
export function expandRetrievalQuery(input: RetrievalQueryInput): RetrievalQueryResult {
  const original = input.message ?? "";
  const intent = detectIntent(original, input.topicKeywords, input.topicShiftJaccard);
  const bag: string[] = [...contentWords(original)];

  if (intent === "continuation" && input.continuationExpand !== false) {
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
