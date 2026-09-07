import { BrainStore } from "./BrainStore.js";
import {
  isCommonNounEntityName,
  queryMentionsEntity,
} from "./GraphRetrieval.js";
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
 * - Graph traversal with spreading activation
 * - Entity deduplication via name normalization
 * - Relationship scoring and ranking
 *
 * Supports 13 entity types matching Knox-MS:
 *   person, organization, technology, concept, project, file,
 *   function, class, variable, location, event, product, custom
 */
export class KnowledgeGraph {
  // ── Entity Operations ──────────────────────────────────────────────────────

  /**
   * Add or update an entity in the knowledge graph.
   * If an entity with the same normalized name + type exists, its mention count is incremented.
   */
  static async addEntity(input: AddEntityInput): Promise<number> {
    const existing = await BrainStore.findEntity(
      KnowledgeGraph.normalizeName(input.name),
      input.entity_type,
    );

    if (existing) {
      await BrainStore.incrementEntityMention(existing.id);
      if (input.description && input.description.length > (existing.description?.length ?? 0)) {
        await BrainStore.updateEntity(existing.id, { description: input.description });
      }
      return existing.id;
    }

    await KnowledgeGraph.enforceEntityCap({ makeRoom: true });

    return BrainStore.addEntity({
      name: input.name,
      entity_type: input.entity_type,
      description: input.description ?? "",
      properties: input.properties ?? {},
      confidence: input.confidence ?? 0.8,
    });
  }

  /**
   * Add an edge between two entities.
   */
  static async addEdge(input: AddEdgeInput): Promise<number> {
    // Check for existing edge between same entities with same relationship
    const existing = await BrainStore.findEdge(
      input.source_entity_id,
      input.target_entity_id,
      input.relationship,
    );

    if (existing) {
      // Strengthen existing edge
      await BrainStore.updateEdgeWeight(existing.id, Math.min(1.0, existing.weight + 0.1));
      return existing.id;
    }

    return BrainStore.addEdge(input);
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
   * Explore the graph from a starting entity, traversing edges up to a given depth.
   * Uses breadth-first spreading activation.
   */
  static async explore(input: ExploreGraphInput): Promise<GraphExploreResult> {
    const center = await BrainStore.getEntity(input.entity_id);
    if (!center) {
      throw new Error(`Entity #${input.entity_id} not found`);
    }

    const maxDepth = input.depth ?? BrainStore.getConfig().graph_max_depth;
    const limit = input.limit ?? 50;
    const gamma = BrainStore.getConfig().graph_depth_decay_gamma;

    const visited = new Set<number>();
    const entityDepths: Record<number, number> = { [center.id]: 0 };
    const activationScores: Record<number, number> = {
      [center.id]: center.confidence,
    };
    const allEntities: GraphEntity[] = [center];
    const allEdges: GraphEdge[] = [];
    let frontier = [center.id];
    let depthReached = 0;

    visited.add(center.id);
    void BrainStore.touchEntity(center.id);

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const nextFrontier: number[] = [];

      for (const entityId of frontier) {
        const parentDepth = entityDepths[entityId] ?? d;
        const edges = await BrainStore.getEntityEdges(entityId);
        for (const edge of edges) {
          allEdges.push(edge);

          const neighborId =
            edge.source_entity_id === entityId
              ? edge.target_entity_id
              : edge.source_entity_id;

          if (!visited.has(neighborId) && allEntities.length < limit) {
            visited.add(neighborId);
            const neighbor = await BrainStore.getEntity(neighborId);
            if (neighbor) {
              const depth = parentDepth + 1;
              entityDepths[neighbor.id] = depth;
              activationScores[neighbor.id] =
                neighbor.confidence * Math.pow(gamma, depth) * edge.weight;
              allEntities.push(neighbor);
              nextFrontier.push(neighborId);
              void BrainStore.touchEntity(neighbor.id);
            }
          }
        }
      }

      frontier = nextFrontier;
      if (nextFrontier.length > 0) depthReached = d + 1;
    }

    return {
      center,
      entities: allEntities,
      edges: allEdges,
      depth_reached: depthReached,
      entity_depths: entityDepths,
      activation_scores: activationScores,
    };
  }

  /**
   * Get graph statistics.
   */
  static async getStats(): Promise<{ entities: number; edges: number; entityTypes: Record<string, number> }> {
    return BrainStore.getGraphStats();
  }

  /**
   * Entity cap + spreading-activation config for dashboard (IMP-11).
   * Knox-MS: max 5K entities, LRU refresh via mention_count + updated_at.
   */
  static async getCapStatus(): Promise<GraphCapStatus> {
    const config = BrainStore.getConfig();
    const stats = await BrainStore.getGraphStats();
    const max = config.graph_max_entities;
    const count = stats.entities;
    return {
      entity_count: count,
      max_entities: max,
      cap_utilization: max > 0 ? count / max : 0,
      at_cap: max > 0 && count >= max,
      max_depth: config.graph_max_depth,
      depth_decay_gamma: config.graph_depth_decay_gamma,
      edges: stats.edges,
      entity_types: stats.entityTypes,
    };
  }

  /**
   * Enforce max entity cap (Knox-MS: 5K entities, refreshable via LRU).
   * @param makeRoom When true (before insert), prune until count < max.
   *                 When false (init/config), prune until count <= max.
   */
  static async enforceEntityCap(options?: { makeRoom?: boolean }): Promise<number> {
    const config = BrainStore.getConfig();
    const max = config.graph_max_entities;
    if (max <= 0) return 0;

    const count = await BrainStore.countEntities();
    const toPrune = options?.makeRoom
      ? count >= max
        ? count - max + 1
        : 0
      : count > max
        ? count - max
        : 0;
    if (toPrune <= 0) return 0;

    const pruned = await BrainStore.pruneEntities(toPrune);
    if (pruned > 0) {
      await BrainStore.auditLog("graph:entity_cap_prune", "entity", null, {
        pruned,
        max_entities: max,
        count_before: count,
      }).catch(() => {});
    }
    return pruned;
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
        `  Cap: ${stats.cap.entity_count}/${stats.cap.max_entities} (${(stats.cap.cap_utilization * 100).toFixed(1)}%)`,
        `  Max depth: ${stats.cap.max_depth}, γ=${stats.cap.depth_decay_gamma}`,
        stats.cap.at_cap ? "  ⚠ At entity cap — LRU prune active on new inserts" : "",
      );
    }
    return parts.filter(Boolean).join("\n");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }
}
