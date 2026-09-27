import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const memoryLearnTool: Tool = {
  type: "function",
  displayTitle: "Memory Learn",
  wouldLikeTo: "access the learning engine",
  isCurrently: "using learning engine",
  hasAlready: "used learning engine",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.MemoryLearn,
    description: `Learning engine and procedural memory for the Memory Brain — patterns, procedures, spaced repetition, and LLM-powered analysis.

**Learning Patterns:**
- **learn_pattern**: Record a success/failure pattern for a goal type with signature, context, and token usage
- **suggest_approach**: Get suggestions for a goal based on learned patterns (Jaccard similarity matching)
- **get_patterns**: List learned patterns, optionally filtered by goal type

**Procedural Memory:**
- **store_procedure**: Store a named workflow with ordered steps and trigger pattern
- **get_procedures**: List stored procedures
- **execute_procedure**: Record execution of a procedure (tracks success rate)

**Spaced Repetition:**
- **get_review_due**: Get memories due for review based on Ebbinghaus forgetting curve
- **boost_memory**: Boost a memory's importance via spaced repetition retrieval

**LLM-Enhanced Analysis:**
- **llm_evaluate_importance**: Score content importance using LLM semantic understanding — falls back to heuristic
- **llm_summarize_session**: Generate LLM-powered session summary with topics, decisions, action items
- **llm_post_action_memory**: After an action completes, LLM decides what to remember (facts, entities, patterns)

Use learn_pattern after completing tasks to build experience. Use suggest_approach before starting similar tasks. Use get_review_due to revisit fading knowledge.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "learn_pattern",
            "suggest_approach",
            "get_patterns",
            "store_procedure",
            "get_procedures",
            "execute_procedure",
            "get_review_due",
            "boost_memory",
            "llm_evaluate_importance",
            "llm_summarize_session",
            "llm_post_action_memory",
          ],
          description: "The learning operation to perform",
        },
        // Learning params
        goal_type: {
          type: "string",
          enum: ["coding", "analysis", "research", "creative", "debugging", "documentation", "explanation", "planning", "conversation", "other"],
          description: "[learn_pattern/suggest_approach/get_patterns] Goal classification",
        },
        pattern_signature: {
          type: "string",
          description: "[learn_pattern] Short signature for the pattern",
        },
        content: {
          type: "string",
          description: "[learn_pattern] Context and details of the pattern",
        },
        success: {
          type: "boolean",
          description: "[learn_pattern/execute_procedure] Whether the outcome was successful",
        },
        tokens_used: {
          type: "number",
          description: "[learn_pattern] Tokens consumed during this pattern",
        },
        query: {
          type: "string",
          description: "[suggest_approach] Query for approach suggestions",
        },
        // Procedure params
        name: {
          type: "string",
          description: "[store_procedure] Procedure name",
        },
        description: {
          type: "string",
          description: "[store_procedure] Procedure description",
        },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "[store_procedure] Ordered list of procedure steps",
        },
        trigger_pattern: {
          type: "string",
          description: "[store_procedure] Pattern that triggers this procedure",
        },
        id: {
          type: "number",
          description: "[execute_procedure] Procedure ID",
        },
        // Spaced repetition params
        memory_id: {
          type: "number",
          description: "[boost_memory] Memory ID to boost",
        },
        retention_threshold: {
          type: "number",
          description: "[get_review_due] Retention threshold for review (default: 0.5)",
        },
        // LLM params
        session_id: {
          type: "string",
          description: "[llm_summarize_session] Session ID to summarize",
        },
        detail_level: {
          type: "string",
          enum: ["brief", "detailed"],
          description: "[llm_summarize_session] Level of detail (default: detailed)",
        },
        role: {
          type: "string",
          description: "[llm_evaluate_importance] Role of the message author",
        },
        context: {
          type: "string",
          description: "[llm_evaluate_importance] Additional context for evaluation",
        },
        action_description: {
          type: "string",
          description: "[llm_post_action_memory] Description of the action performed",
        },
        action_result: {
          type: "string",
          description: "[llm_post_action_memory] Result of the action",
        },
        text: {
          type: "string",
          description: "[llm_evaluate_importance] Text to evaluate (alias for content)",
        },
        limit: {
          type: "number",
          description: "[get_patterns/get_procedures/suggest_approach/get_review_due] Maximum results",
        },
      },
    },
  },
};
