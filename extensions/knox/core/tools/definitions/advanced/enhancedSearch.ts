/**
 * Enhanced Unified Search Tool
 *
 * Multi-strategy codebase search: ripgrep exact match, fuzzy match,
 * structural analysis, and rule-based semantic expansion.
 */

import { Tool } from "../../..";

export const enhancedSearchTool: Tool = {
  type: "function",
  displayTitle: "Enhanced Search",
  wouldLikeTo: 'perform enhanced search for "{{{ query }}}"',
  isCurrently: 'searching with multiple strategies for "{{{ query }}}"',
  hasAlready: 'completed enhanced search for "{{{ query }}}"',
  readonly: true,
  group: "Advanced Search",
  function: {
    name: "builtin_enhanced_search",
    description: `Perform multi-strategy codebase search (ripgrep + fuzzy + structural + rule-based semantic):

Features:
- Multi-dimensional relevance scoring (syntactic, semantic, structural, behavioral, contextual)
- Parallel execution of multiple search strategies (exact, fuzzy, structural, semantic)
- Intelligent result fusion and deduplication
- Context-aware ranking based on project structure
- Learning from execution patterns to improve over time
- Progressive refinement for better results
- Adaptive strategy selection based on query analysis

Strategies:
1. Exact Match: High-precision keyword matching with ripgrep
2. Fuzzy Search: Finds approximate matches (typos, variations)
3. Structural Search: Code structure-aware (functions, classes, imports)
4. Semantic Search: Rule-based synonym expansion and concept mapping
5. Context-Aware: Uses file type, scope, and recent actions

Combines multiple signals for relevance:
- Understanding code structure and patterns
- Learning from successful searches
- Adapting to your codebase and usage patterns
- Providing explainable results with reasoning

Examples:
- "Find all authentication functions"
  Combines: exact match for "auth", structural search for functions, semantic variations
- "Search for error handling in the API layer"
  Uses: semantic understanding, structural awareness, context from file types
- "Locate the database connection setup"
  Applies: multi-strategy search with fuzzy matching for variations`,
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query (can be natural language)"
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 50)"
        },
        minConfidence: {
          type: "number",
          description: "Minimum confidence threshold 0-1 (default: 0.3)"
        },
        includeFuzzy: {
          type: "boolean",
          description: "Include fuzzy/approximate matches (default: true for complex queries)"
        },
        includeStructural: {
          type: "boolean",
          description: "Include code structure-aware search (default: true)"
        },
        contextLines: {
          type: "number",
          description: "Context lines around matches (default: 2)"
        },
        fileType: {
          type: "string",
          description: "Filter by file type (ts, js, py, etc.)"
        },
        scope: {
          type: "string",
          enum: ["file", "directory", "project", "global"],
          description: "Search scope (default: project)"
        },
        progressiveRefinement: {
          type: "boolean",
          description: "Automatically refine search if few results (default: true)"
        },
        strategies: {
          type: "array",
          items: {
            type: "string",
            enum: ["exact_match", "fuzzy_search", "structural_search", "semantic_search", "context_aware"]
          },
          description: "Specific strategies to use (default: auto-select based on query)"
        }
      }
    }
  }
};

export const intelligentChainTool: Tool = {
  type: "function",
  displayTitle: "Intelligent Task Chain",
  wouldLikeTo: 'execute intelligent task chain for "{{{ description }}}"',
  isCurrently: 'orchestrating multi-step task: "{{{ description }}}"',
  hasAlready: 'completed task chain: "{{{ description }}}"',
  readonly: false,
  group: "Advanced Orchestration",
  function: {
    name: "builtin_intelligent_chain",
    description: `Automatically generate and execute optimal tool sequences from natural language.

Features:
- Automatic tool sequence generation
- Dependency-aware execution planning
- Dynamic branching based on intermediate results
- Error recovery and alternative paths
- Learning from successful patterns

This tool understands complex requests and breaks them down:

Examples:
- "Find all error handlers and analyze their complexity"
  → Generates: Search → Read files → Analyze code
  
- "Search for the config file and update the timeout value"
  → Generates: Search → Read → Modify → Validate
  
- "Locate authentication code, read it, and generate tests"
  → Generates: Search → Read → Analyze → Generate tests

The orchestrator learns from execution patterns and adapts to provide
better tool chains over time.`,
    parameters: {
      type: "object",
      required: ["description"],
      properties: {
        description: {
          type: "string",
          description: "Natural language description of the task"
        },
        context: {
          type: "object",
          description: "Additional context for the task",
          properties: {
            currentFile: {
              type: "string",
              description: "Current file being worked on"
            },
            scope: {
              type: "string",
              enum: ["file", "directory", "project", "global"],
              description: "Task scope"
            },
            timeConstraint: {
              type: "string",
              enum: ["fast", "normal", "thorough"],
              description: "Execution speed preference"
            }
          }
        }
      }
    }
  }
};
