import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { LearningEngine } from "./LearningEngine.js";
import { getBudgetQueryAdjustments, getBudgetRatios, getContextAssemblyLimits, getMemoryConfig, getTheoremParams, type ModeSettings } from "./memoryConfigAccess.js";
import { filterSemanticByProjectScope, getProjectSessionIds } from "./projectScope.js";
import { contentWords } from "./RetrievalQuery.js";
import { recipeMemoryIsVerified } from "../recipes/memoryLink.js";
import { evaluateRelevanceGate, extractEntityLikeTokens, isMismatchActive, LEXICAL_SCORE_MIN } from "./RelevanceGate.js";
import { hasGraphExpandableTokens, isCommonNounEntityName, queryMentionsEntity } from "./GraphRetrieval.js";
import type { FusionResult } from "./RetrievalFusion.js";
import { hasRipgrepHit } from "./channels/ripgrep.js";
import { memoryCiteToken } from "./attribution.js";
import { winningChannel } from "./memoryOutcomes.js";
import {
  coverageFeatures,
  rankScaledScore,
  type ContextCandidate,
} from "./selectContext.js";
import { searchSummaryNodes } from "./SummaryTree.js";
import {
  leftoverCoveredByFingerprints,
  leftoverFingerprints,
  leftoverTextCovered,
  loadLiveRecipeCoverage,
} from "./m5Surface.js";
import { isDefaultRetrieveValue } from "./Value.js";
import {
  formatCheckpointInjectPointer,
  isCheckpointPointerLeaf,
  parseCheckpointPointerLeaf,
} from "../../soul/checkpointPointer.js";
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

export const RECALLED_MEMORY_HEADER = "=== Relevant Knowledge from Memory ===";

export interface SemanticCollectResult {
  candidates: ContextCandidate[];
  omittedUnmatched: number;
}

function fusionRankScale(): number {
  return getTheoremParams().rrfK0;
}

function memoryEntities(title?: string, keywords?: string, content?: string): string[] {
  const names = new Set<string>();
  for (const raw of (keywords ?? "").split(/[,;|]/)) {
    const key = raw.trim();
    if (key) names.add(key);
  }
  for (const ident of extractEntityLikeTokens([title, keywords, content].filter(Boolean).join(" "))) {
    names.add(ident);
  }
  return [...names];
}

function toCandidate(input: {
  key: string;
  kind: ContextCandidate["kind"];
  score: number;
  text: string;
  item: InjectedMemoryItem;
  entities?: string[];
  /** Text used for trigram / entity Jaccard (defaults to `text`). */
  simText?: string;
  mustKeep?: boolean;
  recordInject?: boolean;
}): ContextCandidate {
  const entities = input.entities ?? input.item.evidence ?? [];
  return {
    key: input.key,
    kind: input.kind,
    score: Math.max(0, input.score),
    tokens: ContextSections.estimateTokens(input.text),
    text: input.text,
    features: coverageFeatures(input.simText ?? input.text, entities),
    item: input.item,
    mustKeep: input.mustKeep,
    recordInject: input.recordInject,
  };
}

/** Section builders and candidate collection for ContextBuilder (MEM-29). */
export class ContextSections {
  static takeCandidatesUntil(
    candidates: ContextCandidate[],
    maxTokens: number,
    header?: string,
  ): { text: string | null; items: InjectedMemoryItem[] } {
    const lines: string[] = header ? [header] : [];
    const items: InjectedMemoryItem[] = [];
    let tokens = header ? ContextSections.estimateTokens(header) : 0;
    for (const cand of candidates) {
      if (tokens + cand.tokens > maxTokens) break;
      lines.push(cand.text);
      tokens += cand.tokens;
      items.push(cand.item);
    }
    if (items.length === 0) return { text: null, items: [] };
    return { text: lines.join("\n"), items };
  }

  static async collectSemanticCandidates(
    query: string,
    sessionId: string | undefined,
    mode: ModeSettings,
    fusion: {
      fusionHits: FusionResult[];
      fusionEmpty: boolean;
      fusionById: Map<string, FusionResult>;
    },
  ): Promise<SemanticCollectResult> {
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
        if (!isDefaultRetrieveValue(mem)) return false;
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
      return { candidates: [], omittedUnmatched };
    }

    const pinnedIds = new Set(scopedPins.map((m) => m.id));
    const matchingIds = new Set(matchingUnique.map((m) => m.id));
    const fallbackIds = new Set(fusionOrFallback.map((m) => m.id));
    const k0 = fusionRankScale();
    const candidates: ContextCandidate[] = [];

    const pushMem = (mem: SemanticMemory, opts: { mustKeep: boolean; unmatched: boolean }): void => {
      const pinned = pinnedIds.has(mem.id);
      const hit = fusion.fusionById.get(`semantic:${mem.id}`);
      if (!pinned) {
        const gate = evaluateRelevanceGate({
          query,
          title: mem.title,
          keywords: mem.keywords,
          content: mem.content,
          fts5: hit?.scores.fts5,
          trigram: hit?.scores.trigram,
          verified: recipeMemoryIsVerified(mem.content),
          ripgrepHit: hasRipgrepHit(hit),
        });
        if (!gate.passed) return;
      }
      const cite = memoryCiteToken("semantic", mem.id);
      const entry = `${cite} ${pinned ? "[pinned] " : ""}[${mem.category}] ${mem.title}: ${mem.content}`;
      const item = ContextSections.semanticProvenance(mem, query, pinned, hit);
      const overlap = item.evidence && contentWords(query).length > 0
        ? Math.min(1, item.evidence.length / contentWords(query).length)
        : 0;
      let score = hit?.score ?? (overlap > 0 ? rankScaledScore(1, overlap, k0) : 0);
      if (opts.unmatched) score = Math.max(score, rankScaledScore(200, 1, k0));
      if (mode.preferSummaries && mem.category === "summary" && score > 0) {
        score *= 1.05;
      }
      candidates.push(toCandidate({
        key: `semantic:${mem.id}`,
        kind: mem.category === "summary" ? "summary" : "semantic",
        score,
        text: entry,
        item,
        simText: `${mem.title} ${mem.keywords ?? ""} ${mem.content}`,
        entities: memoryEntities(mem.title, mem.keywords, mem.content),
        mustKeep: opts.mustKeep,
        recordInject: fusion.fusionEmpty && (matchingIds.has(mem.id) || fallbackIds.has(mem.id)),
      }));
    };

    for (const mem of primary) {
      pushMem(mem, { mustKeep: matchingIds.has(mem.id), unmatched: false });
    }
    for (const mem of unmatchedUnique) {
      pushMem(mem, { mustKeep: true, unmatched: true });
    }

    return { candidates, omittedUnmatched };
  }

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
    const collected = await ContextSections.collectSemanticCandidates(query, sessionId, mode, fusion);
    const taken = ContextSections.takeCandidatesUntil(
      collected.candidates,
      maxTokens,
      RECALLED_MEMORY_HEADER,
    );
    if (collected.omittedUnmatched > 0 && taken.text) {
      const note = `[note] ${collected.omittedUnmatched} other pinned memories omitted (no query overlap)`;
      if (ContextSections.estimateTokens(taken.text) + ContextSections.estimateTokens(note) <= maxTokens) {
        taken.text = `${taken.text}\n${note}`;
        taken.items.push({
          id: null,
          kind: "semantic",
          title: "Pinned memories omitted",
          reason: `${collected.omittedUnmatched} other pinned items omitted (no query overlap)`,
        });
      }
    }
    if (fusion.fusionEmpty) {
      const injectedIds = taken.items
        .map((item) => item.id)
        .filter((id): id is number => typeof id === "number");
      await BrainStore.recordSemanticInject(injectedIds);
    }
    return taken;
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
      ripgrepHit: hasRipgrepHit(hit),
    });
    const evidence = uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities);
    return {
      id: mem.id,
      kind: "semantic",
      mem_id: String(mem.id),
      cite: memoryCiteToken("semantic", mem.id),
      title: mem.title,
      category: mem.category,
      pinned,
      score: hit?.score ?? overlapScore(query, gate),
      channel: hit?.channel ?? winningChannel(hit?.scores) ?? undefined,
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

  static async collectEpisodicCandidates(
    query: string,
    currentSessionId: string | undefined,
    mode: ModeSettings,
    fusion: {
      fusionHits: FusionResult[];
      fusionEmpty: boolean;
      fusionById: Map<string, FusionResult>;
    },
  ): Promise<ContextCandidate[]> {
    const projectSessionIds = await getProjectSessionIds(currentSessionId);
    const hasLexicalQuery = contentWords(query).length > 0;

    const requireLexical = getMemoryConfig().retrieval_require_lexical !== false;
    const k0 = fusionRankScale();
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
            ripgrepHit: hasRipgrepHit(r),
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
        if (!isDefaultRetrieveValue(ep)) {
          return {
            ep,
            reason: "archived",
            passed: false,
            gate_passed: false,
          };
        }
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
      ? scored.filter((row) =>
          row.ep.session_id !== currentSessionId
          || isCheckpointPointerLeaf(row.ep.content, row.ep.metadata),
        )
      : scored;

    if (projectSessionIds !== undefined) {
      const allowed = new Set(projectSessionIds);
      crossSession = crossSession.filter((row) => allowed.has(row.ep.session_id));
    }

    const filtered = crossSession.filter(
      (row) => row.ep.importance_score >= mode.minImportance,
    );

    return filtered.map((row) => {
      const ep = row.ep;
      const cite = memoryCiteToken("episodic", ep.id);
      const pointer = parseCheckpointPointerLeaf(ep.content, ep.metadata);
      const entry = pointer && isCheckpointPointerLeaf(ep.content, ep.metadata)
        ? formatCheckpointInjectPointer({
            cite,
            workspaceCheckpointId: pointer.workspaceCheckpointId,
            label: pointer.label,
          })
        : `${cite} [Session ${ep.session_id.substring(0, 8)}, ${ep.role}]: ${ep.content.substring(0, mode.episodicSnippetLen)}`;
      const overlap = row.evidence && contentWords(query).length > 0
        ? Math.min(1, row.evidence.length / contentWords(query).length)
        : 0;
      const score = row.score && row.score > 0
        ? row.score
        : rankScaledScore(1, overlap, k0);
      const item: InjectedMemoryItem = {
        id: ep.id,
        kind: "episodic",
        mem_id: String(ep.id),
        cite,
        title: `Past ${ep.role} turn`,
        score,
        channel: winningChannel(row) ?? undefined,
        reason: row.reason || "lexical",
        fts5: row.fts5,
        trigram: row.trigram,
        graph: row.graph,
        recency: row.recency,
        importance: row.importance,
        evidence: row.evidence,
        gate_passed: row.gate_passed,
      };
      return toCandidate({
        key: `episodic:${ep.id}`,
        kind: "episodic",
        score,
        text: entry,
        item,
        simText: ep.content,
        entities: memoryEntities(undefined, undefined, ep.content),
      });
    });
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
    const candidates = await ContextSections.collectEpisodicCandidates(
      query,
      currentSessionId,
      mode,
      fusion,
    );
    return ContextSections.takeCandidatesUntil(candidates, maxTokens, "=== Related Past Conversations ===");
  }

  static async collectGraphCandidates(query: string): Promise<ContextCandidate[]> {
    if (contentWords(query).length === 0) return [];
    if (!hasGraphExpandableTokens(query)) return [];
    const limits = getContextAssemblyLimits();
    const k0 = fusionRankScale();
    const entities = await KnowledgeGraph.searchEntities(query, undefined, limits.graphEntitySearch);
    if (entities.length === 0) return [];

    const out: ContextCandidate[] = [];
    let rank = 0;
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
      rank += 1;
      const lines = [`[${entity.entity_type}] ${entity.name}: ${entity.description}`];
      const edges = await BrainStore.getEntityEdges(entity.id);
      for (const edge of edges.slice(0, limits.graphEdgePerEntity)) {
        const neighborId = edge.source_entity_id === entity.id
          ? edge.target_entity_id
          : edge.source_entity_id;
        const neighbor = await BrainStore.getEntity(neighborId);
        if (neighbor) {
          lines.push(`  → [${edge.relationship}] ${neighbor.name}`);
        }
      }
      const overlap = uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities);
      const frac = contentWords(query).length > 0
        ? Math.min(1, overlap.length / contentWords(query).length)
        : 1;
      out.push(toCandidate({
        key: `entity:${entity.id}`,
        kind: "entity",
        score: rankScaledScore(rank, Math.max(frac, 0.25), k0),
        text: lines.join("\n"),
        item: {
          id: entity.id,
          kind: "entity",
          title: entity.name,
          category: entity.entity_type,
          reason: gate.reason,
          evidence: overlap,
          gate_passed: true,
        },
        simText: `${entity.name} ${entity.description}`,
        entities: [entity.name, ...gate.sharedEntities],
      }));
    }
    return out;
  }

  static async buildGraphContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    const candidates = await ContextSections.collectGraphCandidates(query);
    return ContextSections.takeCandidatesUntil(candidates, maxTokens, "=== Knowledge Graph Context ===");
  }

  static async collectProcedureCandidates(query: string): Promise<ContextCandidate[]> {
    if (contentWords(query).length === 0) return [];
    const limit = getContextAssemblyLimits().procedureLimit;
    const k0 = fusionRankScale();
    const procedures = await BrainStore.searchProcedures(query, limit);
    if (procedures.length === 0) return [];
    const coverage = await loadLiveRecipeCoverage();

    const out: ContextCandidate[] = [];
    let rank = 0;
    for (const proc of procedures) {
      if (
        leftoverCoveredByFingerprints(
          leftoverFingerprints([proc.name, proc.trigger_pattern, proc.description]),
          coverage.fingerprints,
        )
      ) {
        continue;
      }
      const gate = evaluateRelevanceGate({
        query,
        title: proc.name,
        content: `${proc.description} ${proc.category}`,
      });
      if (!gate.passed) continue;
      rank += 1;
      const steps = JSON.parse(proc.steps) as string[];
      const entry = `[${proc.category}] ${proc.name}: ${proc.description}\n  Steps: ${steps.map((s, i) => `${i + 1}. ${s}`).join(", ")}`;
      const overlap = uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities);
      const frac = contentWords(query).length > 0
        ? Math.min(1, overlap.length / contentWords(query).length)
        : 1;
      out.push(toCandidate({
        key: `procedure:${proc.id}`,
        kind: "procedure",
        score: rankScaledScore(rank, Math.max(frac, 0.25), k0),
        text: entry,
        item: {
          id: proc.id,
          kind: "procedure",
          title: proc.name,
          category: proc.category,
          reason: gate.reason,
          evidence: overlap,
          gate_passed: true,
        },
        simText: `${proc.name} ${proc.description} ${proc.category}`,
        entities: memoryEntities(proc.name, undefined, proc.description),
      }));
    }
    return out;
  }

  static async buildProcedureContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    const candidates = await ContextSections.collectProcedureCandidates(query);
    return ContextSections.takeCandidatesUntil(candidates, maxTokens, "=== Relevant Procedures ===");
  }

  static async collectPatternCandidates(query: string): Promise<ContextCandidate[]> {
    if (contentWords(query).length === 0) return [];
    const limit = getContextAssemblyLimits().patternLimit;
    const k0 = fusionRankScale();
    const suggestions = await LearningEngine.suggestApproach(query, undefined, limit);
    if (suggestions.length === 0) return [];
    const coverage = await loadLiveRecipeCoverage();

    const out: ContextCandidate[] = [];
    let rank = 0;
    for (const s of suggestions) {
      if (
        leftoverCoveredByFingerprints(
          leftoverFingerprints([s.pattern.pattern_signature, s.pattern.description, s.reason]),
          coverage.fingerprints,
        )
      ) {
        continue;
      }
      const gate = evaluateRelevanceGate({
        query,
        title: s.pattern.pattern_signature,
        content: s.reason,
      });
      if (!gate.passed) continue;
      rank += 1;
      const entry = `[${s.pattern.goal_type}] ${s.pattern.pattern_signature}: ${s.reason}`;
      const overlap = uniqueEvidence(gate.lexicalOverlap, gate.sharedEntities);
      const frac = contentWords(query).length > 0
        ? Math.min(1, Math.max(s.relevance_score, overlap.length / contentWords(query).length))
        : Math.min(1, s.relevance_score);
      out.push(toCandidate({
        key: `pattern:${s.pattern.id}`,
        kind: "pattern",
        score: rankScaledScore(rank, Math.max(frac, 0.25), k0),
        text: entry,
        item: {
          id: s.pattern.id,
          kind: "pattern",
          title: s.pattern.pattern_signature,
          category: s.pattern.goal_type,
          reason: gate.reason,
          evidence: overlap,
          gate_passed: true,
        },
        simText: `${s.pattern.pattern_signature} ${s.reason}`,
        entities: memoryEntities(s.pattern.pattern_signature, undefined, s.reason),
      }));
    }
    return out;
  }

  static async buildPatternContext(
    query: string,
    maxTokens: number,
  ): Promise<{ text: string | null; items: InjectedMemoryItem[] }> {
    const candidates = await ContextSections.collectPatternCandidates(query);
    return ContextSections.takeCandidatesUntil(
      candidates,
      maxTokens,
      "=== Suggested Approaches (from learned patterns) ===",
    );
  }

  static collectSessionSummaryCandidate(input: {
    summary: string;
    overlap: number;
    fullMode: boolean;
  }): ContextCandidate {
    const k0 = fusionRankScale();
    const text = `=== Current Session Context ===\n${input.summary}`;
    const score = input.fullMode
      ? rankScaledScore(1, 1, k0)
      : rankScaledScore(1, Math.max(0, Math.min(1, input.overlap)), k0);
    return toCandidate({
      key: "summary:session",
      kind: "summary",
      score,
      text,
      item: {
        id: null,
        kind: "episodic",
        title: "Current session summary",
        reason: "Summary of the active conversation",
        score,
      },
      simText: input.summary,
      entities: memoryEntities(undefined, undefined, input.summary),
      mustKeep: input.fullMode,
    });
  }

  /** MEM-30: C_recent overflow injects the session/tree node (must-keep). */
  static collectOverflowSummaryCandidate(input: {
    nodeId: number;
    text: string;
  }): ContextCandidate {
    const k0 = fusionRankScale();
    const score = rankScaledScore(1, 1, k0);
    const body = `=== Current Session Context ===\n[summary-node ${input.nodeId}] ${input.text}`;
    return toCandidate({
      key: "summary:session",
      kind: "summary",
      score,
      text: body,
      item: {
        id: input.nodeId,
        kind: "episodic",
        title: "Session summary node",
        reason: "C_recent overflow — old turns replaced by the session tree node for this call",
        score,
      },
      simText: input.text,
      entities: memoryEntities(undefined, undefined, input.text),
      mustKeep: true,
    });
  }

  static async collectSummaryNodeCandidates(
    query: string,
    sessionId?: string,
  ): Promise<ContextCandidate[]> {
    if (!sessionId || contentWords(query).length === 0) return [];
    const k0 = fusionRankScale();
    const nodes = await searchSummaryNodes({ query, sessionId });
    return nodes.map((node, index) => {
      const text = `[summary-node ${node.id}] ${node.text}`;
      const frac = Math.max(0.25, Math.min(1, node.score));
      return toCandidate({
        key: `summary:${node.id}`,
        kind: "summary",
        score: rankScaledScore(index + 1, frac, k0),
        text,
        item: {
          id: node.id,
          kind: "episodic",
          title: "Summary tree node",
          reason: "Session summary-tree pointer",
          score: node.score,
        },
        simText: node.text,
        entities: memoryEntities(undefined, undefined, node.text),
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Leftover per-section shares (MEM-28). Not the live allocator — MEM-29
   * selects across sources with budgeted submodular F(X). The how-to /
   * workflow boost must not raise leftover procedure quota when a live
   * recipe already owns that fingerprint (MEM-37).
   */
  static computeBudget(
    query: string,
    maxTokens: number,
    options?: { coveredByRecipe?: boolean },
  ): { semantic: number; episodic: number; graph: number; procedures: number; patterns: number } {
    const base = getBudgetRatios();
    const adj = getBudgetQueryAdjustments();
    const lower = query.toLowerCase();
    let semPct = base.semantic;
    let epPct = base.episodic;
    let graphPct = base.graph;
    let procPct = base.procedures;
    let patPct = base.patterns;

    if (
      !options?.coveredByRecipe &&
      /\b(how to|steps|workflow|procedure|guide|process|setup)\b/.test(lower)
    ) {
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

  /** Live leftover shares: suppress the how-to boost when a recipe covers q. */
  static async computeBudgetForQuery(
    query: string,
    maxTokens: number,
  ): Promise<ReturnType<typeof ContextSections.computeBudget>> {
    const coverage = await loadLiveRecipeCoverage();
    return ContextSections.computeBudget(query, maxTokens, {
      coveredByRecipe: leftoverTextCovered(query, coverage.fingerprints),
    });
  }

  /**
   * Leftover helper: disabled categories donate their computeBudget share.
   * Unused after MEM-29 (submodular selection is the primary allocator).
   */
  static leftoverSectionShares(
    shares: ReturnType<typeof ContextSections.computeBudget>,
    enabled: {
      semantic: boolean;
      episodic: boolean;
      graph: boolean;
      procedures: boolean;
      patterns: boolean;
    },
  ): ReturnType<typeof ContextSections.computeBudget> {
    let leftover = 0;
    const out = { ...shares };
    for (const key of ["semantic", "episodic", "graph", "procedures", "patterns"] as const) {
      if (!enabled[key]) {
        leftover += shares[key];
        out[key] = 0;
        continue;
      }
      out[key] = shares[key] + leftover;
      leftover = 0;
    }
    return out;
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
