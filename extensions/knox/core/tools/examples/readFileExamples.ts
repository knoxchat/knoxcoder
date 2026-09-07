/**
 * Enhanced Read File Tool - Usage Examples
 * 
 * This file demonstrates various use cases and capabilities of the enhanced Read File tool.
 * These examples show how AI models and users can leverage the new features.
 */

/**
 * EXAMPLE 1: Basic File Read
 * Use Case: Read entire file content
 */
export const example1_BasicRead = {
  description: "Read complete file without any options",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/components/Button.tsx"
    }
  },
  expectedBehavior: "Returns full file content with basic context"
};

/**
 * EXAMPLE 2: Read with Line Range
 * Use Case: Review specific function or code section
 */
export const example2_LineRange = {
  description: "Read lines 50-100 to inspect specific function",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/utils/helpers.ts",
      startLine: 50,
      endLine: 100
    }
  },
  expectedBehavior: "Returns only lines 50-100, saves tokens and focuses attention"
};

/**
 * EXAMPLE 3: Read with Line Numbers
 * Use Case: Discuss or reference specific lines in code review
 */
export const example3_WithLineNumbers = {
  description: "Read file with line numbers for precise referencing",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/api/auth.ts",
      includeLineNumbers: true
    }
  },
  expectedBehavior: "Each line prefixed with line number for easy citation"
};

/**
 * EXAMPLE 4: Read with Full Metadata
 * Use Case: Understand file context and statistics
 */
export const example4_WithMetadata = {
  description: "Read file with comprehensive metadata",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "package.json",
      includeMetadata: true,
      showSyntaxInfo: true
    }
  },
  expectedBehavior: "Returns file content plus size, line count, language, last modified date"
};

/**
 * EXAMPLE 5: Read Partial File from Start
 * Use Case: Preview beginning of a large file
 */
export const example5_FromStart = {
  description: "Read first 30 lines of file",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "logs/application.log",
      startLine: 1,
      endLine: 30,
      includeLineNumbers: true
    }
  },
  expectedBehavior: "Returns first 30 lines with line numbers"
};

/**
 * EXAMPLE 6: Read Partial File to End
 * Use Case: Check recent additions or end of file
 */
export const example6_ToEnd = {
  description: "Read from line 100 to end",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/app.ts",
      startLine: 100
    }
  },
  expectedBehavior: "Returns content from line 100 to end of file"
};

/**
 * EXAMPLE 7: Large File with Byte Limit
 * Use Case: Safely preview large files without memory issues
 */
export const example7_ByteLimit = {
  description: "Read large file with byte limit",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "dist/bundle.js",
      maxBytes: 50000,
      includeMetadata: true
    }
  },
  expectedBehavior: "Returns first 50KB with truncation notice"
};

/**
 * EXAMPLE 8: Complete Code Review Setup
 * Use Case: Perfect setup for reviewing a function
 */
export const example8_CodeReview = {
  description: "Full code review with all helpful features",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/services/PaymentService.ts",
      startLine: 45,
      endLine: 120,
      includeLineNumbers: true,
      includeMetadata: true,
      showSyntaxInfo: true
    }
  },
  expectedBehavior: "Returns lines 45-120 with numbers, metadata, and language info"
};

/**
 * EXAMPLE 9: Configuration File Inspection
 * Use Case: Quickly understand a config file
 */
export const example9_ConfigInspection = {
  description: "Inspect config file with metadata",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "tsconfig.json",
      includeMetadata: true,
      showSyntaxInfo: true
    }
  },
  expectedBehavior: "Returns config with file stats and JSON language detection"
};

/**
 * EXAMPLE 10: README Preview
 * Use Case: Get overview of documentation
 */
export const example10_ReadmePreview = {
  description: "Read first section of README",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "README.md",
      startLine: 1,
      endLine: 50,
      showSyntaxInfo: true
    }
  },
  expectedBehavior: "Returns first 50 lines with markdown syntax indication"
};

/**
 * EXAMPLE 11: Targeted Bug Investigation
 * Use Case: Investigate specific error location
 */
export const example11_BugInvestigation = {
  description: "Examine error-prone section with context",
  toolCall: {
    name: "builtin_read_file",
    arguments: {
      filepath: "src/database/migrations/001_initial.ts",
      startLine: 35,
      endLine: 55,
      includeLineNumbers: true,
      showSyntaxInfo: true
    }
  },
  expectedBehavior: "Returns 20 lines around the bug with line numbers for discussion"
};

/**
 * EXAMPLE 12: Multi-step Analysis
 * Use Case: Progressive file reading for large files
 */
export const example12_ProgressiveRead = {
  description: "Read file in chunks for analysis",
  steps: [
    {
      step: 1,
      description: "Get file overview",
      arguments: {
        filepath: "src/components/ComplexComponent.tsx",
        includeMetadata: true,
        maxBytes: 10000
      }
    },
    {
      step: 2,
      description: "Read specific function after overview",
      arguments: {
        filepath: "src/components/ComplexComponent.tsx",
        startLine: 100,
        endLine: 150,
        includeLineNumbers: true
      }
    }
  ],
  expectedBehavior: "First call provides overview, second targets specific area"
};

/**
 * ERROR HANDLING EXAMPLES
 */
export const errorExamples = {
  
  fileNotFound: {
    description: "Attempt to read non-existent file",
    toolCall: {
      filepath: "src/nonexistent.ts"
    },
    expectedError: "File \"src/nonexistent.ts\" does not exist. Please verify the file path and try again."
  },
  
  invalidLineRange: {
    description: "Invalid line range (start > end)",
    toolCall: {
      filepath: "src/app.ts",
      startLine: 100,
      endLine: 50
    },
    expectedError: "startLine cannot be greater than endLine"
  },
  
  negativeLineNumber: {
    description: "Negative line number",
    toolCall: {
      filepath: "src/app.ts",
      startLine: -5
    },
    expectedError: "startLine must be >= 1"
  },
  
  emptyFilepath: {
    description: "Empty filepath",
    toolCall: {
      filepath: "   "
    },
    expectedError: "Filepath cannot be empty"
  }
};

/**
 * PERFORMANCE COMPARISON
 * 
 * Scenario: Large 10MB file with 50,000 lines
 */
export const performanceComparison = {
  
  before: {
    description: "Old implementation - always reads entire file",
    method: "Read entire file",
    memoryUsage: "~10 MB",
    tokensUsed: "~300,000 tokens",
    processingTime: "~5 seconds"
  },
  
  after_rangeRead: {
    description: "New implementation - read lines 1000-1100",
    method: "Read with line range",
    arguments: {
      filepath: "large-file.log",
      startLine: 1000,
      endLine: 1100
    },
    memoryUsage: "~20 KB (99.8% reduction)",
    tokensUsed: "~600 tokens (99.8% reduction)",
    processingTime: "~50 ms (99% reduction)"
  },
  
  after_byteLimit: {
    description: "New implementation - preview with byte limit",
    method: "Read with maxBytes",
    arguments: {
      filepath: "large-file.log",
      maxBytes: 100000
    },
    memoryUsage: "~100 KB (99% reduction)",
    tokensUsed: "~6,000 tokens (98% reduction)",
    processingTime: "~100 ms (98% reduction)"
  }
};

/**
 * RECOMMENDED PATTERNS FOR AI MODELS
 */
export const aiRecommendedPatterns = {
  
  pattern1_InitialInspection: {
    name: "Initial File Inspection",
    description: "When encountering a new file, get overview first",
    approach: [
      {
        action: "Read with metadata",
        arguments: {
          filepath: "unknown-file.ts",
          includeMetadata: true,
          showSyntaxInfo: true,
          maxBytes: 50000
        }
      }
    ],
    benefit: "Understand file size, language, and general structure before deep dive"
  },
  
  pattern2_TargetedAnalysis: {
    name: "Targeted Code Analysis",
    description: "When user mentions specific line or function",
    approach: [
      {
        action: "Read with line range and numbers",
        arguments: {
          filepath: "src/module.ts",
          startLine: 45,
          endLine: 80,
          includeLineNumbers: true
        }
      }
    ],
    benefit: "Focus on relevant code, save tokens, provide precise line references"
  },
  
  pattern3_ProgressiveDiscovery: {
    name: "Progressive File Discovery",
    description: "For very large files, use multiple focused reads",
    approach: [
      {
        step: 1,
        action: "Get metadata",
        arguments: { filepath: "large.ts", includeMetadata: true, maxBytes: 1000 }
      },
      {
        step: 2,
        action: "Read table of contents (top)",
        arguments: { filepath: "large.ts", startLine: 1, endLine: 50 }
      },
      {
        step: 3,
        action: "Read specific sections as needed",
        arguments: { filepath: "large.ts", startLine: 500, endLine: 600 }
      }
    ],
    benefit: "Efficient token usage, better context management"
  },
  
  pattern4_CodeReview: {
    name: "Code Review Assistant",
    description: "Optimal setup for reviewing code changes",
    approach: [
      {
        action: "Read with full context",
        arguments: {
          filepath: "src/changed-file.ts",
          includeLineNumbers: true,
          includeMetadata: true,
          showSyntaxInfo: true
        }
      }
    ],
    benefit: "All information needed for comprehensive review"
  }
};

/**
 * INTEGRATION WITH OTHER TOOLS
 */
export const toolIntegrationExamples = {
  
  withGrep: {
    description: "First grep for pattern, then read found locations",
    workflow: [
      { tool: "builtin_exact_search", query: "TODO" },
      { tool: "builtin_read_file", arguments: { filepath: "result.ts", startLine: 45, endLine: 55 } }
    ]
  },
  
  withEditTool: {
    description: "Read before edit to understand context",
    workflow: [
      { 
        tool: "builtin_read_file", 
        arguments: { 
          filepath: "src/component.tsx", 
          startLine: 20, 
          endLine: 40,
          includeLineNumbers: true 
        } 
      },
      { tool: "composite_smart_edit", targetLines: "25-30" }
    ]
  },
  
  withDiffView: {
    description: "Read current state, then view diff",
    workflow: [
      { tool: "read_file", arguments: { filepath: "src/file.ts", includeMetadata: true } },
      { tool: "view_diff" }
    ]
  }
};

/**
 * SUMMARY OF CAPABILITIES
 */
export const capabilitiesSummary = {
  title: "Enhanced Read File Tool - Complete Capabilities",
  
  features: [
    "✅ Full file reading",
    "✅ Partial file reading via line ranges",
    "✅ Line numbering for reference",
    "✅ Comprehensive metadata extraction",
    "✅ Language/syntax detection",
    "✅ Smart content truncation",
    "✅ Byte limit protection",
    "✅ Human-readable size formatting",
    "✅ File existence validation",
    "✅ Detailed error messages",
    "✅ Encoding support",
    "✅ Last modified timestamps"
  ],
  
  parameters: {
    required: ["filepath"],
    optional: [
      "startLine",
      "endLine",
      "includeMetadata",
      "includeLineNumbers",
      "encoding",
      "maxBytes",
      "showSyntaxInfo"
    ]
  },
  
  benefits: {
    forAI: [
      "Precise context control",
      "Token efficiency",
      "Better understanding via metadata",
      "Easy line referencing"
    ],
    forUsers: [
      "Faster responses",
      "Lower costs",
      "More accurate results",
      "Clear file insights"
    ],
    forDevelopers: [
      "Flexible API",
      "Safe operations",
      "Production-ready",
      "Easy to extend"
    ]
  }
};
