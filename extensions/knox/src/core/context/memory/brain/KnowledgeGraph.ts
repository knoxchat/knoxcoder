import { BrainStore } from "./BrainStore.js";
import {
  pushPersonalizedPageRank,
  topPprEntities,
  type GraphNeighbor,
  type PprOptions,
  type PprResult,
} from "./channels/ppr.js";
import {
  entityNameMatchesMemory,
  isCommonNounEntityName,
  queryMentionsEntity,
  shouldJoinEntityToMemories,
} from "./GraphRetrieval.js";
import {
  ENTITY_ALIAS_GROUPS,
  entityAliasGroup,
  entityAliasNames,
  normalizeEntityName,
  preferredEntityName,
} from "./entityResolution.js";
import { getFusionParams, getMemoryConfig, getTheoremParams } from "./memoryConfigAccess.js";
import { queryScopeSql } from "./store/validity.js";
import type {
  GraphEntity,
  GraphEdge,
  GraphExploreResult,
  GraphCapStatus,
  AddEntityInput,
  AddEdgeInput,
  ExploreGraphInput,
  EntityType,
} from "./types.js";

/**
 * KnowledgeGraph — Entity & relationship management for the Memory Brain.
 *
 * Mirrors the Knox-MS knowledge graph system:
 * - Entity extraction from text (rule-based patterns)
 * - Hub-damped Personalized PageRank (MEM-25)
 * - Entity resolution via canonical_id (MEM-26: TS / TypeScript)
 * - Validity intervals on entities and edges (MEM-26)
 * - No entity cap; disk budget is max_bytes (MEM-25)
 *
 * Supports 13 entity types matching Knox-MS:
 *   person, organization, technology, concept, project, file,
 *   function, class, variable, location, event, product, custom
 */
export class KnowledgeGraph {
  // ── Entity Operations ──────────────────────────────────────────────────────

  /**
   * Add or update an entity. Aliases in the same rule group (TS / TypeScript)
   * share one canonical id. Returns the canonical row id.
   */
  static async addEntity(input: AddEntityInput): Promise<number> {
    const type = input.entity_type;
    const incoming = input.name.trim();
    const key = KnowledgeGraph.normalizeName(incoming);
    const group = entityAliasGroup(incoming);
    const payload = {
      entity_type: type,
      description: input.description ?? "",
      properties: input.properties ?? {},
      confidence: input.confidence ?? 0.8,
      valid_from: input.valid_from,
      valid_to: input.valid_to,
    };

    const exact = await BrainStore.findEntity(key, type);
    if (exact) {
      const canonicalId = await BrainStore.resolveCanonicalId(exact.id);
      await BrainStore.incrementEntityMention(canonicalId);
      const canonical = await BrainStore.getEntity(canonicalId);
      if (
        input.description
        && input.description.length > (canonical?.description?.length ?? exact.description?.length ?? 0)
      ) {
        await BrainStore.updateEntity(canonicalId, { description: input.description });
      }
      return canonicalId;
    }

    if (group) {
      const others = await BrainStore.findEntitiesByNames(
        group.map((name) => KnowledgeGraph.normalizeName(name)).filter((name) => name !== key),
        type,
      );
      if (others.length > 0) {
        let canonicalId = await BrainStore.resolveCanonicalId(others[0].id);
        const preferred = preferredEntityName(incoming);
        const canonical = await BrainStore.getEntity(canonicalId);
        if (
          canonical
          && KnowledgeGraph.normalizeName(canonical.name) !== KnowledgeGraph.normalizeName(preferred)
          && KnowledgeGraph.normalizeName(incoming) === KnowledgeGraph.normalizeName(preferred)
        ) {
          const promoted = await BrainStore.addEntity({
            name: incoming,
            canonical_id: null,
            ...payload,
          });
          await BrainStore.setEntityCanonical(canonicalId, promoted);
          for (const member of others) {
            if (member.id !== promoted) await BrainStore.setEntityCanonical(member.id, promoted);
          }
          canonicalId = promoted;
        } else {
          await BrainStore.addEntity({
            name: incoming,
            canonical_id: canonicalId,
            ...payload,
          });
        }
        await BrainStore.incrementEntityMention(canonicalId);
        return canonicalId;
      }
    }

    const createName = group ? preferredEntityName(incoming) : incoming;
    const id = await BrainStore.addEntity({
      name: createName,
      canonical_id: null,
      ...payload,
    });
    if (group && KnowledgeGraph.normalizeName(createName) !== key) {
      await BrainStore.addEntity({
        name: incoming,
        canonical_id: id,
        ...payload,
      });
    }
    return id;
  }

  /**
   * Add an edge between two entities. Endpoints resolve to canonical ids so
   * alias rows do not grow a parallel graph.
   */
  static async addEdge(input: AddEdgeInput): Promise<number> {
    const source = await BrainStore.resolveCanonicalId(input.source_entity_id);
    const target = await BrainStore.resolveCanonicalId(input.target_entity_id);
    if (source === target) {
      const loop = await BrainStore.findEdge(source, target, input.relationship);
      return loop?.id ?? source;
    }
    const existing = await BrainStore.findEdge(source, target, input.relationship);

    if (existing) {
      await BrainStore.updateEdgeWeight(existing.id, Math.min(1.0, existing.weight + 0.1));
      return existing.id;
    }

    return BrainStore.addEdge({
      ...input,
      source_entity_id: source,
      target_entity_id: target,
    });
  }

  /**
   * Search entities by name or description.
   */
  static async searchEntities(
    query: string,
    entityType?: EntityType,
    limit: number = 20,
  ): Promise<GraphEntity[]> {
    let results = await BrainStore.searchEntities(query, entityType, limit);
    // REL-11: common-noun entities stay hidden unless the query actually names them.
    if (query?.trim()) {
      results = results.filter(
        (e) => !isCommonNounEntityName(e.name) || queryMentionsEntity(query, e.name),
      );
    }
    // LRU refresh on retrieval (IMP-11)
    for (const entity of results) {
      void BrainStore.touchEntity(entity.id);
    }
    return results;
  }

  /**
   * Explore from a center entity with hub-damped Personalized PageRank.
   * `activation_scores` are π_q. `entity_depths` are first-touch hops (display).
   */
  static async explore(input: ExploreGraphInput): Promise<GraphExploreResult> {
    const requested = await BrainStore.getEntity(input.entity_id);
    if (!requested) {
      throw new Error(`Entity #${input.entity_id} not found`);
    }
    const canonicalId = await BrainStore.resolveCanonicalId(requested.id);
    const center = (await BrainStore.getEntity(canonicalId)) ?? requested;

    const maxDepth = input.depth ?? BrainStore.getConfig().graph_max_depth;
    const limit = input.limit ?? 50;
    void BrainStore.touchEntity(center.id);

    const ppr = await KnowledgeGraph.personalizedPageRank([center.id]);
    const ranked = topPprEntities(ppr.scores, Math.max(limit * 2, limit), 0);
    const chosenIds: number[] = [center.id];
    for (const row of ranked) {
      if (row.id === center.id) continue;
      const depth = ppr.depths.get(row.id) ?? 0;
      if (maxDepth > 0 && depth > maxDepth) continue;
      chosenIds.push(row.id);
      if (chosenIds.length >= limit) break;
    }

    const loaded = await BrainStore.getEntitiesByIds(chosenIds);
    const byId = new Map(loaded.map((entity) => [entity.id, entity]));
    const entities: GraphEntity[] = [];
    if (byId.has(center.id)) entities.push(byId.get(center.id)!);
    for (const id of chosenIds) {
      if (id === center.id) continue;
      const entity = byId.get(id);
      if (entity) entities.push(entity);
    }

    const entityDepths: Record<number, number> = { [center.id]: 0 };
    const activationScores: Record<number, number> = {
      [center.id]: ppr.scores.get(center.id) ?? 0,
    };
    let depthReached = 0;
    for (const entity of entities) {
      const depth = ppr.depths.get(entity.id) ?? 0;
      entityDepths[entity.id] = depth;
      activationScores[entity.id] = ppr.scores.get(entity.id) ?? 0;
      if (depth > depthReached) depthReached = depth;
      void BrainStore.touchEntity(entity.id);
    }

    const edges = await BrainStore.getEdgesAmong(entities.map((entity) => entity.id));
    return {
      center,
      entities,
      edges,
      depth_reached: depthReached,
      entity_depths: entityDepths,
      activation_scores: activationScores,
    };
  }

  /**
   * Hub-damped push-PPR from query (or explore) seeds.
   * Cost is O(1/(αε)); neighbors are loaded only for pushed nodes.
   */
  static async personalizedPageRank(
    seedIds: Iterable<number> | Map<number, number>,
    options?: PprOptions,
  ): Promise<PprResult> {
    const theorem = getTheoremParams();
    const view = KnowledgeGraph.lazyGraphView();
    return pushPersonalizedPageRank(seedIds, view.getNeighbors, view.getDegree, {
      alpha: options?.alpha ?? theorem.pprAlpha,
      epsilon: options?.epsilon ?? theorem.pprEpsilon,
      maxPushes: options?.maxPushes,
    });
  }

  /**
   * Graph channel over stored semantic rows: S_graph(m,q) = max_e π_q(e)
   * for entities mentioned in m. REL-11 join guards still apply.
   */
  static async searchMemoriesByPpr(query: string): Promise<Map<number, number>> {
    const graphScores = new Map<number, number>();
    const config = getMemoryConfig();
    const fusionParams = getFusionParams();
    const theorem = getTheoremParams();
    const seeds = await KnowledgeGraph.searchEntities(
      query,
      undefined,
      fusionParams.graphEntitySearchLimit,
    );
    if (seeds.length === 0) return graphScores;

    const seedIds: number[] = [];
    const seenSeeds = new Set<number>();
    for (const entity of seeds) {
      const cluster = await BrainStore.listEntityCluster(entity.id);
      const names = cluster.length > 0 ? cluster.map((row) => row.name) : [entity.name];
      if (!names.some((name) => shouldJoinEntityToMemories(query, name))) continue;
      const canonicalId = await BrainStore.resolveCanonicalId(entity.id);
      if (seenSeeds.has(canonicalId)) continue;
      seenSeeds.add(canonicalId);
      seedIds.push(canonicalId);
    }
    if (seedIds.length === 0) return graphScores;

    const ppr = await KnowledgeGraph.personalizedPageRank(seedIds);
    const joinCap = Math.max(fusionParams.graphNeighborLimit, 10);
    const ranked = topPprEntities(
      ppr.scores,
      Math.max(joinCap * 3, 20),
      theorem.pprEpsilon,
    );
    if (ranked.length === 0) return graphScores;

    const entities = await BrainStore.getEntitiesByIds(ranked.map((row) => row.id));
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const db = await BrainStore.get();
    const countRow = await db.get("SELECT COUNT(*) AS n FROM brain_semantic").catch(() => null);
    const largeBrain = ((countRow as { n?: number } | null)?.n ?? 0) > 5000;
    const fetchLimit = Math.max(config.graph_neighbor_memory_limit * 3, 15);

    for (const row of ranked) {
      const entity = byId.get(row.id);
      if (!entity) continue;
      const cluster = await BrainStore.listEntityCluster(entity.id);
      const names = cluster.length > 0
        ? [...new Set(cluster.map((member) => member.name))]
        : [entity.name, ...entityAliasNames(entity.name)];
      if (!names.some((name) => shouldJoinEntityToMemories(query, name))) continue;

      const related = await KnowledgeGraph.loadMemoriesMentioning(names, {
        largeBrain,
        fetchLimit,
      });

      let kept = 0;
      for (const memory of related) {
        const haystack = `${memory.title ?? ""} ${memory.content ?? ""} ${memory.keywords ?? ""}`;
        if (!names.some((name) => entityNameMatchesMemory(haystack, name))) continue;
        const current = graphScores.get(memory.id) ?? 0;
        if (row.score > current) graphScores.set(memory.id, row.score);
        kept++;
        if (kept >= config.graph_neighbor_memory_limit) break;
      }
    }
    return graphScores;
  }

  private static async loadMemoriesMentioning(
    names: string[],
    options: { largeBrain: boolean; fetchLimit: number },
  ): Promise<Array<{ id: number; title?: string; content?: string; keywords?: string }>> {
    const db = await BrainStore.get();
    const needles = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))];
    if (needles.length === 0) return [];
    const seen = new Map<number, { id: number; title?: string; content?: string; keywords?: string }>();

    if (options.largeBrain) {
      for (const name of needles) {
        const phrase = name.toLowerCase().replace(/"/g, "").trim();
        if (!phrase) continue;
        try {
          const rows = await db.all(
            `WITH hits AS (
               SELECT rowid AS id, bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS rank
               FROM brain_semantic_fts
               WHERE brain_semantic_fts MATCH ?
               ORDER BY rank
               LIMIT ?
             )
             SELECT s.id, s.title, s.content, s.keywords
             FROM hits JOIN brain_semantic s ON s.id = hits.id
             WHERE (s.expires_at IS NULL OR s.expires_at > datetime('now'))
               AND ${queryScopeSql("semantic", "s")}
             ORDER BY hits.rank
             LIMIT ?`,
            [`"${phrase}"`, options.fetchLimit * 10, options.fetchLimit],
          );
          for (const row of rows as Array<{ id: number; title?: string; content?: string; keywords?: string }>) {
            seen.set(row.id, row);
          }
        } catch {
          // FTS miss — LIKE below
        }
      }
      if (seen.size > 0) return [...seen.values()];
    }

    const likeSql = needles.map(() =>
      "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
    ).join(" OR ");
    const likeParams = needles.flatMap((name) => {
      const like = `%${name.toLowerCase()}%`;
      return [like, like, like];
    });
    const rows = await db.all(
      `SELECT id, title, content, keywords FROM brain_semantic
       WHERE (${likeSql})
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND ${queryScopeSql("semantic")}
       LIMIT ?`,
      [...likeParams, options.fetchLimit],
    );
    return rows as Array<{ id: number; title?: string; content?: string; keywords?: string }>;
  }

  private static lazyGraphView(): {
    getNeighbors: (id: number) => Promise<GraphNeighbor[]>;
    getDegree: (id: number) => Promise<number>;
  } {
    const cache = new Map<number, GraphNeighbor[]>();
    const getNeighbors = async (id: number): Promise<GraphNeighbor[]> => {
      let list = cache.get(id);
      if (!list) {
        const canonicalId = await BrainStore.resolveCanonicalId(id);
        const cluster = new Set(await BrainStore.listEntityClusterIds(canonicalId));
        const edges = await BrainStore.getEntityEdges(canonicalId);
        const agg = new Map<number, number>();
        for (const edge of edges) {
          const other = cluster.has(edge.source_entity_id)
            ? edge.target_entity_id
            : edge.source_entity_id;
          const neighbor = await BrainStore.resolveCanonicalId(other);
          if (cluster.has(neighbor) || neighbor === canonicalId) continue;
          const weight = Number.isFinite(edge.weight) ? Math.max(0, edge.weight) : 0;
          if (weight <= 0) continue;
          agg.set(neighbor, (agg.get(neighbor) ?? 0) + weight);
        }
        list = [...agg.entries()].map(([nid, weight]) => ({ id: nid, weight }));
        cache.set(id, list);
      }
      return list;
    };
    return {
      getNeighbors: async (id: number) => getNeighbors(await BrainStore.resolveCanonicalId(id)),
      getDegree: async (id: number) => (await getNeighbors(await BrainStore.resolveCanonicalId(id))).length,
    };
  }

  /**
   * Get graph statistics.
   */
  static async getStats(): Promise<{ entities: number; edges: number; entityTypes: Record<string, number> }> {
    return BrainStore.getGraphStats();
  }

  /**
   * Graph channel gauge for dashboard (IMP-11 / MEM-08 / MEM-25 / MEM-26).
   * Entity count is canonical channel size (aliases collapsed), not C_addr.
   * There is no entity cap; leftover max_entities / γ fields stay 0 / unused.
   */
  static async getCapStatus(): Promise<GraphCapStatus> {
    const config = BrainStore.getConfig();
    const theorem = getTheoremParams();
    const stats = await BrainStore.getGraphStats();
    const count = stats.entities;
    return {
      entity_count: count,
      channel_size: count,
      max_entities: 0,
      cap_utilization: 0,
      at_cap: false,
      is_capacity: false,
      max_depth: config.graph_max_depth,
      depth_decay_gamma: config.graph_depth_decay_gamma,
      ppr_alpha: theorem.pprAlpha,
      ppr_epsilon: theorem.pprEpsilon,
      edges: stats.edges,
      entity_types: stats.entityTypes,
    };
  }

  /**
   * MEM-25: no entity capacity. Disk budget is `max_bytes`. Returns 0.
   */
  static async enforceEntityCap(_options?: { makeRoom?: boolean }): Promise<number> {
    return 0;
  }

  // ── Entity Extraction (Rule-Based) ─────────────────────────────────────────

  /**
   * Extract entities from text using rule-based patterns.
   * Mirrors Knox-MS's fallback extraction when LLM is unavailable.
   *
   * Detects:
   * - Technology names (languages, frameworks, tools)
   * - File paths and extensions
   * - Function/class names (camelCase, PascalCase)
   * - URLs and domains
   * - Common patterns
   */
  static extractEntitiesFromText(text: string): AddEntityInput[] {
    const entities: AddEntityInput[] = [];
    const seen = new Set<string>();

    const addUnique = (input: AddEntityInput) => {
      const key = `${input.entity_type}:${KnowledgeGraph.normalizeName(input.name)}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push(input);
      }
    };

    // Technology patterns (programming languages, frameworks, tools)
    const techPatterns: [RegExp, string][] = [
      [/\b(TypeScript|JavaScript|Python|Rust|Java|Go|Ruby|PHP|C\+\+|C#|Swift|Kotlin|Scala|Haskell|Elixir|Clojure)\b/gi, "technology"],
      [/\b(React|Vue|Angular|Svelte|Next\.js|Nuxt|Express|FastAPI|Django|Flask|Spring|Rails|Laravel|ASP\.NET)\b/gi, "technology"],
      [/\b(Node\.js|Deno|Bun|Docker|Kubernetes|PostgreSQL|MySQL|MongoDB|Redis|SQLite|Elasticsearch)\b/gi, "technology"],
      [/\b(AWS|Azure|GCP|Vercel|Netlify|Cloudflare|Supabase|Firebase|Heroku)\b/gi, "technology"],
      [/\b(Git|GitHub|GitLab|Bitbucket|npm|yarn|pnpm|pip|cargo|gradle|maven)\b/gi, "technology"],
      [/\b(VS Code|Vim|Neovim|IntelliJ|WebStorm|Xcode|Android Studio)\b/gi, "technology"],
      [/\b(REST|GraphQL|gRPC|WebSocket|Socket\.IO|HTTP|HTTPS|TCP|UDP)\b/gi, "technology"],
      [/\b(JWT|OAuth|SAML|OpenID|API|SDK|CLI|GUI|TUI|IDE)\b/gi, "concept"],
    ];

    for (const group of ENTITY_ALIAS_GROUPS) {
      for (const alias of group) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(alias)) continue;
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        techPatterns.push([new RegExp(`\\b(${escaped})\\b`, "gi"), "technology"]);
      }
    }

    for (const [pattern, type] of techPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        addUnique({
          name: match[1],
          entity_type: type as EntityType,
          description: `Mentioned in text`,
          confidence: 0.85,
        });
      }
    }

    // File paths
    const filePattern = /(?:^|\s|["'`(])([./~]?(?:[\w-]+\/)+[\w.-]+\.\w{1,10})(?:\s|["'`)]|$)/gm;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      addUnique({
        name: match[1],
        entity_type: "file",
        description: "File path mentioned in text",
        confidence: 0.75,
      });
    }

    // PascalCase class names (3+ chars, starts uppercase, has lowercase)
    const classPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    while ((match = classPattern.exec(text)) !== null) {
      if (match[1].length >= 4) {
        addUnique({
          name: match[1],
          entity_type: "class",
          description: "PascalCase identifier",
          confidence: 0.6,
        });
      }
    }

    // Function-like patterns: word followed by ()
    const fnPattern = /\b([a-z][a-zA-Z0-9_]+)\s*\(/g;
    while ((match = fnPattern.exec(text)) !== null) {
      const name = match[1];
      // Filter common words that look like functions
      const ignore = new Set(["if", "for", "while", "switch", "catch", "return", "throw", "new", "typeof", "instanceof", "delete", "void", "import", "export", "from", "require"]);
      if (!ignore.has(name) && name.length >= 3) {
        addUnique({
          name,
          entity_type: "function",
          description: "Function call in text",
          confidence: 0.55,
        });
      }
    }

    // Environment variables
    const envPattern = /\b([A-Z][A-Z0-9_]{2,})\b/g;
    while ((match = envPattern.exec(text)) !== null) {
      const name = match[1];
      // Only if it looks like an env var (has underscore or is known pattern)
      if (name.includes("_") && name.length >= 4) {
        addUnique({
          name,
          entity_type: "variable",
          description: "Environment variable or constant",
          confidence: 0.5,
        });
      }
    }

    return entities;
  }

  /**
   * Extract entities from text and add them to the graph.
   * Returns the number of entities added/updated.
   */
  static async extractAndStore(text: string): Promise<{ added: number; updated: number; entities: GraphEntity[] }> {
    const extracted = KnowledgeGraph.extractEntitiesFromText(text);
    let added = 0;
    let updated = 0;
    const storedEntities: GraphEntity[] = [];

    for (const input of extracted) {
      const existing = await BrainStore.findEntity(
        KnowledgeGraph.normalizeName(input.name),
        input.entity_type,
      );

      const id = await KnowledgeGraph.addEntity(input);
      const entity = await BrainStore.getEntity(id);
      if (entity) storedEntities.push(entity);

      if (existing) {
        updated++;
      } else {
        added++;
      }
    }

    // Auto-create edges between co-occurring entities
    if (storedEntities.length >= 2) {
      for (let i = 0; i < storedEntities.length - 1; i++) {
        for (let j = i + 1; j < Math.min(i + 5, storedEntities.length); j++) {
          await KnowledgeGraph.addEdge({
            source_entity_id: storedEntities[i].id,
            target_entity_id: storedEntities[j].id,
            relationship: "co_mentioned",
            weight: 0.3,
          });
        }
      }
    }

    return { added, updated, entities: storedEntities };
  }

  /**
   * Merge co-mentioned entity names into semantic memory keywords (IMP-21).
   */
  static mergeEntityKeywords(
    existingKeywords: string,
    content: string,
    title: string,
    entities: GraphEntity[],
  ): string {
    const keywords = new Set(
      existingKeywords.split(",").map((k) => k.trim()).filter(Boolean),
    );
    const haystack = `${title} ${content}`.toLowerCase();
    for (const entity of entities) {
      if (entity.name.length >= 2 && haystack.includes(entity.name.toLowerCase())) {
        keywords.add(entity.name.toLowerCase().replace(/\s+/g, "_"));
        keywords.add(entity.entity_type);
      }
    }
    return [...keywords].join(", ");
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  static formatEntityList(entities: GraphEntity[], header: string): string {
    if (entities.length === 0) return `${header}\nNo entities found.`;
    const parts = [header];
    for (const e of entities) {
      parts.push(`  [#${e.id}] [${e.entity_type}] ${e.name} (confidence: ${e.confidence.toFixed(2)}, mentions: ${e.mention_count})`);
      if (e.description) {
        parts.push(`    ${e.description.substring(0, 200)}`);
      }
    }
    return parts.join("\n");
  }

  static formatExploreResult(result: GraphExploreResult): string {
    const parts: string[] = [];
    parts.push(`Graph Exploration from: ${result.center.name} [${result.center.entity_type}]`);
    parts.push(`Depth reached: ${result.depth_reached}`);
    parts.push(`Entities found: ${result.entities.length}`);
    parts.push(`Edges found: ${result.edges.length}`);
    parts.push("");

    parts.push("Entities:");
    for (const e of result.entities) {
      const marker = e.id === result.center.id ? "★" : "•";
      const depth = result.entity_depths[e.id] ?? 0;
      const activation = result.activation_scores[e.id];
      const activationStr =
        activation !== undefined ? `, activation: ${activation.toFixed(3)}` : "";
      parts.push(
        `  ${marker} [#${e.id}] [${e.entity_type}] ${e.name} (depth: ${depth}${activationStr})`,
      );
    }

    if (result.edges.length > 0) {
      parts.push("");
      parts.push("Relationships:");
      for (const edge of result.edges) {
        const srcName = result.entities.find((e) => e.id === edge.source_entity_id)?.name ?? `#${edge.source_entity_id}`;
        const tgtName = result.entities.find((e) => e.id === edge.target_entity_id)?.name ?? `#${edge.target_entity_id}`;
        parts.push(`  ${srcName} —[${edge.relationship}]→ ${tgtName} (weight: ${edge.weight.toFixed(2)})`);
      }
    }

    return parts.join("\n");
  }

  static formatGraphStats(stats: {
    entities: number;
    edges: number;
    entityTypes: Record<string, number>;
    cap?: GraphCapStatus;
  }): string {
    const parts = [
      "Knowledge Graph Statistics:",
      `  Total Entities: ${stats.entities}`,
      `  Total Edges: ${stats.edges}`,
      `  Entity Types: ${Object.entries(stats.entityTypes).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    ];
    if (stats.cap) {
      parts.push(
        `  Channel size: ${stats.cap.channel_size} entities (not C_addr)`,
        `  Hub-damped PPR: α=${stats.cap.ppr_alpha}, ε=${stats.cap.ppr_epsilon}`,
        `  No entity cap — disk budget is max_bytes`,
      );
    }
    return parts.filter(Boolean).join("\n");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static normalizeName(name: string): string {
    return normalizeEntityName(name);
  }
}
