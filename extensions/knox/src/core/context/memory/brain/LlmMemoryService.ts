import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { ResilientLlm } from "./LlmResilience.js";
import type { ILLM } from "../../../index.js";
import type {
  AddEntityInput,
  EntityType,
  GraphEntity,
  SemanticCategory,
  StoreInput,
} from "./types.js";

/**
 * LlmMemoryService — LLM-enhanced memory operations.
 *
 * Mirrors Knox-MS patterns where the LLM enriches memory operations:
 * - Entity extraction via LLM (NER for people, orgs, concepts, not just regex)
 * - Session summarization via LLM (real summaries, not just message previews)
 * - Importance scoring via LLM (semantic understanding vs keyword heuristics)
 * - Post-action memory updates (LLM decides what to remember after tool results)
 *
 * All methods accept an ILLM instance and respect rate limits.
 * Falls back to heuristic methods when LLM is unavailable or rate-limited.
 */
export class LlmMemoryService {
  // ── LLM Entity Extraction ─────────────────────────────────────────────────

  /**
   * Extract entities from text using LLM-powered NER.
   * Detects people, organizations, locations, events, and domain concepts
   * that rule-based extraction misses.
   *
   * Falls back to KnowledgeGraph.extractEntitiesFromText() if LLM unavailable.
   */
  static async extractEntities(
    llm: ILLM,
    text: string,
    sessionId?: string,
  ): Promise<{ added: number; updated: number; entities: GraphEntity[]; llm_used: boolean }> {
    // Check rate limit
    const allowed = await BrainStore.checkRateLimit(500);
    if (!allowed) {
      const fallback = await KnowledgeGraph.extractAndStore(text);
      return { ...fallback, llm_used: false };
    }

    try {
      const prompt = `Extract all named entities and their relationships from the following text. Return a JSON object with two arrays:

{
  "entities": [
    {"name": "entity name", "type": "person|organization|technology|concept|project|file|function|class|variable|location|event|product", "description": "brief description", "confidence": 0.0-1.0}
  ],
  "relationships": [
    {"source": "entity name", "target": "entity name", "relationship": "uses|depends_on|created_by|contains|related_to|extends|implements|calls|imports|configures|deployed_on|part_of|authored_by|manages|tested_by", "weight": 0.0-1.0}
  ]
}

For entities, focus on:
1. People's names (even partial or first-name only)
2. Organizations and companies
3. Technologies, frameworks, libraries, languages
4. Domain-specific concepts and terms
5. Project names
6. Locations mentioned
7. Events or milestones

For relationships, identify HOW entities relate:
- "uses": entity A uses/employs entity B
- "depends_on": entity A depends on entity B
- "created_by": entity A was created/written by entity B
- "contains": entity A contains/includes entity B
- "extends": entity A extends/inherits entity B
- "implements": entity A implements entity B
- "calls": entity A calls/invokes entity B
- "imports": entity A imports entity B
- "part_of": entity A is part of entity B
- "related_to": general relationship

Only return the JSON, no other text.

Text:
${text.substring(0, 3000)}`;

      const response = await ResilientLlm.complete(llm, prompt, { maxTokens: 1500 });

      await BrainStore.recordLlmCall(LlmMemoryService.estimateTokens(prompt + response));

      const parsed = LlmMemoryService.parseJsonFromResponse(response);
      const entities = LlmMemoryService.parseLlmEntities(
        Array.isArray(parsed) ? JSON.stringify(parsed) : JSON.stringify(parsed?.entities ?? []),
      );
      const relationships = parsed?.relationships ?? [];

      // Also run rule-based extraction to catch code patterns the LLM might miss
      const ruleEntities = KnowledgeGraph.extractEntitiesFromText(text);

      // Merge: LLM entities take priority, add unique rule-based ones
      const allEntities = [...entities];
      const seen = new Set(entities.map((e) => `${e.entity_type}:${e.name.toLowerCase()}`));
      for (const re of ruleEntities) {
        const key = `${re.entity_type}:${re.name.toLowerCase()}`;
        if (!seen.has(key)) {
          allEntities.push(re);
          seen.add(key);
        }
      }

      // Store all entities
      let added = 0;
      let updated = 0;
      const storedEntities: GraphEntity[] = [];

      for (const input of allEntities) {
        const existing = await BrainStore.findEntity(
          input.name.toLowerCase().trim(),
          input.entity_type,
        );

        const id = await KnowledgeGraph.addEntity(input);
        const entity = await BrainStore.getEntity(id);
        if (entity) storedEntities.push(entity);

        if (existing) updated++;
        else added++;
      }

      // Create typed relationship edges from LLM extraction
      const entityNameToId = new Map<string, number>();
      for (const e of storedEntities) {
        entityNameToId.set(e.name.toLowerCase(), e.id);
      }

      for (const rel of relationships) {
        if (!rel.source || !rel.target || !rel.relationship) continue;
        const sourceId = entityNameToId.get(rel.source.toLowerCase());
        const targetId = entityNameToId.get(rel.target.toLowerCase());
        if (sourceId && targetId && sourceId !== targetId) {
          const validRelationships = [
            "uses", "depends_on", "created_by", "contains", "related_to",
            "extends", "implements", "calls", "imports", "configures",
            "deployed_on", "part_of", "authored_by", "manages", "tested_by",
          ];
          const relationship = validRelationships.includes(rel.relationship)
            ? rel.relationship
            : "related_to";
          await KnowledgeGraph.addEdge({
            source_entity_id: sourceId,
            target_entity_id: targetId,
            relationship,
            weight: typeof rel.weight === "number" ? Math.max(0, Math.min(1, rel.weight)) : 0.6,
          });
        }
      }

      // Also create co-mention edges for entities without explicit relationships
      if (storedEntities.length >= 2) {
        for (let i = 0; i < storedEntities.length - 1; i++) {
          for (let j = i + 1; j < Math.min(i + 5, storedEntities.length); j++) {
            // Only co-mention if no typed relationship exists already
            const hasTyped = relationships.some(
              (r: any) =>
                (r.source?.toLowerCase() === storedEntities[i].name.toLowerCase() &&
                  r.target?.toLowerCase() === storedEntities[j].name.toLowerCase()) ||
                (r.source?.toLowerCase() === storedEntities[j].name.toLowerCase() &&
                  r.target?.toLowerCase() === storedEntities[i].name.toLowerCase()),
            );
            if (!hasTyped) {
              await KnowledgeGraph.addEdge({
                source_entity_id: storedEntities[i].id,
                target_entity_id: storedEntities[j].id,
                relationship: "co_mentioned",
                weight: 0.3,
              });
            }
          }
        }
      }

      return { added, updated, entities: storedEntities, llm_used: true };
    } catch (error) {
      // Fallback to rule-based
      const fallback = await KnowledgeGraph.extractAndStore(text);
      return { ...fallback, llm_used: false };
    }
  }

  // ── LLM Session Summarization ──────────────────────────────────────────────

  /**
   * Generate a real LLM-powered summary of a session.
   * Produces a structured summary with topics, decisions, outcomes, and action items.
   *
   * Falls back to heuristic summary if LLM unavailable.
   */
  static async summarizeSession(
    llm: ILLM,
    sessionId: string,
    detailLevel: "brief" | "detailed" = "detailed",
  ): Promise<{ summary: string; llm_used: boolean }> {
    const history = await BrainStore.getEpisodicBySession(sessionId, 500);
    const session = await BrainStore.getSession(sessionId);

    if (history.length === 0) {
      return { summary: "No conversation history found for this session.", llm_used: false };
    }

    // Use incremental summarization if a previous summary exists
    if (session?.summary && session.summary.length > 50) {
      return LlmMemoryService.incrementalSummarize(llm, sessionId, session, history, detailLevel);
    }

    // Check rate limit
    const allowed = await BrainStore.checkRateLimit(2000);
    if (!allowed) {
      return { summary: LlmMemoryService.heuristicSummary(session, history), llm_used: false };
    }

    try {
      // Build conversation excerpt for the LLM
      const conversationExcerpt = history
        .slice(-100) // Last 100 messages
        .map((msg) => `[${msg.role}]: ${msg.content.substring(0, 300)}`)
        .join("\n");

      const detailInstr = detailLevel === "brief"
        ? "Keep the summary concise (3-5 sentences)."
        : "Provide a detailed summary with sections.";

      const prompt = `Summarize the following conversation session. ${detailInstr}

Session Title: ${session?.title ?? "Untitled"}
Messages: ${history.length}
Time Period: ${history[0].created_at} to ${history[history.length - 1].created_at}

Include:
1. **Main Topics**: What was discussed
2. **Key Decisions**: Any decisions made
3. **Problems Solved**: Errors fixed, issues resolved
4. **Action Items**: Any pending tasks or follow-ups
5. **Important Context**: Technical details, preferences stated, conventions established

Conversation:
${conversationExcerpt.substring(0, 6000)}`;

      const response = await ResilientLlm.complete(llm, prompt, {
        maxTokens: detailLevel === "brief" ? 300 : 800,
      });

      await BrainStore.recordLlmCall(LlmMemoryService.estimateTokens(prompt + response));

      const summary = response;

      // Store the summary on the session
      await BrainStore.updateSession(sessionId, { summary });

      // Also store as a semantic memory for cross-session recall
      await BrainStore.storeSemantic({
        category: "summary",
        title: `Session Summary: ${session?.title ?? sessionId}`,
        content: summary,
        session_id: sessionId,
        keywords: LlmMemoryService.extractKeywords(summary),
        importance: 0.75,
      });

      return { summary, llm_used: true };
    } catch (error) {
      return { summary: LlmMemoryService.heuristicSummary(session, history), llm_used: false };
    }
  }

  // ── Incremental Summarization ──────────────────────────────────────────────

  /**
   * Update an existing session summary incrementally.
   *
   * Instead of regenerating from scratch, this takes the existing summary
   * and only processes new messages since the last update. Uses a sliding
   * window approach: feed the LLM the previous summary + recent messages,
   * ask it to produce an updated summary. This is cheaper and faster than
   * full re-summarization, especially for long sessions.
   */
  private static async incrementalSummarize(
    llm: ILLM,
    sessionId: string,
    session: any,
    history: any[],
    detailLevel: "brief" | "detailed",
  ): Promise<{ summary: string; llm_used: boolean }> {
    const allowed = await BrainStore.checkRateLimit(1000);
    if (!allowed) {
      return { summary: session.summary, llm_used: false };
    }

    try {
      // Get recent messages (sliding window: last 30 messages)
      const recentMessages = history
        .slice(-30)
        .map((msg: any) => `[${msg.role}]: ${msg.content.substring(0, 250)}`)
        .join("\n");

      const prompt = `You have an existing summary of a conversation session. New messages have been added. Update the summary to incorporate the new content while keeping it coherent.

${detailLevel === "brief" ? "Keep it concise (3-5 sentences)." : "Maintain detailed sections."}

Existing Summary:
${session.summary.substring(0, 2000)}

New Messages (recent window):
${recentMessages.substring(0, 3000)}

Total messages in session: ${history.length}

Produce an UPDATED summary that merges old and new information. Drop outdated or superseded details. Keep the most important facts, decisions, and action items.`;

      const response = await ResilientLlm.complete(llm, prompt, {
        maxTokens: detailLevel === "brief" ? 300 : 600,
      });

      await BrainStore.recordLlmCall(LlmMemoryService.estimateTokens(prompt + response));

      await BrainStore.updateSession(sessionId, { summary: response });
      return { summary: response, llm_used: true };
    } catch {
      return { summary: session.summary, llm_used: false };
    }
  }

  // ── LLM Importance Scoring ─────────────────────────────────────────────────

  /**
   * Evaluate the importance of a piece of content using LLM understanding.
   * Returns a score 0.0-1.0 with reasoning.
   *
   * Falls back to heuristic scoring if LLM unavailable.
   */
  static async evaluateImportance(
    llm: ILLM,
    content: string,
    role?: string,
    context?: string,
  ): Promise<{ score: number; reason: string; llm_used: boolean }> {
    // Check rate limit
    const allowed = await BrainStore.checkRateLimit(300);
    if (!allowed) {
      const score = LlmMemoryService.heuristicImportance(content, role ?? "user");
      return { score, reason: "Heuristic scoring (rate limited)", llm_used: false };
    }

    try {
      const prompt = `Rate the importance of the following message for long-term memory storage on a scale of 0.0 to 1.0.

Consider:
- Does it contain a decision, preference, or convention? (high importance)
- Does it describe an error fix or solution? (high importance)
- Does it mention project architecture or structure? (medium-high importance)
- Is it a routine greeting or acknowledgment? (low importance)
- Does it contain reusable code patterns? (medium importance)
- Does it state facts about the user or project? (medium-high importance)

Message role: ${role ?? "unknown"}
${context ? `Context: ${context.substring(0, 500)}` : ""}

Message:
${content.substring(0, 1500)}

Respond with ONLY a JSON object: {"score": 0.X, "reason": "brief explanation"}`;

      const response = await ResilientLlm.complete(llm, prompt, { maxTokens: 100 });

      await BrainStore.recordLlmCall(LlmMemoryService.estimateTokens(prompt + response));

      const parsed = LlmMemoryService.parseJsonFromResponse(response);
      if (parsed && typeof parsed.score === "number") {
        return {
          score: Math.max(0, Math.min(1, parsed.score)),
          reason: parsed.reason ?? "LLM evaluation",
          llm_used: true,
        };
      }

      // Parse failed, fall back
      const score = LlmMemoryService.heuristicImportance(content, role ?? "user");
      return { score, reason: "Heuristic scoring (LLM parse failed)", llm_used: false };
    } catch {
      const score = LlmMemoryService.heuristicImportance(content, role ?? "user");
      return { score, reason: "Heuristic scoring (LLM error)", llm_used: false };
    }
  }

  // ── LLM Post-Action Memory ─────────────────────────────────────────────────

  /**
   * After a tool action completes, ask the LLM what should be remembered.
   * Mirrors Knox-MS "UpdatingMemory" loop state.
   *
   * The LLM analyzes the action and its result, then returns memory operations
   * (store facts, update entities, record patterns).
   */
  static async postActionMemory(
    llm: ILLM,
    actionDescription: string,
    actionResult: string,
    sessionId?: string,
  ): Promise<{ memories_created: number; entities_created: number; patterns_recorded: number; llm_used: boolean }> {
    // Check rate limit
    const allowed = await BrainStore.checkRateLimit(1000);
    if (!allowed) {
      return { memories_created: 0, entities_created: 0, patterns_recorded: 0, llm_used: false };
    }

    try {
      const prompt = `Analyze the following action and its result. Determine what should be remembered for future reference.

Action: ${actionDescription.substring(0, 500)}
Result: ${actionResult.substring(0, 2000)}

Return a JSON object with:
{
  "memories": [
    {
      "category": "fact|preference|decision|insight|code_pattern|error_fix|project_context|workflow",
      "title": "brief title (max 80 chars)",
      "content": "what to remember",
      "importance": 0.0-1.0
    }
  ],
  "entities": [
    {
      "name": "entity name",
      "type": "person|organization|technology|concept|project|file|function|class",
      "description": "brief description"
    }
  ],
  "pattern": {
    "goal_type": "coding|analysis|research|debugging|documentation|other",
    "signature": "brief pattern name",
    "description": "what approach worked/failed",
    "success": true
  } or null
}

Only return the JSON, no other text. If nothing is worth remembering, return {"memories":[],"entities":[],"pattern":null}.`;

      const response = await ResilientLlm.complete(llm, prompt, { maxTokens: 800 });

      await BrainStore.recordLlmCall(LlmMemoryService.estimateTokens(prompt + response));

      const parsed = LlmMemoryService.parseJsonFromResponse(response);
      if (!parsed || !Array.isArray(parsed.memories)) {
        return { memories_created: 0, entities_created: 0, patterns_recorded: 0, llm_used: true };
      }

      let memoriesCreated = 0;
      let entitiesCreated = 0;
      let patternsRecorded = 0;

      const structuredCategories = new Set<SemanticCategory>([
        "fact",
        "preference",
        "decision",
        "summary",
        "insight",
        "code_pattern",
        "error_fix",
        "project_context",
        "workflow",
      ]);

      // Store only structured facts; skip rows that overlap recent heuristic extracts
      for (const mem of parsed.memories) {
        if (!mem || typeof mem.title !== "string" || typeof mem.content !== "string") continue;
        const title = mem.title.trim().substring(0, 100);
        const content = mem.content.trim().substring(0, 2000);
        if (title.length < 3 || content.length < 8) continue;
        const category = structuredCategories.has(mem.category)
          ? (mem.category as SemanticCategory)
          : mem.category
            ? null
            : "fact";
        if (!category) continue;

        const keywords = LlmMemoryService.extractKeywords(`${title} ${content}`);
        const overlap = await BrainStore.findDuplicates(title, keywords, category);
        if (overlap.length > 0 && overlap[0].similarity >= 0.65) {
          continue;
        }

        const stored = await BrainStore.storeSemanticDeduped({
          category,
          title,
          content,
          session_id: sessionId,
          importance:
            typeof mem.importance === "number"
              ? Math.max(0, Math.min(1, mem.importance))
              : 0.6,
          keywords,
        });
        if (!stored.deduplicated) memoriesCreated++;
      }

      // Store entities
      for (const entity of parsed.entities ?? []) {
        if (entity.name && entity.type) {
          await KnowledgeGraph.addEntity({
            name: entity.name,
            entity_type: (entity.type ?? "custom") as EntityType,
            description: entity.description ?? "",
            confidence: 0.8,
          });
          entitiesCreated++;
        }
      }

      // Record pattern
      if (parsed.pattern && parsed.pattern.signature) {
        await BrainStore.addPattern({
          goal_type: parsed.pattern.goal_type ?? "other",
          pattern_signature: parsed.pattern.signature,
          description: parsed.pattern.description ?? "",
          success: parsed.pattern.success !== false,
          tokens_used: 0,
          metadata: {},
        });
        patternsRecorded++;
      }

      return {
        memories_created: memoriesCreated,
        entities_created: entitiesCreated,
        patterns_recorded: patternsRecorded,
        llm_used: true,
      };
    } catch {
      return { memories_created: 0, entities_created: 0, patterns_recorded: 0, llm_used: false };
    }
  }

  // ── Token Counting ─────────────────────────────────────────────────────────

  /**
   * Local context-budget estimate (chars ÷ 4). KnoxChat bills at the provider.
   */
  static countTokens(_llm: ILLM, text: string): number {
    return Math.ceil(text.length / 4);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static parseLlmEntities(response: string): AddEntityInput[] {
    const entities: AddEntityInput[] = [];
    try {
      const parsed = LlmMemoryService.parseJsonFromResponse(response);
      if (!Array.isArray(parsed)) return entities;

      for (const item of parsed) {
        if (item.name && item.type) {
          const validTypes: EntityType[] = [
            "person", "organization", "technology", "concept", "project",
            "file", "function", "class", "variable", "location", "event", "product", "custom",
          ];
          const entityType = validTypes.includes(item.type) ? item.type : "custom";

          entities.push({
            name: item.name,
            entity_type: entityType,
            description: item.description ?? `Extracted by LLM`,
            confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.8,
          });
        }
      }
    } catch {
      // Parse failure — return empty
    }
    return entities;
  }

  private static parseJsonFromResponse(response: string): any {
    try {
      // Try direct parse
      return JSON.parse(response.trim());
    } catch {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1].trim());
        } catch {
          // fall through
        }
      }
      // Try finding first { or [ to end
      const braceStart = response.indexOf("{");
      const bracketStart = response.indexOf("[");
      const start = braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)
        ? braceStart
        : bracketStart;
      if (start >= 0) {
        const isArray = response[start] === "[";
        const endChar = isArray ? "]" : "}";
        let depth = 0;
        for (let i = start; i < response.length; i++) {
          if (response[i] === (isArray ? "[" : "{")) depth++;
          if (response[i] === endChar) depth--;
          if (depth === 0) {
            try {
              return JSON.parse(response.substring(start, i + 1));
            } catch {
              return null;
            }
          }
        }
      }
      return null;
    }
  }

  private static heuristicSummary(session: any, history: any[]): string {
    const parts: string[] = [];
    parts.push(`Session: ${session?.title ?? "Untitled"}`);
    parts.push(`Messages: ${history.length}`);
    parts.push(`Period: ${history[0].created_at} — ${history[history.length - 1].created_at}`);
    parts.push("");

    const important = history.filter((m) => m.importance_score >= 0.6).slice(0, 20);
    if (important.length > 0) {
      parts.push("Key Topics:");
      for (const msg of important) {
        const preview = msg.content.substring(0, 200).replace(/\n/g, " ");
        parts.push(`  [${msg.role}] ${preview}${msg.content.length > 200 ? "..." : ""}`);
      }
    }

    const userMessages = history.filter((m) => m.role === "user").slice(0, 30);
    if (userMessages.length > 0) {
      parts.push("");
      parts.push("User Requests:");
      for (const msg of userMessages) {
        const preview = msg.content.substring(0, 150).replace(/\n/g, " ");
        parts.push(`  - ${preview}${msg.content.length > 150 ? "..." : ""}`);
      }
    }

    return parts.join("\n");
  }

  private static heuristicImportance(content: string, role: string): number {
    let score = 0.5;

    if (role === "user") {
      score += 0.1;
      if (content.includes("?")) score += 0.05;
      if (content.length > 200) score += 0.1;
    }
    if (content.includes("```")) score += 0.1;

    const terms = ["error", "fix", "decision", "important", "remember", "always", "never", "convention", "pattern", "rule"];
    for (const term of terms) {
      if (content.toLowerCase().includes(term)) {
        score += 0.05;
      }
    }

    return Math.min(1.0, score);
  }

  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private static extractKeywords(text: string): string {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "have",
      "has", "had", "do", "does", "did", "will", "would", "could", "should",
      "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
      "this", "that", "it", "its", "i", "me", "my", "we", "you", "and",
      "or", "but", "not", "can", "may", "just", "also", "than", "then",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 15)
      .join(", ");
  }
}
