/**
 * Advanced Tool Definitions - Innovative new tools
 * 
 * These tools provide advanced capabilities beyond basic file/terminal operations
 */

import { Tool } from "../../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../../builtIn";

/**
 * Test Generator Tool - Generate tests for code
 */
export const testGeneratorTool: Tool = {
  type: "function",
  displayTitle: "Generate Tests",
  wouldLikeTo: "generate tests for {{{ filepath }}}",
  isCurrently: "generating tests for {{{ filepath }}}",
  hasAlready: "generated tests for {{{ filepath }}}",
  readonly: false,
  group: "Testing",
  function: {
    name: "builtin_generate_tests",
    description: `Generate comprehensive tests for code:
- Unit tests for functions and methods
- Integration tests for modules
- Edge case detection
- Mock generation for dependencies
- Test framework integration (Vitest, Mocha, pytest, etc.)`,
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description: "Path to the file to generate tests for"
        },
        testFramework: {
          type: "string",
          enum: ["vitest", "mocha", "pytest", "auto"],
          description: "Testing framework to use"
        },
        coverage: {
          type: "string",
          enum: ["basic", "comprehensive", "edge_cases"],
          description: "Level of test coverage"
        },
        functions: {
          type: "array",
          items: { type: "string" },
          description: "Specific functions to test (optional, all if not specified)"
        },
        includeMocks: {
          type: "boolean",
          description: "Generate mocks for dependencies"
        },
        outputPath: {
          type: "string",
          description: "Where to save generated tests"
        }
      }
    }
  }
};

// Import enhanced search tools
import { enhancedSearchTool, intelligentChainTool } from "./enhancedSearch";

/**
 * Advanced tools that are fully implemented and safe to expose.
 * `builtin_generate_tests` lives in basic `allTools` (see tools/index.ts).
 *
 * Definition-only tools (analyze_code, multi_file_search, refactor, generate_docs,
 * git_operations, analyze_performance, analyze_dependencies, explain_code,
 * scaffold_project) were deleted for 2.0.0: they had no `callTool` implementation.
 */
export const advancedTools = [
  enhancedSearchTool,
  intelligentChainTool,
];
