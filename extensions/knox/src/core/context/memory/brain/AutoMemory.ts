import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import type { SemanticCategory, SessionTopic, StoreInput } from "./types.js";
import { contentWords, RETRIEVAL_STOPWORDS } from "./RetrievalQuery.js";

export const HEURISTIC_IMPORTANCE = 0.45;
export const EXPLICIT_REMEMBER_IMPORTANCE = 0.85;

const ASSISTANT_FILLER_PREFIX =
  /^(?:let me|i['’]ll|i will|here['’]?s|here is)\b/i;

const LIGHT_VERBS = new Set([
  "do", "try", "make", "get", "go", "keep", "take", "put", "look", "check",
  "update", "fix", "add", "change", "start", "stop", "run", "see",
]);

const PROJECT_GENERIC = new Set([
  "project", "codebase", "architecture", "code", "app", "application",
]);

const PROJECT_CLAIM_VERBS = new Set([
  "uses", "use", "used", "has", "have", "runs", "stores", "store",
  "implements", "requires", "based", "written", "consists", "includes", "using",
]);

const ERROR_FIX_HINTS = [
  "fix", "solved", "resolved", "the issue was", "the problem was", "the solution",
];

/**
 * AutoMemory — Automatic memory extraction from conversations.
 *
 * Mirrors Knox-MS auto-memory system:
 * - Heuristic-based important fact detection (always runs, zero cost)
 * - Pattern matching for decisions, preferences, errors, conventions
 * - Automatic knowledge graph entity extraction
 * - Session activity tracking
 * - LLM-enhanced extraction when available (via BrainManager.llmExtractEntities)
 *
 * The heuristic layer always runs. LLM enhancement is triggered separately
 * by the BrainManager for substantial messages and is rate-limited.
 */
export class AutoMemory {
  // Track message count per session for periodic LLM extraction
  private static sessionMessageCounts: Map<string, number> = new Map();
  private static readonly LLM_EXTRACT_EVERY_N = 5; // LLM extraction every N messages

  // ── Extraction Pipeline ────────────────────────────────────────────────────

  /**
   * Process a message and automatically extract memories.
   * Called during conversation tracking to build knowledge passively.
   *
   * @returns Number of memories extracted and whether LLM enhancement should run
   */
  static async extract(
    content: string,
    role: string,
    sessionId: string,
  ): Promise<{ semantic_count: number; entity_count: number; should_llm_extract: boolean }> {
    let semanticCount = 0;
    let entityCount = 0;

    // Only extract from substantial messages
    if (content.length < 30) {
      return { semantic_count: 0, entity_count: 0, should_llm_extract: false };
    }

    // Track message count for periodic LLM extraction
    const count = (AutoMemory.sessionMessageCounts.get(sessionId) ?? 0) + 1;
    AutoMemory.sessionMessageCounts.set(sessionId, count);
    const shouldLlmExtract = count % AutoMemory.LLM_EXTRACT_EVERY_N === 0 && content.length > 100;

    // 1. Extract explicit facts/decisions/preferences
    const extracted = AutoMemory.extractSemanticMemories(content, role);

    // 2. Extract entities for the knowledge graph (rule-based, always)
    const entityResult = await KnowledgeGraph.extractAndStore(content);
    entityCount = entityResult.added + entityResult.updated;

    // REL-05: tag extracts with the session's current topic (create if needed)
    let topicId: number | undefined;
    if (extracted.length > 0) {
      const topic = await BrainStore.ensureCurrentTopic(sessionId, {
        keywords: extracted.map((m) => m.keywords ?? "").join(", "),
        topic: extracted[0]?.title,
      });
      topicId = topic.id;
    }

    // REL-13: open a task only when none exists (pre-turn already opened one).
    let openTaskId: string | undefined;
    if (extracted.length > 0 || role === "user") {
      try {
        const { ensureTaskForTurn, getOpenTask } = await import("./TaskContext.js");
        if (role === "user") {
          const open = await getOpenTask(sessionId);
          if (!open) {
            await ensureTaskForTurn(sessionId, content);
          }
        }
        openTaskId = (await getOpenTask(sessionId))?.id;
      } catch {
        openTaskId = undefined;
      }
    }

    for (const mem of extracted) {
      mem.session_id = sessionId;
      mem.topic_id = topicId;
      mem.task_id = openTaskId;
      if (entityResult.entities.length > 0) {
        mem.keywords = KnowledgeGraph.mergeEntityKeywords(
          mem.keywords ?? "",
          mem.content,
          mem.title,
          entityResult.entities,
        );
      }
      await BrainStore.storeSemanticDeduped(mem);
      semanticCount++;
    }

    return { semantic_count: semanticCount, entity_count: entityCount, should_llm_extract: shouldLlmExtract };
  }

  /**
   * REL-08: extract user and assistant turns separately. Tool summaries are
   * skipped unless they look like an error_fix.
   */
  static async extractTurn(input: {
    sessionId: string;
    userMessage?: string;
    assistantMessage?: string;
    toolSummary?: string;
  }): Promise<{ semantic_count: number; entity_count: number; should_llm_extract: boolean }> {
    let semanticCount = 0;
    let entityCount = 0;
    let shouldLlmExtract = false;

    const run = async (text: string | undefined, role: string) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      const result = await AutoMemory.extract(trimmed, role, input.sessionId);
      semanticCount += result.semantic_count;
      entityCount += result.entity_count;
      shouldLlmExtract = shouldLlmExtract || result.should_llm_extract;
    };

    await run(input.userMessage, "user");
    await run(input.assistantMessage, "assistant");
    if (input.toolSummary && AutoMemory.looksLikeErrorFix(input.toolSummary)) {
      await run(input.toolSummary, "assistant");
    }

    return { semantic_count: semanticCount, entity_count: entityCount, should_llm_extract: shouldLlmExtract };
  }

  /** Split a `User: …\nAssistant: …` blob used by older post-turn callers. */
  static splitLabeledTurn(
    content: string,
  ): { userMessage?: string; assistantMessage?: string } | null {
    const hasUser = /(?:^|\n)\s*User:\s*/i.test(content);
    const hasAssistant = /(?:^|\n)\s*Assistant:\s*/i.test(content);
    if (!hasUser && !hasAssistant) return null;
    const userMessage = content
      .match(/(?:^|\n)\s*User:\s*([\s\S]*?)(?=(?:\n\s*Assistant:)|$)/i)?.[1]
      ?.trim();
    const assistantMessage = content
      .match(/(?:^|\n)\s*Assistant:\s*([\s\S]*?)$/i)?.[1]
      ?.trim();
    if (!userMessage && !assistantMessage) return null;
    return { userMessage, assistantMessage };
  }

  static looksLikeErrorFix(text: string): boolean {
    const lower = text.toLowerCase();
    return ERROR_FIX_HINTS.some((h) => lower.includes(h));
  }

  static isAssistantFiller(text: string): boolean {
    return ASSISTANT_FILLER_PREFIX.test(text.trim());
  }

  // ── Semantic Extraction Rules ──────────────────────────────────────────────

  /**
   * Extract semantic memories from text using heuristic patterns.
   * Detects decisions, preferences, error fixes, conventions, and insights.
   */
  static extractSemanticMemories(content: string, role: string): StoreInput[] {
    const memories: StoreInput[] = [];
    if (role === "assistant" && AutoMemory.isFillerOnly(content)) {
      return memories;
    }

    const lower = content.toLowerCase();
    const sentences = content.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);

    const explicit = AutoMemory.extractExplicitRemember(content, role);
    if (explicit) memories.push(explicit);

    // Decision detection
    const decisionPatterns = [
      /(?:(?:we|i)(?:'ve| have)? decided(?: to)?)\s+(.+)/i,
      /(?:i(?:'ve|'ll| will| have)? (?:decided|chosen|picked|selected|opted|gone with))\s+(.+)/i,
      /(?:(?:let's|we(?:'ll)?) (?:go with|use|pick|choose|switch to|adopt))\s+(.+)/i,
      /(?:the (?:decision|choice|plan) is(?: to)?)\s+(.+)/i,
      /(?:(?:i|we) (?:should|must|need to))\s+(.+)/i,
    ];
    for (const pattern of decisionPatterns) {
      const match = pattern.exec(content);
      if (!match) continue;
      if (AutoMemory.isAssistantFiller(match[0])) continue;
      if (/should|must|need to/i.test(match[0]) && !AutoMemory.hasContentNoun(match[1])) {
        continue;
      }
      memories.push({
        category: "decision",
        title: `Decision: ${match[1].substring(0, 80)}`,
        content: match[0].trim(),
        importance: HEURISTIC_IMPORTANCE,
        keywords: AutoMemory.quickKeywords(match[0]),
      });
      break;
    }

    // Preference detection
    const preferencePatterns = [
      /(?:i (?:prefer|like|want|always use|favor))\s+(.+)/i,
      /(?:(?:please )?(?:always|never|don't))\s+(.+)/i,
      /(?:my (?:preference|style|convention|standard) is)\s+(.+)/i,
    ];
    for (const pattern of preferencePatterns) {
      const match = pattern.exec(content);
      if (match && role === "user" && AutoMemory.hasContentNoun(match[1])) {
        memories.push({
          category: "preference",
          title: `Preference: ${match[1].substring(0, 80)}`,
          content: match[0].trim(),
          importance: HEURISTIC_IMPORTANCE,
          keywords: AutoMemory.quickKeywords(match[0]),
        });
        break;
      }
    }

    // Error fix detection
    if (AutoMemory.looksLikeErrorFix(content)) {
      const fixPatterns = [
        /(?:the (?:fix|solution|issue|problem|error) (?:is|was))\s+(.+)/i,
        /(?:(?:fixed|solved|resolved) (?:by|with|it:?))\s+(.+)/i,
        /(?:(?:to fix|to solve|to resolve) (?:this|it|the))\s+(.+)/i,
      ];
      for (const pattern of fixPatterns) {
        const match = pattern.exec(content);
        if (match && AutoMemory.hasContentNoun(match[1])) {
          memories.push({
            category: "error_fix",
            title: `Fix: ${match[1].substring(0, 80)}`,
            content: match[0].trim(),
            importance: HEURISTIC_IMPORTANCE,
            keywords: AutoMemory.quickKeywords(match[0]),
          });
          break;
        }
      }
    }

    // Code pattern detection (from assistant messages with code blocks)
    if (role === "assistant" && content.includes("```")) {
      const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
      for (const block of codeBlocks.slice(0, 2)) {
        if (block.length > 50 && block.length < 2000) {
          const blockIdx = content.indexOf(block);
          const preceding = content.substring(Math.max(0, blockIdx - 200), blockIdx).trim();
          const lastSentence = preceding.split(/[.!?\n]+/).pop()?.trim() ?? "";

          if (lastSentence.length > 10 && !AutoMemory.isAssistantFiller(lastSentence)) {
            memories.push({
              category: "code_pattern",
              title: `Pattern: ${lastSentence.substring(0, 80)}`,
              content: `${lastSentence}\n${block}`,
              importance: HEURISTIC_IMPORTANCE,
              keywords: AutoMemory.quickKeywords(lastSentence),
            });
          }
        }
      }
    }

    // Convention/rule detection
    const conventionPatterns = [
      /(?:(?:the|our|this) (?:convention|rule|standard|practice|guideline) is)\s+(.+)/i,
      /(?:(?:we|you) (?:should |must )?(?:always|never))\s+(.+)/i,
      /(?:(?:follow|use) the (?:\w+ )?(?:convention|pattern|style))\s*[:.]?\s*(.+)/i,
    ];
    for (const pattern of conventionPatterns) {
      const match = pattern.exec(content);
      if (match && AutoMemory.hasContentNoun(match[1])) {
        memories.push({
          category: "insight",
          title: `Convention: ${match[1].substring(0, 80)}`,
          content: match[0].trim(),
          importance: HEURISTIC_IMPORTANCE,
          keywords: AutoMemory.quickKeywords(match[0]),
        });
        break;
      }
    }

    // Project context: only keep sentences with a concrete claim (REL-08)
    if (
      lower.includes("this project") ||
      lower.includes("our project") ||
      lower.includes("the codebase") ||
      lower.includes("the architecture")
    ) {
      for (const sentence of sentences) {
        const s = sentence.toLowerCase();
        if (
          !(s.includes("project") || s.includes("codebase") || s.includes("architecture"))
        ) {
          continue;
        }
        if (AutoMemory.isAssistantFiller(sentence)) continue;
        if (!AutoMemory.hasConcreteProjectClaim(sentence)) continue;
        memories.push({
          category: "project_context",
          title: `Project: ${sentence.trim().substring(0, 80)}`,
          content: sentence.trim(),
          importance: HEURISTIC_IMPORTANCE,
          keywords: AutoMemory.quickKeywords(sentence),
        });
        break;
      }
    }

    return memories;
  }

  private static extractExplicitRemember(content: string, role: string): StoreInput | null {
    if (role !== "user") return null;
    const match = /(?:please |kindly )?remember (?:that |this )?(.+)/i.exec(content);
    if (!match || !AutoMemory.hasContentNoun(match[1])) return null;
    return {
      category: "fact",
      title: `Remember: ${match[1].substring(0, 80)}`,
      content: match[0].trim(),
      importance: EXPLICIT_REMEMBER_IMPORTANCE,
      keywords: AutoMemory.quickKeywords(match[0]),
    };
  }

  static hasContentNoun(text: string): boolean {
    const words = contentWords(text);
    return words.some((w) => w.length >= 3 && !LIGHT_VERBS.has(w));
  }

  static hasConcreteProjectClaim(sentence: string): boolean {
    if (sentence.trim().endsWith("?")) return false;
    const words = contentWords(sentence).filter((w) => !PROJECT_GENERIC.has(w));
    if (words.length < 2) return false;
    return words.some((w) => PROJECT_CLAIM_VERBS.has(w));
  }

  static isFillerOnly(content: string): boolean {
    const sentences = content
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
    if (sentences.length === 0) return AutoMemory.isAssistantFiller(content);
    return sentences.every((s) => AutoMemory.isAssistantFiller(s));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static quickKeywords(text: string): string {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "this", "that", "it", "its",
      "i", "me", "my", "we", "our", "you", "your", "and", "or", "but", "not",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 10)
      .join(", ");
  }

  // ── Session Topic Detection ────────────────────────────────────────────────

  // Buffer of recent messages per session for topic detection windows
  private static sessionMessageBuffers: Map<string, { role: string; content: string; index: number }[]> = new Map();
  /** REL-05: detect shifts after ~4 mixed turns instead of 8. */
  static readonly TOPIC_WINDOW_SIZE = 4;
  private static readonly TOPIC_SHIFT_THRESHOLD = 0.65; // keyword overlap below this → new topic

  /** Test helper — drop buffered topic windows. */
  static resetTopicTracking(sessionId?: string): void {
    if (sessionId) {
      AutoMemory.sessionMessageBuffers.delete(sessionId);
    } else {
      AutoMemory.sessionMessageBuffers.clear();
    }
  }

  /**
   * Record a message for topic tracking and detect topic shifts.
   * Returns the detected topic if a new topic segment is identified.
   */
  static async detectTopicShift(
    sessionId: string,
    role: string,
    content: string,
    messageIndex: number,
  ): Promise<SessionTopic | null> {
    const buffer = AutoMemory.sessionMessageBuffers.get(sessionId) ?? [];
    buffer.push({ role, content, index: messageIndex });
    AutoMemory.sessionMessageBuffers.set(sessionId, buffer);

    // REL-05: cheap per-turn check against the current topic (does not wait for the window)
    const cheap = await AutoMemory.maybeCheapTopicShift(sessionId, role, content, messageIndex);
    if (cheap) return cheap;

    // Not enough messages to detect a window shift
    if (buffer.length < AutoMemory.TOPIC_WINDOW_SIZE) {
      return null;
    }

    // Split buffer into previous window and current window
    const midpoint = Math.floor(buffer.length / 2);
    const prevWindow = buffer.slice(0, midpoint);
    const currWindow = buffer.slice(midpoint);

    const prevKeywords = AutoMemory.extractWindowKeywords(prevWindow.map((m) => m.content));
    const currKeywords = AutoMemory.extractWindowKeywords(currWindow.map((m) => m.content));

    // Compute Jaccard similarity between keyword sets
    const overlap = AutoMemory.jaccardSimilarity(prevKeywords, currKeywords);

    // If overlap is low, we have a topic shift
    if (overlap < AutoMemory.TOPIC_SHIFT_THRESHOLD) {
      // Save the previous window as a detected topic
      const topicLabel = AutoMemory.labelTopic(prevKeywords);
      const keywords = [...prevKeywords].slice(0, 15).join(", ");
      const rangeStart = prevWindow[0].index;
      const rangeEnd = prevWindow[prevWindow.length - 1].index;
      const confidence = Math.max(0.3, 1 - overlap); // lower overlap = higher confidence of shift

      const topicId = await BrainStore.addSessionTopic(
        sessionId,
        topicLabel,
        keywords,
        rangeStart,
        rangeEnd,
        confidence,
      );

      // Open a lightweight current-topic for the new window so extracts tag Task B
      const newLabel = AutoMemory.labelTopic(currKeywords);
      const newKw = [...currKeywords].slice(0, 15).join(", ");
      await BrainStore.addSessionTopic(
        sessionId,
        newLabel,
        newKw,
        currWindow[0].index,
        currWindow[currWindow.length - 1].index,
        0.4,
      );

      // Reset buffer to current window (start of new topic)
      AutoMemory.sessionMessageBuffers.set(sessionId, [...currWindow]);

      await AutoMemory.notifyTopicShift(sessionId);

      return {
        id: topicId,
        session_id: sessionId,
        topic: topicLabel,
        keywords,
        message_range_start: rangeStart,
        message_range_end: rangeEnd,
        confidence,
        created_at: new Date().toISOString(),
      };
    }

    // If buffer grows too large without a shift, trim the oldest half
    if (buffer.length > AutoMemory.TOPIC_WINDOW_SIZE * 3) {
      AutoMemory.sessionMessageBuffers.set(sessionId, buffer.slice(midpoint));
    }

    return null;
  }

  /**
   * REL-05: Jaccard of this message vs the active topic. Disjoint content
   * words (Jaccard 0, below topic_shift_jaccard) open a new current topic.
   */
  private static async maybeCheapTopicShift(
    sessionId: string,
    role: string,
    content: string,
    messageIndex: number,
  ): Promise<SessionTopic | null> {
    const latest = await BrainStore.getLatestSessionTopic(sessionId);
    if (!latest) return null;

    const msgWords = contentWords(content);
    if (msgWords.length < 2) return null;

    const topicWords = contentWords(`${latest.topic} ${latest.keywords}`);
    if (topicWords.length === 0) return null;

    const shared = msgWords.filter((w) => topicWords.includes(w));
    const overlap = AutoMemory.jaccardSimilarity(new Set(msgWords), new Set(topicWords));
    let threshold = 0.35;
    try {
      threshold = BrainStore.getConfig().topic_shift_jaccard ?? 0.35;
    } catch {
      // defaults
    }

    // Require disjoint content words so long related turns do not false-shift
    if (shared.length > 0 || overlap >= threshold) return null;

    const msgKw = AutoMemory.extractWindowKeywords([content]);
    const topicLabel = AutoMemory.labelTopic(msgKw);
    const keywords = [...msgKw].slice(0, 15).join(", ");
    const confidence = Math.max(0.3, 1 - overlap);
    const topicId = await BrainStore.addSessionTopic(
      sessionId,
      topicLabel,
      keywords,
      messageIndex,
      messageIndex,
      confidence,
    );

    AutoMemory.sessionMessageBuffers.set(sessionId, [{ role, content, index: messageIndex }]);
    await AutoMemory.notifyTopicShift(sessionId);

    return {
      id: topicId,
      session_id: sessionId,
      topic: topicLabel,
      keywords,
      message_range_start: messageIndex,
      message_range_end: messageIndex,
      confidence,
      created_at: new Date().toISOString(),
    };
  }

  private static async notifyTopicShift(sessionId: string): Promise<void> {
    try {
      const { BrainManager } = await import("./BrainManager.js");
      await BrainManager.onTopicShift(sessionId);
    } catch {
      // WM flush is best-effort — extraction must not fail
    }
  }

  /**
   * Flush remaining buffered messages as a final topic when a session closes.
   */
  static async flushSessionTopics(sessionId: string, lastMessageIndex: number): Promise<SessionTopic | null> {
    const buffer = AutoMemory.sessionMessageBuffers.get(sessionId);
    if (!buffer || buffer.length < 3) {
      AutoMemory.sessionMessageBuffers.delete(sessionId);
      return null;
    }

    const keywords = AutoMemory.extractWindowKeywords(buffer.map((m) => m.content));
    const topicLabel = AutoMemory.labelTopic(keywords);
    const kw = [...keywords].slice(0, 15).join(", ");

    const topicId = await BrainStore.addSessionTopic(
      sessionId,
      topicLabel,
      kw,
      buffer[0].index,
      lastMessageIndex,
      0.5,
    );

    AutoMemory.sessionMessageBuffers.delete(sessionId);

    return {
      id: topicId,
      session_id: sessionId,
      topic: topicLabel,
      keywords: kw,
      message_range_start: buffer[0].index,
      message_range_end: lastMessageIndex,
      confidence: 0.5,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Extract top keywords from a window of messages.
   */
  private static extractWindowKeywords(messages: string[]): Set<string> {
    const stopWords = RETRIEVAL_STOPWORDS;

    const freq: Map<string, number> = new Map();
    for (const msg of messages) {
      const words = msg
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));
      for (const w of words) {
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }

    // Return top keywords by frequency
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    return new Set(sorted.slice(0, 20).map(([word]) => word));
  }

  /**
   * Jaccard similarity between two keyword sets.
   */
  private static jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const w of a) {
      if (b.has(w)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 1 : intersection / union;
  }

  /**
   * Generate a human-readable topic label from keyword set.
   */
  private static labelTopic(keywords: Set<string>): string {
    const topWords = [...keywords].slice(0, 4);
    if (topWords.length === 0) return "General Discussion";
    // Capitalize first word, join with " / "
    return topWords
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" / ");
  }
}
