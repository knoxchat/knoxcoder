/**
 * Composite Tools — multi-step helpers with real `callTool` implementations.
 *
 * Not on the default chat tool list (`allTools`). Available via
 * `allAvailableTools` / opt-in config. Descriptions must match what the
 * implementations actually do (scaffolds, heuristics, regex migrate).
 * JS import/export/class heuristics are skipped for .c/.h/.S/Kconfig (HL-39).
 */

import { Tool } from "../../..";

/**
 * Smart File Editor - Read, analyze, and modify files intelligently
 */
export const smartFileEditorTool: Tool = {
  type: "function",
  displayTitle: "Smart Edit File",
  wouldLikeTo: 'intelligently edit "{{{ filepath }}}"',
  isCurrently: 'smart editing "{{{ filepath }}}"',
  hasAlready: 'smart edited "{{{ filepath }}}"',
  readonly: false,
  group: "Composite",
  function: {
    name: "composite_smart_edit",
    description: `Edit a file with backup + optional validation:
1. Read current content (optional backup)
2. Apply the requested modification
3. Optionally validate and roll back on failure

Implementation: read → modify → optional validate (not full AST analysis).`,
    parameters: {
      type: "object",
      required: ["filepath", "modification"],
      properties: {
        filepath: {
          type: "string",
          description: "Path to the file to edit"
        },
        modification: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["insert", "replace", "delete", "refactor", "fix"],
              description: "Type of modification"
            },
            target: {
              type: "string",
              description: "Target location (function name, line number, pattern)"
            },
            content: {
              type: "string",
              description: "New content for insert/replace operations"
            },
            description: {
              type: "string",
              description: "Description of what to change for intelligent operations"
            }
          }
        },
        validate: {
          type: "boolean",
          description: "Run validation after modification"
        },
        format: {
          type: "boolean",
          description: "Format the file after modification"
        },
        backup: {
          type: "boolean",
          description: "Create a backup before editing"
        }
      }
    }
  }
};

/**
 * Feature Implementation Tool - Implement features across multiple files
 */
export const featureImplementationTool: Tool = {
  type: "function",
  displayTitle: "Implement Feature",
  wouldLikeTo: 'implement feature: "{{{ featureName }}}"',
  isCurrently: 'implementing "{{{ featureName }}}"',
  hasAlready: 'implemented "{{{ featureName }}}"',
  readonly: false,
  group: "Composite",
  function: {
    name: "composite_implement_feature",
    description: `Scaffold a new feature (structural stubs only):
1. Inspect directory layout / conventions
2. Plan files to create
3. Write scaffold source/types (execute() throws NotImplemented until filled in)
4. Optionally add test scaffolds and markdown docs

Does not implement real business logic or create git commits.`,
    parameters: {
      type: "object",
      required: ["featureName", "description"],
      properties: {
        featureName: {
          type: "string",
          description: "Name of the feature to implement"
        },
        description: {
          type: "string",
          description: "Detailed description of the feature"
        },
        targetFiles: {
          type: "array",
          items: { type: "string" },
          description: "Specific files to modify (optional, auto-detect if not specified)"
        },
        generateTests: {
          type: "boolean",
          description: "Generate tests for the feature"
        },
        generateDocs: {
          type: "boolean",
          description: "Generate documentation"
        },
        commitChanges: {
          type: "boolean",
          description: "Automatically commit changes"
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
 * Bug Investigation Tool - Comprehensive bug investigation
 */
export const bugInvestigationTool: Tool = {
  type: "function",
  displayTitle: "Investigate Bug",
  wouldLikeTo: 'investigate bug: "{{{ bugDescription }}}"',
  isCurrently: "investigating bug",
  hasAlready: "investigated bug",
  readonly: true,
  group: "Composite",
  function: {
    name: "composite_investigate_bug",
    description: `Investigate a bug via search + optional web lookup:
1. Search the workspace for related symbols/errors
2. Optionally search the web for similar issues
3. Compile a heuristic report of candidate files/causes

Does not run git history analysis or deep static analysis.`,
    parameters: {
      type: "object",
      required: ["bugDescription"],
      properties: {
        bugDescription: {
          type: "string",
          description: "Description of the bug or error message"
        },
        errorStack: {
          type: "string",
          description: "Error stack trace if available"
        },
        affectedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Known affected files"
        },
        sinceCommit: {
          type: "string",
          description: "Check changes since this commit"
        },
        includeWebSearch: {
          type: "boolean",
          description: "Search web for similar issues"
        }
      }
    }
  }
};

/**
 * Code Review Tool - Automated code review
 */
export const codeReviewTool: Tool = {
  type: "function",
  displayTitle: "Review Code",
  wouldLikeTo: "review code changes",
  isCurrently: "reviewing code",
  hasAlready: "reviewed code",
  readonly: true,
  group: "Composite",
  function: {
    name: "composite_code_review",
    description: `Heuristic code review of local diffs:
1. Load view_diff output
2. Pattern-scan for common quality/security smells
3. Emit a markdown review report

Not a substitute for human review or dedicated SAST/coverage tools.`,
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["staged", "unstaged", "branch", "commit"],
          description: "Scope of changes to review"
        },
        branch: {
          type: "string",
          description: "Branch to compare against (for branch scope)"
        },
        commitHash: {
          type: "string",
          description: "Specific commit to review"
        },
        checkCategories: {
          type: "array",
          items: {
            type: "string",
            enum: ["quality", "security", "performance", "style", "documentation", "tests"]
          },
          description: "Categories of checks to perform"
        },
        severity: {
          type: "string",
          enum: ["all", "warnings-and-errors", "errors-only"],
          description: "Minimum severity to report"
        }
      }
    }
  }
};

/**
 * Migration Tool - Migrate code patterns or dependencies
 */
export const migrationTool: Tool = {
  type: "function",
  displayTitle: "Migrate Code",
  wouldLikeTo: "migrate: {{{ description }}}",
  isCurrently: "migrating code",
  hasAlready: "migrated code",
  readonly: false,
  group: "Composite",
  function: {
    name: "composite_migrate",
    description: `Regex-based pattern migration across files:
1. Search for fromPattern matches
2. Optional .bak backups
3. Replace with toPattern (unless dryRun)
4. Show diff + summary report

Best for simple string/API renames — not semantic refactors.`,
    parameters: {
      type: "object",
      required: ["migrationType"],
      properties: {
        migrationType: {
          type: "string",
          enum: [
            "callback-to-async",
            "api-version",
            "dependency-upgrade",
            "to-typescript",
            "pattern-change",
            "custom"
          ],
          description: "Type of migration"
        },
        description: {
          type: "string",
          description: "Detailed description of migration"
        },
        fromPattern: {
          type: "string",
          description: "Pattern to migrate from"
        },
        toPattern: {
          type: "string",
          description: "Pattern to migrate to"
        },
        targetFiles: {
          type: "array",
          items: { type: "string" },
          description: "Files to migrate (or glob pattern)"
        },
        dryRun: {
          type: "boolean",
          description: "Preview changes without applying"
        },
        createBackup: {
          type: "boolean",
          description: "Create backup of affected files"
        }
      }
    }
  }
};

/**
 * Project Health Check Tool
 */
export const projectHealthTool: Tool = {
  type: "function",
  displayTitle: "Project Health Check",
  wouldLikeTo: "check project health",
  isCurrently: "checking project health",
  hasAlready: "checked project health",
  readonly: true,
  group: "Composite",
  function: {
    name: "composite_health_check",
    description: `Workspace fact check (not a scored audit):
Looks at the repo root for README, manifest/lockfiles, test files, CI, and lint config.
Does not run tests, compute coverage, or invent quality scores.`,
    parameters: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "code-quality",
              "dependencies",
              "tests",
              "documentation",
              "security",
              "performance",
              "tech-debt"
            ]
          },
          description: "Specific checks to run (all if not specified)"
        },
        reportFormat: {
          type: "string",
          enum: ["summary", "detailed", "json"],
          description: "Format of the health report"
        },
        compareWith: {
          type: "string",
          description: "Compare with previous report or baseline"
        }
      }
    }
  }
};

/**
 * Learning Assistant Tool - Help understand codebases
 */
export const learningAssistantTool: Tool = {
  type: "function",
  displayTitle: "Learn Codebase",
  wouldLikeTo: "help understand the codebase",
  isCurrently: "analyzing codebase for learning",
  hasAlready: "prepared learning materials",
  readonly: true,
  group: "Composite",
  function: {
    name: "composite_learn_codebase",
    description: `Generate learning materials for a codebase:
1. Create architecture overview
2. Map key components and their relationships
3. Identify entry points
4. Document important patterns used
5. Generate learning path
6. Create guided tour of important files

Perfect for onboarding or understanding new projects.`,
    parameters: {
      type: "object",
      properties: {
        focusArea: {
          type: "string",
          description: "Specific area to focus on (e.g., 'authentication', 'API')"
        },
        depth: {
          type: "string",
          enum: ["overview", "detailed", "deep-dive"],
          description: "How detailed the learning materials should be"
        },
        outputFormat: {
          type: "string",
          enum: ["markdown", "interactive", "diagrams"],
          description: "Format for learning materials"
        },
        includeExercises: {
          type: "boolean",
          description: "Include practice exercises"
        }
      }
    }
  }
};

// Export all composite tools
export const compositeTools = [
  smartFileEditorTool,
  featureImplementationTool,
  bugInvestigationTool,
  codeReviewTool,
  migrationTool,
  projectHealthTool,
  learningAssistantTool
];
