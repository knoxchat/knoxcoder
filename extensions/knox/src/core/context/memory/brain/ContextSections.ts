import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { LearningEngine } from "./LearningEngine.js";
import { getBudgetQueryAdjustments, getBudgetRatios, getContextAssemblyLimits, getMemoryConfig, type ModeSettings } from "./memoryConfigAccess.js";
import { filterSemanticByProjectScope, getProjectSessionIds } from "./projectScope.js";
import { contentWords } from "./RetrievalQuery.js";
import { recipeMemoryIsVerified } from "../recipes/memoryLink.js";
import { evaluateRelevanceGate, isMismatchActive, LEXICAL_SCORE_MIN } from "./RelevanceGate.js";
import { hasGraphExpandableTokens, isCommonNounEntityName, queryMentionsEntity } from "./GraphRetrieval.js";
import type { FusionResult } from "./RetrievalFusion.js";
import type { InjectedMemoryItem, SemanticMemory, EpisodicMemory } from "./types.js";

/** REL-10: session summary needs this fraction of query content-words to inject (non-full modes). */
export const SUMMARY_INJECT_MIN_OVERLAP = 0.2;
/** REL-10: when many pins miss the query, keep at most this many unmatched pins. */
export const PINNED_UNMATCHED_CAP = 2;
/** REL-10: "none match" unmatched-cap applies when pinned count exceeds this. */
export const PINNED_NONE_MATCH_THRESHOLD = 3;
export interface ContextSection {
  text: string;
  /** Higher = keep longer (session summary highest among retrievable). */
  priority: number;
  /** Higher = older / compress first within same priority. */
  ageRank: number;
}

function overlapScore(
  query: string,
  gate: { lexicalOverlap: string[] },
): number | undefined {
  const q = contentWords(query).length;
  if (q === 0 || gate.lexicalOverlap.length === 0) return undefined;
  return Math.min(1, gate.lexicalOverlap.length / q);
}

function uniqueEvidence(lexical: string[], entities: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...lexical, ...entities]) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
    if (out.length >= 4) break;
  }
  return out;
}

// Lazy import to avoid circular dependency
let _BrainManager: any = null;
export async function getBrainManager() {
  if (!_BrainManager) {
    const mod = await import("./BrainManager.js");
    _BrainManager = mod.BrainManager;
  }
  return _BrainManager;
}

/** Section builders and budgeting for ContextBuilder (split out; no logic change). */
export class ContextSections {
  static async buildSemanticContext(
    query: string,
    sessionId: string | undefined,
    maxTokens: number,
    mode: ModeSettings,
    fusion: {
      fusionHits: FusionResult[];
      fusionEmpty: boolean;
      fusionById: Map<string, FusionResult>;
    },
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    const pinnedLimit = getContextAssemblyLimits().pinnedLimit;
    const pinnedTags = await BrainStore.searchByTag("pinned", "semantic", pinnedLimit);
    const pinnedMemories: SemanticMemory[] = [];
    for (const tag of pinnedTags) {
      const mem = await BrainStore.getSemanticById(tag.memory_id);
      if (mem) pinnedMemories.push(mem);
    }

    const projectSessionIds = await getProjectSessionIds(sessionId);
    const hasLexicalQuery = contentWords(query).length > 0;
    const fusionSemantic = fusion.fusionHits
      .filter((r) => r.type === "semantic")
      .map((r) => r.data as SemanticMemory);

    const requireLexical = getMemoryConfig().retrieval_require_lexical !== false;
    const currentTopicId = sessionId
      ? (await BrainStore.getLatestSessionTopic(sessionId))?.id ?? null
      : null;

    let fallback: SemanticMemory[] = [];
    if (fusion.fusionEmpty && hasLexicalQuery) {
      const fallbackRaw = await BrainStore.searchSemantic(query, undefined, mode.semanticLimit);
      fallback = filterSemanticByProjectScope(fallbackRaw, projectSessionIds).filter((mem) => {
        if (isMismatchActive(mem, currentTopicId)) return false;
        const gate = evaluateRelevanceGate({
          query,
          title: mem.title,
          keywords: mem.keywords,
          content: mem.content,
          requireLexical,
          verified: recipeMemoryIsVerified(mem.content),
        });
        return gate.passed;
      });
    }

    const scopedPins = filterSemanticByProjectScope(
      pinnedMemories.filter(Boolean),
      projectSessionIds,
    );
    const matchingPins: SemanticMemory[] = [];
    const unmatchedPins: SemanticMemory[] = [];
    for (const mem of scopedPins) {
      if (ContextSections.pinMatchesQuery(mem, query)) matchingPins.push(mem);
      else unmatchedPins.push(mem);
    }
    matchingPins.sort((a, b) => b.importance_score - a.importance_score);
    unmatchedPins.sort((a, b) => b.importance_score - a.importance_score);

    let unmatchedToInclude = unmatchedPins;
    let omittedUnmatched = 0;
    if (matchingPins.length === 0 && scopedPins.length > PINNED_NONE_MATCH_THRESHOLD) {
      const cap = Math.max(0, getMemoryConfig().pinned_unmatched_cap ?? PINNED_UNMATCHED_CAP);
      unmatchedToInclude = unmatchedPins.slice(0, cap);
      omittedUnmatched = unmatchedPins.length - unmatchedToInclude.length;
    }

    const seen = new Set<number>();
    const takeUnique = (list: SemanticMemory[]): SemanticMemory[] =>
      list.filter((mem) => {
        if (!mem || seen.has(mem.id)) return false;
        if (mem.importance_score < mode.minImportance) return false;
        seen.add(mem.id);
        return true;
      });

    const matchingUnique = takeUnique(matchingPins);
    const unmatchedPinIds = new Set(unmatchedPins.map((m) => m.id));
    let fusionOrFallback = takeUnique(
      (fusionSemantic.length > 0 ? fusionSemantic : fallback).filter(
        (mem) => !unmatchedPinIds.has(mem.id),
      ),
    );
    fusionOrFallback = filterSemanticByProjectScope(fusionOrFallback, projectSessionIds);
    const unmatchedUnique = takeUnique(unmatchedToInclude);

    if (mode.preferSummaries) {
      const bySummary = (list: SemanticMemory[]) =>
        [...list].sort((a, b) => {
          const aSummary = a.category === "summary" ? 1 : 0;
          const bSummary = b.category === "summary" ? 1 : 0;
          if (aSummary !== bSummary) return bSummary - aSummary;
          return b.importance_score - a.importance_score;
        });
      fusionOrFallback = bySummary(fusionOrFallback);
    }

    const primary = [...matchingUnique, ...fusionOrFallback];
    if (primary.length === 0 && unmatchedUnique.length === 0) {
      return { text: null, items: [] };
    }

    const lines: string[] = ["=== Relevant Knowledge from Memory ==="];
    const items: InjectedMemoryItem[] = [];
    let tokens = ContextSections.estimateTokens(lines[0]);
    const pinnedIds = new Set(scopedPins.map((m) => m.id));

    const appendMem = (mem: SemanticMemory): boolean => {
      const pinned = pinnedIds.has(mem.id);
      if (!pinned) {
        const hit = fusion.fusionById.get(`semantic:${mem.id}`);
        const gate = evaluateRelevanceGate({
          query,
          title: mem.title,
          keywords: mem.keywords,
          content: mem.content,
          fts5: hit?.scores.fts5,
          trigram: hit?.scores.trigram,
          verified: recipeMemoryIsVerified(mem.content),
        });
        if (!gate.passed) return true;
      }
      const entry = `${pinned ? "[pinned] " : ""}[${mem.category}] ${mem.title}: ${mem.content}`;
      const entryTokens = ContextSections.estimateTokens(entry);
      if (tokens + entryTokens > maxTokens) return false;
      lines.push(entry);
      tokens += entryTokens;
      items.push(
        ContextSections.semanticProvenance(
          mem,
          query,
          pinned,
          fusion.fusionById.get(`semantic:${mem.id}`),
        ),
      );
      return true;
    };

    for (const mem of primary) {
      if (!appendMem(mem)) break;
    }
    for (const mem of unmatchedUnique) {
      if (!appendMem(mem)) break;
    }

    if (omittedUnmatched > 0) {
      const note = `[note] ${omittedUnmatched} other pinned memories omitted (no query overlap)`;
      const noteTokens = ContextSections.estimateTokens(note);
      if (tokens + noteTokens <= maxTokens) {
        lines.push(note);
        items.push({
          id: null,
          kind: "semantic",
          title: "Pinned memories omitted",
          reason: `${omittedUnmatched} other pinned items omitted (no query overlap)`,
        });
      }
    }

    // REL-12: LIKE fallback must not bump the candidate list — only items
    // that passed the gate and were actually assembled. Fusion hits are
    // touched in RetrievalFusion.search.
    if (fusion.fusionEmpty) {
      const bumpable = new Set([
        ...matchingUnique.map((m) => m.id),
        ...fusionOrFallback.map((m) => m.id),
      ]);
      const injectedIds = items
        .map((item) => item.id)
        .filter((id): id is number => typeof id === "number" && bumpable.has(id));
      await BrainStore.touchSemanticRetrieval(injectedIds);
    }

    return {
      text: lines.length > 1 ? lines.join("\n") : null,
      items,
    };
  }

  /** REL-10: pinned items that share query evidence sort ahead of unmatched pins. */
  static pinMatchesQuery(mem: SemanticMemory, query: string): boolean {
    if (!query.trim()) return false;
    const gate = evaluateRelevanceGate({
      query,
      title: mem.title,
      keywords: mem.keywords,
      content: mem.content,
      verified: recipeMemoryIsVerified(mem.content),
    });
    return (
      gate.lexicalOverlap.length > 0 ||
      gate.sharedEntities.length > 0 ||
      gate.lexicalScore >= LEXICAL_SCORE_MIN
    );
  }

  static semanticProvenance(
    mem: SemanticMemory,
    query: string,
    pinned: boolean,
    hit?: FusionResult,
  ): InjectedMemoryItem {
    const requireLexical = getMemoryConfig().retrieval_require_lexical !== false;
    const gate = evaluateRelevanceGate({
      query,
      title: mem.title,
      keywords: mem.keywords,
      content: mem.content,
      fts5: hit?.scores.fts5,
      trigram: hit?.scores.trigram,
      pinned,
      requireLexical,
      verified: recipeMemoryIsVerified(mem.content),
    });
    const evidence = uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities);
    return {
      id: mem.id,
      kind: "semantic",
      title: mem.title,
      category: mem.category,
      pinned,
      score: hit?.score ?? overlapScore(query, gate),
      reason: gate.reason,
      fts5: hit?.scores.fts5,
      trigram: hit?.scores.trigram,
      graph: hit?.scores.graph,
      recency: hit?.scores.recency,
      importance: hit?.scores.importance ?? mem.importance_score,
      topic_id: mem.topic_id,
      task_id: mem.task_id,
      gate_passed: gate.passed,
      evidence,
    };
  }

  static async buildEpisodicContext(
    query: string,
    currentSessionId: string | undefined,
    maxTokens: number,
    mode: ModeSettings,
    fusion: {
      fusionHits: FusionResult[];
      fusionEmpty: boolean;
      fusionById: Map<string, FusionResult>;
    },
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    const projectSessionIds = await getProjectSessionIds(currentSessionId);
    const hasLexicalQuery = contentWords(query).length > 0;

    const requireLexical = getMemoryConfig().retrieval_require_lexical !== false;
    let scored: Array<{
      ep: EpisodicMemory;
      score?: number;
      reason: string;
      fts5?: number;
      trigram?: number;
      graph?: number;
      recency?: number;
      importance?: number;
      evidence?: string[];
      gate_passed?: boolean;
    }> = [];
    if (fusion.fusionHits.length > 0) {
      scored = fusion.fusionHits
        .filter((r) => r.type === "episodic")
        .map((r) => {
          const ep = r.data as EpisodicMemory;
          const gate = evaluateRelevanceGate({
            query,
            content: ep.content,
            fts5: r.scores.fts5,
            trigram: r.scores.trigram,
            requireLexical,
          });
          return {
            ep,
            score: r.score,
            reason: gate.reason,
            passed: gate.passed,
            fts5: r.scores.fts5,
            trigram: r.scores.trigram,
            graph: r.scores.graph,
            recency: r.scores.recency,
            importance: r.scores.importance,
            evidence: uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities),
            gate_passed: gate.passed,
          };
        })
        .filter((row) => row.passed)
        .map(({ passed: _p, ...rest }) => rest);
    } else if (fusion.fusionEmpty && hasLexicalQuery) {
      const results = await BrainStore.searchEpisodic(query, undefined, mode.episodicLimit);
      scored = results.map((ep) => {
        const gate = evaluateRelevanceGate({ query, content: ep.content, requireLexical });
        return {
          ep,
          score: overlapScore(query, gate),
          reason: gate.reason,
          passed: gate.passed,
          evidence: uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities),
          gate_passed: gate.passed,
        };
      }).filter((row) => row.passed)
        .map(({ passed: _p, ...rest }) => rest);
    }

    let crossSession = currentSessionId
      ? scored.filter((row) => row.ep.session_id !== currentSessionId)
      : scored;

    if (projectSessionIds !== undefined) {
      const allowed = new Set(projectSessionIds);
      crossSession = crossSession.filter((row) => allowed.has(row.ep.session_id));
    }

    const filtered = crossSession.filter(
      (row) => row.ep.importance_score >= mode.minImportance,
    );

    if (filtered.length === 0) return { text: null, items: [] };

    const lines: string[] = ["=== Related Past Conversations ==="];
    const items: InjectedMemoryItem[] = [];
    let tokens = ContextSections.estimateTokens(lines[0]);

    for (const row of filtered) {
      const ep = row.ep;
      const entry = `[Session ${ep.session_id.substring(0, 8)}, ${ep.role}]: ${ep.content.substring(0, mode.episodicSnippetLen)}`;
      const entryTokens = ContextSections.estimateTokens(entry);
      if (tokens + entryTokens > maxTokens) break;
      lines.push(entry);
      tokens += entryTokens;
      items.push({
        id: ep.id,
        kind: "episodic",
        title: `Past ${ep.role} turn`,
        score: row.score,
        reason: row.reason || "lexical",
        fts5: row.fts5,
        trigram: row.trigram,
        graph: row.graph,
        recency: row.recency,
        importance: row.importance,
        evidence: row.evidence,
        gate_passed: row.gate_passed,
      });
    }

    return {
      text: lines.length > 1 ? lines.join("\n") : null,
      items,
    };
  }

  static async buildGraphContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    if (contentWords(query).length === 0) return { text: null, items: [] };
    if (!hasGraphExpandableTokens(query)) return { text: null, items: [] };
    const limits = getContextAssemblyLimits();
    const entities = await KnowledgeGraph.searchEntities(query, undefined, limits.graphEntitySearch);
    if (entities.length === 0) return { text: null, items: [] };

    const lines: string[] = ["=== Knowledge Graph Context ==="];
    const items: InjectedMemoryItem[] = [];
    let tokens = ContextSections.estimateTokens(lines[0]);

    for (const entity of entities.slice(0, limits.graphEntityDisplay)) {
      if (isCommonNounEntityName(entity.name) && !queryMentionsEntity(query, entity.name)) {
        continue;
      }
      const gate = evaluateRelevanceGate({
        query,
        title: entity.name,
        content: entity.description,
        requireLexical: getMemoryConfig().retrieval_require_lexical !== false,
      });
      if (!gate.passed) continue;
      const entry = `[${entity.entity_type}] ${entity.name}: ${entity.description}`;
      const entryTokens = ContextSections.estimateTokens(entry);
      if (tokens + entryTokens > maxTokens) break;
      lines.push(entry);
      tokens += entryTokens;
      items.push({
        id: entity.id,
        kind: "entity",
        title: entity.name,
        category: entity.entity_type,
        reason: gate.reason,
      });

      if (tokens < maxTokens * limits.graphEdgeBudgetRatio) {
        const edges = await BrainStore.getEntityEdges(entity.id);
        for (const edge of edges.slice(0, limits.graphEdgePerEntity)) {
          const neighborId = edge.source_entity_id === entity.id
            ? edge.target_entity_id
            : edge.source_entity_id;
          const neighbor = await BrainStore.getEntity(neighborId);
          if (neighbor) {
            const edgeEntry = `  → [${edge.relationship}] ${neighbor.name}`;
            const edgeTokens = ContextSections.estimateTokens(edgeEntry);
            if (tokens + edgeTokens > maxTokens) break;
            lines.push(edgeEntry);
            tokens += edgeTokens;
          }
        }
      }
    }

    return {
      text: lines.length > 1 ? lines.join("\n") : null,
      items,
    };
  }

  static async buildProcedureContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    if (contentWords(query).length === 0) return { text: null, items: [] };
    const limit = getContextAssemblyLimits().procedureLimit;
    const procedures = await BrainStore.searchProcedures(query, limit);
    if (procedures.length === 0) return { text: null, items: [] };

    const lines: string[] = ["=== Relevant Procedures ==="];
    const items: InjectedMemoryItem[] = [];
    let tokens = ContextSections.estimateTokens(lines[0]);

    for (const proc of procedures) {
      const gate = evaluateRelevanceGate({
        query,
        title: proc.name,
        content: `${proc.description} ${proc.category}`,
      });
      if (!gate.passed) continue;
      const steps = JSON.parse(proc.steps) as string[];
      const entry = `[${proc.category}] ${proc.name}: ${proc.description}\n  Steps: ${steps.map((s, i) => `${i + 1}. ${s}`).join(", ")}`;
      const entryTokens = ContextSections.estimateTokens(entry);
      if (tokens + entryTokens > maxTokens) break;
      lines.push(entry);
      tokens += entryTokens;
      items.push({
        id: proc.id,
        kind: "procedure",
        title: proc.name,
        category: proc.category,
        reason: gate.reason,
      });
    }

    return {
      text: lines.length > 1 ? lines.join("\n") : null,
      items,
    };
  }

  static async buildPatternContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    if (contentWords(query).length === 0) return { text: null, items: [] };
    const limit = getContextAssemblyLimits().patternLimit;
    const suggestions = await LearningEngine.suggestApproach(query, undefined, limit);
    if (suggestions.length === 0) return { text: null, items: [] };

    const lines: string[] = ["=== Suggested Approaches (from learned patterns) ==="];
    const items: InjectedMemoryItem[] = [];
    let tokens = ContextSections.estimateTokens(lines[0]);

    for (const s of suggestions) {
      const gate = evaluateRelevanceGate({
        query,
        title: s.pattern.pattern_signature,
        content: s.reason,
      });
      if (!gate.passed) continue;
      const entry = `[${s.pattern.goal_type}] ${s.pattern.pattern_signature}: ${s.reason}`;
      const entryTokens = ContextSections.estimateTokens(entry);
      if (tokens + entryTokens > maxTokens) break;
      lines.push(entry);
      tokens += entryTokens;
      items.push({
        id: s.pattern.id,
        kind: "pattern",
        title: s.pattern.pattern_signature,
        category: s.pattern.goal_type,
        reason: gate.reason,
      });
    }

    return {
      text: lines.length > 1 ? lines.join("\n") : null,
      items,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Compute dynamic budget allocation based on query complexity and content.
   * Base ratios come from config; query-type boosts adjust within min floors.
   */
  static computeBudget(
    query: string,
    maxTokens: number,
  ): { semantic: number; episodic: number; graph: number; procedures: number; patterns: number } {
    const base = getBudgetRatios();
    const adj = getBudgetQueryAdjustments();
    const lower = query.toLowerCase();
    let semPct = base.semantic;
    let epPct = base.episodic;
    let graphPct = base.graph;
    let procPct = base.procedures;
    let patPct = base.patterns;

    if (/\b(how to|steps|workflow|procedure|guide|process|setup)\b/.test(lower)) {
      procPct += adj.proceduralBoost;
      semPct -= adj.proceduralBoost / 2;
      epPct -= adj.proceduralBoost / 2;
    }

    const capitalWords = (query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? []).length;
    if (capitalWords >= 2 || /\b(who|person|team|company|project)\b/.test(lower)) {
      graphPct += adj.graphBoost;
      semPct -= adj.graphBoost / 2;
      epPct -= adj.graphBoost / 2;
    }

    if (/\b(error|bug|fix|debug|exception|crash|fail)\b/.test(lower) || query.includes("```")) {
      patPct += adj.patternsBoost;
      graphPct -= adj.patternsBoost * 0.625;
      procPct -= adj.patternsBoost * 0.375;
    }

    if (query.length > adj.longThresholdChars) {
      epPct += adj.episodicLongBoost;
      semPct -= adj.episodicLongBoost * 0.625;
      procPct -= adj.episodicLongBoost * 0.375;
    }

    if (query.length < adj.shortThresholdChars && !query.includes("?")) {
      semPct += adj.semanticShortBoost;
      epPct -= adj.semanticShortBoost * 0.625;
      procPct -= adj.semanticShortBoost * 0.375;
    }

    semPct = Math.max(adj.minSemantic, semPct);
    epPct = Math.max(adj.minEpisodic, epPct);
    graphPct = Math.max(adj.minGraph, graphPct);
    procPct = Math.max(adj.minProcedures, procPct);
    patPct = Math.max(adj.minPatterns, patPct);

    const total = semPct + epPct + graphPct + procPct + patPct;
    semPct /= total;
    epPct /= total;
    graphPct /= total;
    procPct /= total;
    patPct /= total;

    return {
      semantic: Math.floor(maxTokens * semPct),
      episodic: Math.floor(maxTokens * epPct),
      graph: Math.floor(maxTokens * graphPct),
      procedures: Math.floor(maxTokens * procPct),
      patterns: Math.floor(maxTokens * patPct),
    };
  }

  static estimateTokens(text: string): number {
    // Try to use the LLM's actual tokenizer via BrainManager
    try {
      if (_BrainManager) {
        return _BrainManager.countTokensAccurate(text);
      }
    } catch {
      // fall through
    }
    return Math.ceil(text.length / 4);
  }
}
