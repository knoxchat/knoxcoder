/**
 * Advanced Tool Definitions - Innovative new tools
 * 
 * These tools provide advanced capabilities beyond basic file/terminal operations
 */

import { Tool } from "../../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../../builtIn";

/**
 * Code Analysis Tool - Deep code understanding
 */
export const codeAnalysisTool: Tool = {
  type: "function",
  displayTitle: "Analyze Code",
  wouldLikeTo: "analyze code in {{{ filepath }}}",
  isCurrently: "analyzing {{{ filepath }}}",
  hasAlready: "analyzed code in {{{ filepath }}}",
  readonly: true,
  group: "Analysis",
  function: {
    name: "builtin_analyze_code",
    description: `Perform deep analysis of code including:
- Identify functions, classes, and their relationships
- Detect code patterns and anti-patterns
- Find potential bugs and security issues
- Analyze complexity metrics
- Extract documentation and comments
- Map dependencies between modules`,
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description: "Path to the file to analyze"
        },
        analysisType: {
          type: "string",
          enum: ["full", "structure", "dependencies", "security", "complexity", "patterns"],
          description: "Type of analysis to perform"
        },
        includeMetrics: {
          type: "boolean",
          description: "Include quantitative metrics like cyclomatic complexity"
        }
      }
    }
  }
};

/**
 * Multi-File Search Tool - Search across multiple files with context
 */
export const multiFileSearchTool: Tool = {
  type: "function",
  displayTitle: "Multi-File Search",
  wouldLikeTo: 'search for "{{{ query }}}" across files',
  isCurrently: 'searching for "{{{ query }}}"',
  hasAlready: 'searched for "{{{ query }}}"',
  readonly: true,
  group: "Search",
  function: {
    name: "builtin_multi_file_search",
    description: `Search across multiple files with advanced features:
- Semantic search using code understanding
- Regex patterns with context
- Filter by file type, directory, or pattern
- Return results with surrounding context
- Group results by file or relevance`,
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query (supports regex and semantic search)"
        },
        searchType: {
          type: "string",
          enum: ["exact", "regex", "semantic", "fuzzy"],
          description: "Type of search to perform"
        },
        filePattern: {
          type: "string",
          description: "Glob pattern to filter files (e.g., '**/*.ts')"
        },
        excludePattern: {
          type: "string",
          description: "Glob pattern to exclude files"
        },
        contextLines: {
          type: "number",
          description: "Number of context lines before and after matches"
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return"
        },
        groupBy: {
          type: "string",
          enum: ["file", "relevance", "directory"],
          description: "How to group results"
        }
      }
    }
  }
};

/**
 * Refactor Tool - Intelligent code refactoring
 */
export const refactorTool: Tool = {
  type: "function",
  displayTitle: "Refactor Code",
  wouldLikeTo: "refactor code: {{{ description }}}",
  isCurrently: "refactoring: {{{ description }}}",
  hasAlready: "refactored: {{{ description }}}",
  readonly: false,
  group: "Code Modification",
  function: {
    name: "builtin_refactor",
    description: `Perform intelligent code refactoring:
- Rename symbols across the codebase
- Extract functions/methods
- Inline functions
- Move code between files
- Convert between patterns (e.g., callbacks to async/await)
- Apply design patterns`,
    parameters: {
      type: "object",
      required: ["refactorType", "target"],
      properties: {
        refactorType: {
          type: "string",
          enum: ["rename", "extract_function", "extract_variable", "inline", "move", "convert_pattern"],
          description: "Type of refactoring to perform"
        },
        target: {
          type: "object",
          description: "Target of the refactoring (file, symbol, selection)"
        },
        newName: {
          type: "string",
          description: "New name for rename refactoring"
        },
        description: {
          type: "string",
          description: "Description of what to refactor"
        },
        dryRun: {
          type: "boolean",
          description: "Preview changes without applying them"
        }
      }
    }
  }
};

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

/**
 * Documentation Generator Tool
 */
export const docGeneratorTool: Tool = {
  type: "function",
  displayTitle: "Generate Documentation",
  wouldLikeTo: "generate documentation for {{{ target }}}",
  isCurrently: "generating documentation",
  hasAlready: "generated documentation",
  readonly: false,
  group: "Documentation",
  function: {
    name: "builtin_generate_docs",
    description: `Generate documentation for code:
- JSDoc/TSDoc comments for functions
- README generation
- API documentation
- Usage examples
- Architecture diagrams (as Mermaid)`,
    parameters: {
      type: "object",
      required: ["target"],
      properties: {
        target: {
          type: "string",
          description: "File or directory to document"
        },
        docType: {
          type: "string",
          enum: ["inline", "readme", "api", "full"],
          description: "Type of documentation to generate"
        },
        format: {
          type: "string",
          enum: ["markdown", "jsdoc", "tsdoc", "rst"],
          description: "Documentation format"
        },
        includeExamples: {
          type: "boolean",
          description: "Include usage examples"
        },
        includeDiagrams: {
          type: "boolean",
          description: "Include architecture/flow diagrams"
        }
      }
    }
  }
};

/**
 * Git Operations Tool - Advanced git operations
 */
export const gitOperationsTool: Tool = {
  type: "function",
  displayTitle: "Git Operations",
  wouldLikeTo: "perform git operation: {{{ operation }}}",
  isCurrently: "performing git {{{ operation }}}",
  hasAlready: "completed git {{{ operation }}}",
  readonly: false,
  group: "Version Control",
  function: {
    name: "builtin_git_operations",
    description: `Perform advanced git operations:
- View detailed commit history
- Create semantic commits
- Branch management
- Interactive staging
- Conflict resolution assistance
- Blame and history analysis`,
    parameters: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: ["history", "commit", "branch", "stash", "blame", "cherry-pick", "rebase", "conflicts"],
          description: "Git operation to perform"
        },
        target: {
          type: "string",
          description: "Target file, branch, or commit"
        },
        message: {
          type: "string",
          description: "Commit message (for commit operation)"
        },
        options: {
          type: "object",
          description: "Additional options for the operation"
        }
      }
    }
  }
};

/**
 * Performance Analyzer Tool
 */
export const performanceAnalyzerTool: Tool = {
  type: "function",
  displayTitle: "Analyze Performance",
  wouldLikeTo: "analyze performance of {{{ target }}}",
  isCurrently: "analyzing performance",
  hasAlready: "analyzed performance",
  readonly: true,
  group: "Analysis",
  function: {
    name: "builtin_analyze_performance",
    description: `Analyze code performance:
- Identify performance bottlenecks
- Memory usage patterns
- Time complexity analysis
- Suggest optimizations
- Compare alternative implementations`,
    parameters: {
      type: "object",
      required: ["target"],
      properties: {
        target: {
          type: "string",
          description: "File or function to analyze"
        },
        analysisType: {
          type: "string",
          enum: ["time", "memory", "both", "recommendations"],
          description: "Type of performance analysis"
        },
        benchmark: {
          type: "boolean",
          description: "Run actual benchmarks if possible"
        }
      }
    }
  }
};

/**
 * Dependency Analyzer Tool
 */
export const dependencyAnalyzerTool: Tool = {
  type: "function",
  displayTitle: "Analyze Dependencies",
  wouldLikeTo: "analyze dependencies",
  isCurrently: "analyzing dependencies",
  hasAlready: "analyzed dependencies",
  readonly: true,
  group: "Analysis",
  function: {
    name: "builtin_analyze_dependencies",
    description: `Analyze project dependencies:
- Show dependency tree
- Find outdated packages
- Security vulnerability scan
- Unused dependency detection
- Circular dependency detection
- License compliance check`,
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "production", "development"],
          description: "Which dependencies to analyze"
        },
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: ["outdated", "security", "unused", "circular", "licenses"]
          },
          description: "Which checks to perform"
        },
        depth: {
          type: "number",
          description: "How deep to analyze transitive dependencies"
        }
      }
    }
  }
};

/**
 * Code Explanation Tool - Explain complex code
 */
export const codeExplanationTool: Tool = {
  type: "function",
  displayTitle: "Explain Code",
  wouldLikeTo: "explain code in {{{ filepath }}}",
  isCurrently: "explaining code",
  hasAlready: "explained code",
  readonly: true,
  group: "Documentation",
  function: {
    name: "builtin_explain_code",
    description: `Provide detailed explanations of code:
- Line-by-line breakdown
- Algorithm explanation
- Design pattern identification
- Business logic interpretation
- Complexity analysis`,
    parameters: {
      type: "object",
      required: ["target"],
      properties: {
        target: {
          type: "string",
          description: "File path or code snippet to explain"
        },
        depth: {
          type: "string",
          enum: ["overview", "detailed", "line-by-line"],
          description: "Depth of explanation"
        },
        audience: {
          type: "string",
          enum: ["beginner", "intermediate", "expert"],
          description: "Target audience level"
        },
        focusAreas: {
          type: "array",
          items: { type: "string" },
          description: "Specific areas to focus on"
        }
      }
    }
  }
};

/**
 * Project Scaffold Tool - Create project structures
 */
export const projectScaffoldTool: Tool = {
  type: "function",
  displayTitle: "Scaffold Project",
  wouldLikeTo: "scaffold {{{ projectType }}} project",
  isCurrently: "scaffolding project",
  hasAlready: "scaffolded project",
  readonly: false,
  group: "Project",
  function: {
    name: "builtin_scaffold_project",
    description: `Create project scaffolds:
- Generate project structure
- Setup configuration files
- Initialize git repository
- Configure build tools
- Setup testing framework
- Add common dependencies`,
    parameters: {
      type: "object",
      required: ["projectType"],
      properties: {
        projectType: {
          type: "string",
          enum: [
            "typescript-lib", "typescript-app", "react", "vue", "angular",
            "node-api", "express", "fastify", "nest", "next",
            "python-lib", "python-api", "django", "flask", "fastapi",
            "rust-lib", "rust-bin", "go-lib", "go-api"
          ],
          description: "Type of project to scaffold"
        },
        name: {
          type: "string",
          description: "Project name"
        },
        path: {
          type: "string",
          description: "Directory to create project in"
        },
        features: {
          type: "array",
          items: { type: "string" },
          description: "Additional features to include"
        },
        packageManager: {
          type: "string",
          enum: ["npm", "yarn", "pnpm", "bun"],
          description: "Package manager to use"
        }
      }
    }
  }
};

// Import enhanced search tools
import { enhancedSearchTool, intelligentChainTool } from "./enhancedSearch";

// Export all advanced tools
/**
 * Advanced tool definitions that are NOT yet wired in callTool.
 * Kept for reference / future work — do not expose via SmartToolRouter
 * until each has a real implementation.
 */
export const unimplementedAdvancedTools = [
  codeAnalysisTool,
  multiFileSearchTool,
  refactorTool,
  docGeneratorTool,
  gitOperationsTool,
  performanceAnalyzerTool,
  dependencyAnalyzerTool,
  codeExplanationTool,
  projectScaffoldTool,
];

/**
 * Advanced tools that are fully implemented and safe to expose.
 * `builtin_generate_tests` lives in basic `allTools` (see tools/index.ts).
 */
export const advancedTools = [
  enhancedSearchTool,
  intelligentChainTool,
];
