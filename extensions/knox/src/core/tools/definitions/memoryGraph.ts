import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const memoryGraphTool: Tool = {
  type: "function",
  displayTitle: "Memory Graph",
  wouldLikeTo: "access the knowledge graph",
  isCurrently: "querying knowledge graph",
  hasAlready: "queried knowledge graph",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.MemoryGraph,
    description: `Knowledge graph operations for the Memory Brain — entities, relationships, and graph traversal.

**Entity Management:**
- **add_entity**: Add an entity (person, technology, concept, file, function, class, etc.) with name, type, and description
- **search_entities**: Search entities by name/description with optional type filter
- **extract_entities**: Auto-extract entities from text using rule-based NER patterns

**Relationships:**
- **add_edge**: Create a weighted, labeled relationship between two entities
- **explore_graph**: Traverse the graph from an entity with spreading activation and configurable depth

**Statistics:**
- **get_graph_stats**: View knowledge graph statistics (entity count, edge count, most connected nodes)

**LLM-Enhanced:**
- **llm_extract_entities**: Extract entities using LLM NER (people, orgs, concepts, locations) — falls back to rule-based if unavailable

Use add_entity to register important concepts, then add_edge to connect them. Use explore_graph to discover related knowledge.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "add_entity",
            "search_entities",
            "add_edge",
            "explore_graph",
            "get_graph_stats",
            "extract_entities",
            "llm_extract_entities",
          ],
          description: "The knowledge graph operation to perform",
        },
        name: {
          type: "string",
          description: "[add_entity] Entity name",
        },
        entity_type: {
          type: "string",
          enum: ["person", "organization", "technology", "concept", "project", "file", "function", "class", "variable", "location", "event", "product", "custom"],
          description: "[add_entity/search_entities] Entity type",
        },
        description: {
          type: "string",
          description: "[add_entity] Entity description",
        },
        query: {
          type: "string",
          description: "[search_entities] Search query",
        },
        entity_id: {
          type: "number",
          description: "[explore_graph] Starting entity ID",
        },
        source_entity_id: {
          type: "number",
          description: "[add_edge] Source entity ID",
        },
        target_entity_id: {
          type: "number",
          description: "[add_edge] Target entity ID",
        },
        relationship: {
          type: "string",
          description: "[add_edge] Relationship label",
        },
        weight: {
          type: "number",
          description: "[add_edge] Edge weight 0.0–1.0 (default: 0.5)",
        },
        depth: {
          type: "number",
          description: "[explore_graph] Traversal depth (default: 2)",
        },
        text: {
          type: "string",
          description: "[extract_entities/llm_extract_entities] Text to extract entities from",
        },
        content: {
          type: "string",
          description: "[extract_entities/llm_extract_entities] Content text (alias for text)",
        },
        limit: {
          type: "number",
          description: "[search_entities/explore_graph] Maximum results",
        },
        id: {
          type: "number",
          description: "[explore_graph] Entity ID (alias for entity_id)",
        },
      },
    },
  },
};
