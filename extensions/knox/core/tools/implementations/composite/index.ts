/**
 * Composite Tool Implementations
 *
 * Hand-rolled multi-step helpers (read → search → write). Not on the default
 * chat tool list; exposed via `allAvailableTools` and routed from `callTool`.
 * Do not claim ToolPipeline / SmartToolRouter integration — those are unused here.
 */

import { ContextItem, ToolExtras } from "../../..";
import { ToolImpl } from "../index.js";
import { ToolCache } from "../../orchestration/ToolCache.js";
import { ConditionBuilder, evaluateCondition } from "../../orchestration/ToolConditions.js";
import { CacheConfig, PipelineContext } from "../../orchestration/types.js";
import { readFileImpl } from "../readFile.js";
import { createNewFileImpl } from "../createNewFile.js";
import { exactSearchImpl } from "../exactSearch.js";
import { viewDiffImpl } from "../viewDiff.js";
import { viewRepoMapImpl } from "../viewRepoMap.js";
import { viewSubdirectoryImpl } from "../viewSubdirectory.js";
import { searchWebImpl } from "../searchWeb.js";

const toolCache = ToolCache.getInstance();

const SYSTEMS_SOURCE = /\.(c|h|cc|cpp|cxx|hpp|hh|S|s|lds|ld)$/i;
const SYSTEMS_BASENAME = /^(Makefile|Kconfig|Kbuild)/i;

/** JS import/export/class heuristics are wrong on kernel C (HL-39). */
export function shouldUseJsHeuristics(filepath: string): boolean {
  const base = filepath.split(/[\\/]/).pop() ?? filepath;
  if (SYSTEMS_BASENAME.test(base)) {
    return false;
  }
  return !SYSTEMS_SOURCE.test(base);
}

export function analyzeCompositeSource(filepath: string, content: string) {
  const lines = content.split("\n");
  if (!shouldUseJsHeuristics(filepath)) {
    return {
      totalLines: lines.length,
      skippedJsHeuristics: true,
      note: "C/asm/Kconfig — JS import/export/class heuristics skipped",
    };
  }
  return {
    totalLines: lines.length,
    hasImports: content.includes("import ") || content.includes("require("),
    hasExports: content.includes("export ") || content.includes("module.exports"),
    hasClasses: content.includes("class "),
    hasFunctions: /function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|=>\s*{/.test(
      content,
    ),
    skippedJsHeuristics: false,
  };
}

/**
 * Smart File Editor Implementation
 * Orchestrates: read → modify → optional validate (backup/rollback on validate fail)
 */
export const smartEditImpl: ToolImpl = async (args, extras) => {
  const { filepath, modification, validate = false, format = false, backup = true } = args;
  const results: ContextItem[] = [];
  
  // Create backup if requested
  let originalContent: string | null = null;
  if (backup) {
    try {
      originalContent = await extras.ide.readFile(filepath);
      results.push({
        name: "Backup Created",
        description: "Original content saved for rollback",
        content: `Backup saved (${originalContent.length} characters)`
      });
    } catch (e) {
      // File doesn't exist yet, that's ok
    }
  }
  
  // Step 1: Read the current file
  const readResult = await extras.ide.readFile(filepath);
  results.push({
    name: "Original Content",
    description: `Read ${filepath}`,
    content: `File read successfully. Length: ${readResult.length} characters.`
  });
  
  const analysis = analyzeCompositeSource(filepath, readResult);
  
  results.push({
    name: "Code Analysis",
    description: "Structure analysis",
    content: JSON.stringify(analysis, null, 2)
  });
  
  // Step 3: Apply modification based on type
  let modifiedContent = readResult;
  const modType = modification?.type || 'insert';
  
  switch (modType) {
    case 'insert':
      if (modification?.target && modification?.content) {
        const insertIndex = modifiedContent.indexOf(modification.target);
        if (insertIndex !== -1) {
          modifiedContent = modifiedContent.slice(0, insertIndex) + 
            modification.content + 
            modifiedContent.slice(insertIndex);
        }
      }
      break;
      
    case 'replace':
      if (modification?.target && modification?.content !== undefined) {
        modifiedContent = modifiedContent.replace(
          new RegExp(modification.target, 'g'),
          modification.content
        );
      }
      break;
      
    case 'delete':
      if (modification?.target) {
        modifiedContent = modifiedContent.replace(
          new RegExp(modification.target, 'g'),
          ''
        );
      }
      break;
  }
  
  // Step 4: Validate if requested (using ConditionBuilder for complex validation)
  if (validate && modifiedContent !== readResult) {
    // Use ConditionBuilder.if() with static factory method
    const validationCondition = ConditionBuilder.if((ctx: PipelineContext) => {
      // Validate syntax based on file extension
      const ext = filepath.split('.').pop()?.toLowerCase();
      const contentToCheck = ctx.variables.get('content') || modifiedContent;
      
      if (ext === 'json') {
        try {
          JSON.parse(contentToCheck);
          return true;
        } catch {
          return false;
        }
      }
      // Basic bracket matching for code files
      if (['ts', 'js', 'tsx', 'jsx'].includes(ext || '')) {
        const opens = (contentToCheck.match(/\{/g) || []).length;
        const closes = (contentToCheck.match(/\}/g) || []).length;
        return opens === closes;
      }
      return true;
    }).build();
    
    // Create proper PipelineContext
    const validationContext: PipelineContext = { 
      pipelineId: `validate_${filepath}`,
      results: new Map(), 
      variables: new Map([['content', modifiedContent]]),
      startTime: Date.now(),
      currentStep: 0,
      totalSteps: 1,
      abortController: new AbortController(),
      extras: extras,
      metadata: {}
    };
    
    const isValid = evaluateCondition(validationCondition, validationContext);
    
    if (!isValid) {
      // Rollback to original if validation fails
      if (backup && originalContent !== null) {
        results.push({
          name: "Validation Failed",
          description: "Rolling back changes",
          content: "Content validation failed. Restoring original content."
        });
        modifiedContent = originalContent;
      } else {
        results.push({
          name: "Validation Warning",
          description: "Validation issues detected",
          content: "Content may have syntax issues but no backup available for rollback."
        });
      }
    } else {
      results.push({
        name: "Validation Passed",
        description: "Content validation successful",
        content: "✅ All validation checks passed"
      });
    }
  }
  
  // Step 5: Format if requested
  if (format && modifiedContent !== readResult) {
    modifiedContent = formatCode(modifiedContent, filepath);
    results.push({
      name: "Formatting Applied",
      description: "Code formatted",
      content: "Applied standard formatting to the content"
    });
  }
  
  // Step 6: Write if not dry run
  if (modification?.dryRun) {
    results.push({
      name: "Preview",
      description: "Modified content preview",
      content: modifiedContent
    });
  } else {
    await extras.ide.writeFile(filepath, modifiedContent);
    results.push({
      name: "Modification Complete",
      description: `Updated ${filepath}`,
      content: `File modified successfully. New length: ${modifiedContent.length} characters.`
    });
  }
  
  return results;
};

/**
 * Bug Investigation Implementation
 * Orchestrates: search → analyze → git_history → compile_report
 */
export const bugInvestigationImpl: ToolImpl = async (args, extras) => {
  const { bugDescription, errorStack, affectedFiles, includeWebSearch } = args;
  const results: ContextItem[] = [];
  
  // Step 1: Search for related code
  const searchTerms = extractSearchTerms(bugDescription, errorStack);
  const searchResults = await extras.ide.getSearchResults(searchTerms.join(' OR '));
  
  results.push({
    name: "Code Search Results",
    description: "Related code locations",
    content: searchResults || "No direct matches found"
  });
  
  // Step 2: Get git diff to see recent changes
  const diff = await extras.ide.getDiff(true);
  if (diff && diff.length > 0) {
    results.push({
      name: "Recent Changes",
      description: "Uncommitted changes that might be related",
      content: diff.join('\n\n')
    });
  }
  
  // Step 3: Analyze affected files if provided
  if (affectedFiles && affectedFiles.length > 0) {
    for (const file of affectedFiles) {
      try {
        const content = await extras.ide.readFile(file);
        const analysis = analyzeForBug(content, bugDescription);
        results.push({
          name: `Analysis: ${file}`,
          description: "Potential bug locations",
          content: analysis
        });
      } catch (e) {
        results.push({
          name: `Analysis: ${file}`,
          description: "Could not analyze",
          content: `Error reading file: ${(e as Error).message}`
        });
      }
    }
  }
  
  // Step 4: Web search for similar issues (using searchWebImpl)
  if (includeWebSearch) {
    try {
      // Build search query from bug description and error
      const searchQuery = buildWebSearchQuery(bugDescription, errorStack);
      const webResults = await searchWebImpl({ query: searchQuery }, extras);
      
      if (webResults && webResults.length > 0) {
        results.push({
          name: "Web Search Results",
          description: "Similar issues found online",
          content: webResults.map(r => `### ${r.name}\n${r.content}`).join('\n\n')
        });
      }
    } catch (e) {
      results.push({
        name: "Web Search",
        description: "Search failed",
        content: `Could not perform web search: ${(e as Error).message}`
      });
    }
  }
  
  // Step 5: Compile investigation report
  const report = compileBugReport(bugDescription, errorStack, results, includeWebSearch);
  results.push({
    name: "Investigation Report",
    description: "Summary of bug investigation",
    content: report
  });
  
  return results;
};

/**
 * Code Review Implementation
 * Orchestrates: view_diff → analyze → security_check → generate_report
 */
export const codeReviewImpl: ToolImpl = async (args, extras) => {
  const { scope = 'staged', checkCategories = ['quality', 'security', 'style'] } = args;
  const results: ContextItem[] = [];
  
  // Step 1: Get diff
  const includeUnstaged = scope === 'unstaged' || scope === 'all';
  const diff = await extras.ide.getDiff(includeUnstaged);
  
  if (!diff || diff.length === 0) {
    return [{
      name: "No Changes",
      description: "No code changes to review",
      content: "No changes found in the specified scope."
    }];
  }
  
  results.push({
    name: "Changes to Review",
    description: `${diff.length} file(s) changed`,
    content: diff.join('\n---\n').substring(0, 5000) // Limit output
  });
  
  // Step 2: Perform checks based on categories
  const reviewFindings: string[] = [];
  
  for (const category of checkCategories) {
    const findings = performReviewCheck(diff.join('\n'), category);
    if (findings.length > 0) {
      reviewFindings.push(`## ${category.toUpperCase()} FINDINGS\n${findings.join('\n')}`);
    }
  }
  
  // Step 3: Generate review report
  const report = `# Code Review Report

**Scope:** ${scope}
**Files Reviewed:** ${diff.length}
**Categories:** ${checkCategories.join(', ')}

${reviewFindings.length > 0 ? reviewFindings.join('\n\n') : '✅ No issues found!'}

---
*Review generated at ${new Date().toISOString()}*
`;
  
  results.push({
    name: "Review Report",
    description: "Complete code review report",
    content: report
  });
  
  return results;
};

/**
 * Project Health Check Implementation — workspace facts only (no invented scores).
 */
export const projectHealthImpl: ToolImpl = async (args, extras) => {
  const { checks = ['code-quality', 'dependencies', 'documentation', 'tests'] } = args;
  const results: ContextItem[] = [];
  const workspaceDirs = await extras.ide.getWorkspaceDirs();

  for (const check of checks) {
    try {
      const details = await collectHealthFacts(check, extras, workspaceDirs);
      results.push({
        name: `Health: ${check}`,
        description: "Workspace facts",
        content: details,
      });
    } catch (e) {
      results.push({
        name: `Health: ${check}`,
        description: "Check failed",
        content: `Error: ${(e as Error).message}`,
      });
    }
  }

  results.push({
    name: "Health Summary",
    description: "Fact list — not a scored audit",
    content:
      "These checks only report files found at the workspace root. " +
      "They do not run tests, compute coverage, or assign quality scores.",
  });

  return results;
};

/**
 * Learning Assistant Implementation
 */
export const learnCodebaseImpl: ToolImpl = async (args, extras) => {
  const { focusArea, depth = 'overview' } = args;
  const results: ContextItem[] = [];
  
  // Get workspace structure
  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  
  if (workspaceDirs.length === 0) {
    return [{
      name: "No Workspace",
      description: "Cannot analyze",
      content: "No workspace folders found."
    }];
  }
  
  const rootDir = workspaceDirs[0];
  
  // Get directory listing
  const dirContents = await extras.ide.listDir(rootDir);
  
  // Analyze project type
  const projectType = detectProjectType(dirContents);
  
  results.push({
    name: "Project Overview",
    description: "Basic project information",
    content: `## Project Type: ${projectType.type}
    
**Languages:** ${projectType.languages.join(', ')}
**Frameworks:** ${projectType.frameworks.join(', ') || 'None detected'}
**Build Tools:** ${projectType.buildTools.join(', ') || 'None detected'}

### Directory Structure:
${formatDirectoryListing(dirContents)}`
  });
  
  // Find entry points
  const entryPoints = findEntryPoints(dirContents, projectType);
  results.push({
    name: "Entry Points",
    description: "Key starting files",
    content: `## Recommended Starting Points

${entryPoints.map(ep => `- **${ep.file}**: ${ep.description}`).join('\n')}`
  });
  
  // Generate learning path
  const learningPath = generateLearningPath(projectType, depth, focusArea);
  results.push({
    name: "Learning Path",
    description: "Suggested order to explore",
    content: learningPath
  });
  
  return results;
};

/**
 * Feature Implementation — plan + file scaffold for a new feature.
 * Creates structural stubs with NotImplemented placeholders (not a finished feature).
 */
export const featureImplementationImpl: ToolImpl = async (args, extras) => {
  const { featureName, description, targetDirectory, includeTests = true, generateDocs = true } = args;
  const results: ContextItem[] = [];
  
  // Use caching for repeated lookups with proper CacheConfig
  const cacheConfig: CacheConfig = { 
    enabled: true, 
    ttlMs: 300000,  // 5 minutes
    keyGenerator: (args) => `feature_analysis_${args.dir}` 
  };
  const cachedAnalysis = toolCache.get('feature_analysis', { dir: targetDirectory }, cacheConfig);
  
  // Step 1: Analyze existing codebase structure using viewSubdirectoryImpl
  let dirAnalysis: ContextItem[];
  if (cachedAnalysis) {
    results.push({
      name: "Cache Hit",
      description: "Using cached directory analysis",
      content: "Directory structure loaded from cache"
    });
    dirAnalysis = cachedAnalysis.output as ContextItem[];
  } else {
    dirAnalysis = await viewSubdirectoryImpl({ directory_path: targetDirectory || '.' }, extras);
    results.push(...dirAnalysis);
  }
  
  // Step 2: Detect patterns and conventions using exactSearchImpl
  const conventionPatterns = await detectCodeConventions(extras);
  results.push({
    name: "Code Conventions",
    description: "Detected patterns in codebase",
    content: JSON.stringify(conventionPatterns, null, 2)
  });
  
  // Step 3: Generate feature scaffold plan
  const scaffoldPlan = generateScaffoldPlan(featureName, description, conventionPatterns, targetDirectory);
  results.push({
    name: "Scaffold Plan",
    description: `Files to create for ${featureName}`,
    content: scaffoldPlan.map(f => `📄 ${f.path}: ${f.description}`).join('\n')
  });
  
  // Step 4: Create scaffold files (placeholders throw until filled in)
  results.push({
    name: "Scaffold notice",
    description: "Files are structural scaffolds, not a finished feature",
    content:
      "Generated files include intentional NotImplemented placeholders in execute(). " +
      "Replace them with real logic before shipping.",
  });
  for (const fileSpec of scaffoldPlan) {
    try {
      await createNewFileImpl({ filepath: fileSpec.path, contents: fileSpec.content }, extras);
      results.push({
        name: `Scaffolded: ${fileSpec.path}`,
        description: fileSpec.description,
        content:
          `Wrote structural scaffold at ${fileSpec.path} with a NotImplemented ` +
          `execute() stub — not a finished feature.`,
      });
    } catch (e) {
      results.push({
        name: `Failed: ${fileSpec.path}`,
        description: "Could not create file",
        content: `Error: ${(e as Error).message}`,
      });
    }
  }
  
  // Step 5: Generate tests if requested
  if (includeTests) {
    const testFiles = generateTestScaffold(featureName, scaffoldPlan, conventionPatterns);
    for (const testFile of testFiles) {
      try {
        await createNewFileImpl({ filepath: testFile.path, contents: testFile.content }, extras);
        results.push({
          name: `Test scaffold: ${testFile.path}`,
          description: "Stub test file only — not a passing suite",
          content:
            `Wrote test scaffold at ${testFile.path}. ` +
            `It is a structural stub; implement assertions before treating the feature as done.`,
        });
      } catch (e) {
        results.push({
          name: `Test scaffold failed: ${testFile.path}`,
          description: "Could not create test scaffold",
          content: `Error: ${(e as Error).message}`,
        });
      }
    }
  }
  
  // Step 6: Generate documentation if requested
  if (generateDocs) {
    const docContent = generateFeatureDocumentation(featureName, description, scaffoldPlan);
    results.push({
      name: "Documentation",
      description: `Documentation for ${featureName}`,
      content: docContent
    });
  }
  
  return results;
};

/**
 * Migration Implementation - Automated codebase migrations
 * Uses pipelines for: scan → plan → execute → validate → report
 */
export const migrationImpl: ToolImpl = async (args, extras) => {
  const { migrationType, fromPattern, toPattern, targetPaths = ['.'], dryRun = true, createBackup = true } = args;
  const results: ContextItem[] = [];
  const changes: MigrationChange[] = [];
  
  // Step 1: Scan for migration targets using exactSearchImpl
  results.push({
    name: "Migration Started",
    description: `Type: ${migrationType}`,
    content: `Scanning for: ${fromPattern} → ${toPattern}\nTarget paths: ${targetPaths.join(', ')}\nDry run: ${dryRun}`
  });
  
  for (const targetPath of targetPaths) {
    try {
      const searchResults = await exactSearchImpl({ query: fromPattern, fileGlob: `${targetPath}/**` }, extras);
      
      for (const result of searchResults) {
        changes.push({
          file: result.name,
          lineNumber: extractLineNumber(result.content),
          before: extractSnippet(result.content, fromPattern),
          after: result.content.replace(new RegExp(fromPattern, 'g'), toPattern),
          status: 'pending'
        });
      }
    } catch (e) {
      results.push({
        name: `Scan Error: ${targetPath}`,
        description: "Could not scan path",
        content: `Error: ${(e as Error).message}`
      });
    }
  }
  
  results.push({
    name: "Scan Complete",
    description: `Found ${changes.length} locations`,
    content: changes.map(c => `${c.file}:${c.lineNumber}`).join('\n')
  });
  
  // Step 2: Create backups if requested (not in dry run)
  if (createBackup && !dryRun) {
    const uniqueFiles = [...new Set(changes.map(c => c.file))];
    for (const file of uniqueFiles) {
      try {
        const content = await extras.ide.readFile(file);
        const backupPath = `${file}.bak.${Date.now()}`;
        await extras.ide.writeFile(backupPath, content);
        results.push({
          name: `Backup: ${file}`,
          description: "Backup created",
          content: `Saved to: ${backupPath}`
        });
      } catch (e) {
        // File might not exist yet, skip backup
      }
    }
  }
  
  // Step 3: Apply migrations (regex replace; backups created above when requested)
  if (!dryRun) {
    for (const change of changes) {
      try {
        const fileContent = await extras.ide.readFile(change.file);
        const updatedContent = fileContent.replace(new RegExp(fromPattern, 'g'), toPattern);
        await extras.ide.writeFile(change.file, updatedContent);
        change.status = 'applied';
      } catch (e) {
        change.status = 'failed';
        change.error = (e as Error).message;
      }
    }
  }
  
  // Step 4: Validate migrations using viewDiffImpl
  if (!dryRun) {
    const diffResults = await viewDiffImpl({ includeUnstaged: true }, extras);
    results.push({
      name: "Migration Diff",
      description: "Changes applied",
      content: diffResults.map(d => d.content).join('\n---\n')
    });
  }
  
  // Step 5: Generate migration report
  const report = generateMigrationReport(migrationType, fromPattern, toPattern, changes, dryRun);
  results.push({
    name: "Migration Report",
    description: dryRun ? "Dry run summary" : "Migration summary",
    content: report
  });
  
  return results;
};

// Helper types for migration
interface MigrationChange {
  file: string;
  lineNumber: number;
  before: string;
  after: string;
  status: 'pending' | 'applied' | 'failed';
  error?: string;
}

// Helper functions

function extractSearchTerms(description: string, errorStack?: string): string[] {
  const terms: string[] = [];
  
  // Extract potential identifiers from description
  const identifierRegex = /\b[A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g;
  const matches = description.match(identifierRegex);
  if (matches) {
    terms.push(...matches);
  }
  
  // Extract from error stack
  if (errorStack) {
    const fileMatches = errorStack.match(/at\s+[\w.]+\s+\(([^)]+)\)/g);
    if (fileMatches) {
      terms.push(...fileMatches.map(m => m.split('(')[0].replace('at ', '').trim()));
    }
  }
  
  return [...new Set(terms)].slice(0, 5);
}

function analyzeForBug(content: string, bugDescription: string): string {
  const lines = content.split('\n');
  const findings: string[] = [];
  
  // Look for common bug patterns
  const patterns = [
    { regex: /throw\s+new\s+Error/g, name: 'Error throwing' },
    { regex: /catch\s*\([^)]*\)\s*{\s*}/g, name: 'Empty catch block' },
    { regex: /console\.(log|error|warn)/g, name: 'Console output' },
    { regex: /TODO|FIXME|HACK|BUG/g, name: 'Code comments' },
    { regex: /==\s*null|null\s*==/g, name: 'Null comparison' }
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      findings.push(`Line ${lineNum}: ${pattern.name} - "${match[0]}"`);
    }
  }
  
  return findings.length > 0 
    ? findings.join('\n') 
    : 'No obvious issues found in this file.';
}

function compileBugReport(description: string, errorStack?: string, findings?: ContextItem[], includedWebSearch?: boolean): string {
  return `# Bug Investigation Report

## Description
${description}

${errorStack ? `## Error Stack\n\`\`\`\n${errorStack}\n\`\`\`\n` : ''}

## Investigation Summary
- ${findings?.length || 0} areas analyzed
${includedWebSearch ? '- Web search results included' : ''}
- See individual analysis sections above for details

## Potential Causes
Based on the analysis, the bug might be related to:
1. Recent code changes (check git diff)
2. Edge cases in input handling
3. Async/await or promise handling issues
4. State management inconsistencies

## Recommended Actions
1. Review recent changes to affected files
2. Add logging around suspected code paths
3. Write a failing test case that reproduces the bug
4. Check for similar issues in the codebase
${includedWebSearch ? '5. Review online solutions from similar issues' : ''}
`;
}

function performReviewCheck(diff: string, category: string): string[] {
  const findings: string[] = [];
  
  switch (category) {
    case 'quality':
      if (diff.includes('any')) findings.push('⚠️ Use of `any` type detected');
      if (diff.includes('console.log')) findings.push('⚠️ Console.log statement detected');
      if (/function\s+\w+\([^)]{100,}\)/.test(diff)) findings.push('⚠️ Function with many parameters');
      break;
      
    case 'security':
      if (diff.includes('eval(')) findings.push('🚨 Use of eval() detected');
      if (diff.includes('innerHTML')) findings.push('🚨 innerHTML usage (XSS risk)');
      if (/password|secret|api.?key/i.test(diff)) findings.push('⚠️ Potential hardcoded secret');
      break;
      
    case 'style':
      if (/\t/.test(diff)) findings.push('📝 Mixed tabs and spaces');
      if (/;\s*\n\s*\n/.test(diff)) findings.push('📝 Inconsistent line spacing');
      break;
      
    case 'performance':
      if (/\.forEach\(.*await/.test(diff)) findings.push('⚡ Sequential awaits in forEach');
      if (diff.includes('JSON.parse') && diff.includes('JSON.stringify')) {
        findings.push('⚡ Potential unnecessary JSON round-trip');
      }
      break;
  }
  
  return findings;
}

export function formatCargoHealthMessage(names: string[]): string {
  const rust = names.filter((n) =>
    /^(rustfmt\.toml|clippy\.toml|Cargo\.lock|rust-toolchain\.toml|rust-toolchain)$/i.test(
      n,
    ),
  );
  return rust.length
    ? `Found Cargo health files: ${rust.join(", ")}. Prefer rustfmt/clippy over eslint.`
    : "Cargo.toml present. No rustfmt.toml / clippy.toml / Cargo.lock / rust-toolchain.toml at the root. Do not run eslint on this crate.";
}

function listingNames(listing: Array<[string, number]>): string[] {
  return listing.map(([name]) => name.replace(/\/$/, ""));
}

function hasName(names: string[], pattern: RegExp): boolean {
  return names.some((name) => pattern.test(name));
}

async function collectHealthFacts(
  check: string,
  extras: ToolExtras,
  workspaceDirs: string[],
): Promise<string> {
  if (!workspaceDirs.length) {
    return "No workspace folder is open.";
  }
  const root = workspaceDirs[0];
  const listing = await extras.ide.listDir(root);
  const names = listingNames(listing);

  switch (check) {
    case "documentation":
      return hasName(names, /^readme(\.|$)/i)
        ? `Found a README at the workspace root (${names.filter((n) => /^readme/i.test(n)).join(", ")}).`
        : "No README found at the workspace root.";
    case "dependencies": {
      const manifests = names.filter((n) =>
        /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/i.test(
          n,
        ),
      );
      return manifests.length
        ? `Found dependency manifests: ${manifests.join(", ")}.`
        : "No package/lock manifest found at the workspace root.";
    }
    case "tests": {
      const testish = names.filter((n) =>
        /(^test$|^tests$|^spec$|\.test\.|\.spec\.)/i.test(n),
      );
      return testish.length
        ? `Found test-related names at the root: ${testish.join(", ")}. This is not coverage.`
        : "No test directory or *test*/*spec* file at the workspace root. Search the tree if needed.";
    }
    case "code-quality": {
      if (names.includes("Cargo.toml")) {
        return formatCargoHealthMessage(names);
      }
      const lint = names.filter((n) =>
        /(\.eslintrc|eslint\.config|prettier|\.prettierrc|biome\.json|ruff\.toml|pyproject\.toml)$/i.test(
          n,
        ),
      );
      return lint.length
        ? `Found lint/format config: ${lint.join(", ")}.`
        : "No eslint/prettier/biome/ruff config at the workspace root.";
    }
    case "security":
      return names.includes(".env")
        ? "`.env` is present at the workspace root — confirm it is gitignored."
        : "No `.env` file at the workspace root. This is not a security audit.";
    case "performance":
    case "tech-debt":
      return `No automated ${check} measurement. Inspect profiles, TODOs, or CI separately — do not treat this as a score.`;
    default:
      return `Unknown check: ${check}`;
  }
}

interface ProjectType {
  type: string;
  languages: string[];
  frameworks: string[];
  buildTools: string[];
}

export function detectProjectType(contents: [string, any][]): ProjectType {
  const files = contents.map(([name]) => name);
  
  const type: ProjectType = {
    type: 'Unknown',
    languages: [],
    frameworks: [],
    buildTools: []
  };
  
  // Detect by config files
  if (files.includes('package.json')) {
    type.type = 'Node.js';
    type.languages.push('JavaScript', 'TypeScript');
    type.buildTools.push('npm');
  }
  if (files.includes('tsconfig.json')) {
    type.languages = ['TypeScript'];
  }
  if (files.includes('Cargo.toml')) {
    type.type = 'Rust';
    type.languages.push('Rust');
    type.buildTools.push('Cargo');
  }
  if (files.includes('requirements.txt') || files.includes('setup.py')) {
    type.type = 'Python';
    type.languages.push('Python');
    type.buildTools.push('pip');
  }
  if (files.includes('go.mod')) {
    type.type = 'Go';
    type.languages.push('Go');
  }
  
  // Detect frameworks
  if (files.some(f => f.includes('react'))) type.frameworks.push('React');
  if (files.some(f => f.includes('vue'))) type.frameworks.push('Vue');
  if (files.some(f => f.includes('next'))) type.frameworks.push('Next.js');
  if (files.some(f => f.includes('angular'))) type.frameworks.push('Angular');
  
  return type;
}

function formatDirectoryListing(contents: [string, any][]): string {
  return contents
    .slice(0, 20)
    .map(([name, type]) => `${type === 2 ? '📁' : '📄'} ${name}`)
    .join('\n');
}

function findEntryPoints(contents: [string, any][], projectType: ProjectType): { file: string; description: string }[] {
  const entryPoints: { file: string; description: string }[] = [];
  const files = contents.map(([name]) => name);
  
  // Common entry points
  if (files.includes('src/')) {
    entryPoints.push({ file: 'src/', description: 'Main source directory' });
  }
  if (files.includes('index.ts') || files.includes('index.js')) {
    entryPoints.push({ file: 'index.*', description: 'Main entry point' });
  }
  if (files.includes('main.ts') || files.includes('main.js')) {
    entryPoints.push({ file: 'main.*', description: 'Application entry' });
  }
  if (files.includes('README.md')) {
    entryPoints.push({ file: 'README.md', description: 'Project documentation' });
  }
  if (files.includes('package.json')) {
    entryPoints.push({ file: 'package.json', description: 'Dependencies and scripts' });
  }
  if (projectType.type === "Rust" || files.includes("Cargo.toml")) {
    entryPoints.push({ file: "Cargo.toml", description: "Cargo manifest" });
    if (files.includes("src") || files.includes("src/")) {
      entryPoints.push({
        file: "src/lib.rs",
        description: "Library crate root (if present)",
      });
      entryPoints.push({
        file: "src/main.rs",
        description: "Binary crate root (if present)",
      });
    }
  }
  
  return entryPoints;
}

function generateLearningPath(projectType: ProjectType, depth: string, focusArea?: string): string {
  const steps: string[] = [];
  
  steps.push('## Suggested Learning Path\n');
  if (projectType.type === "Rust") {
    steps.push("1. **Start Here**: Read Cargo.toml + README.md");
    steps.push("2. **Entry Point**: src/lib.rs or src/main.rs");
    steps.push("3. **Oracle**: builtin_build (cargo check), not eslint");
    steps.push("4. **Tests**: `#[cfg(test)]` / tests/ and cargo test");
  } else {
    steps.push('1. **Start Here**: Read README.md for project overview');
    steps.push('2. **Configuration**: Review package.json/config files');
    steps.push('3. **Entry Point**: Find and understand the main entry file');
    steps.push('4. **Core Logic**: Explore the main source directory');
    steps.push('5. **Tests**: Review test files to understand expected behavior');
  }
  
  if (focusArea) {
    steps.push(`\n### Focus Area: ${focusArea}`);
    steps.push(`Search for files and functions related to "${focusArea}"`);
  }
  
  if (depth === 'detailed' || depth === 'deep-dive') {
    steps.push('\n### Advanced Topics');
    steps.push('- Understand the build process');
    steps.push('- Review CI/CD configuration');
    steps.push('- Explore error handling patterns');
    steps.push('- Study the testing strategy');
  }
  
  return steps.join('\n');
}

// ============================================
// New helper functions for advanced features
// ============================================

/**
 * Format code based on file extension
 */
function formatCode(content: string, filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'json':
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
      
    case 'ts':
    case 'js':
    case 'tsx':
    case 'jsx':
      // Basic formatting: normalize whitespace, ensure consistent newlines
      return content
        .replace(/\r\n/g, '\n')           // Normalize line endings
        .replace(/\t/g, '  ')              // Tabs to spaces
        .replace(/[ \t]+$/gm, '')          // Trailing whitespace
        .replace(/\n{3,}/g, '\n\n')        // Max 2 consecutive newlines
        .trim() + '\n';
      
    default:
      return content.replace(/\r\n/g, '\n').trim() + '\n';
  }
}

/**
 * Build web search query from bug description and error stack
 */
function buildWebSearchQuery(description: string, errorStack?: string): string {
  const parts: string[] = [];
  
  // Extract key terms from description
  const keywords = description
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5);
  parts.push(...keywords);
  
  // Extract error type from stack
  if (errorStack) {
    const errorMatch = errorStack.match(/(\w+Error):|Error:\s*(.+?)(?:\n|$)/);
    if (errorMatch) {
      parts.push(errorMatch[1] || errorMatch[2]);
    }
  }
  
  return parts.join(' ');
}

/**
 * Detect code conventions in the codebase
 */
async function detectCodeConventions(extras: ToolExtras): Promise<CodeConventions> {
  const conventions: CodeConventions = {
    namingStyle: 'camelCase',
    indentation: 'spaces',
    indentSize: 2,
    quotes: 'single',
    semicolons: true,
    fileNaming: 'kebab-case',
    testPattern: '*.test.ts',
    componentPattern: 'PascalCase'
  };
  
  // Try to read configuration files
  try {
    const workspaceDirs = await extras.ide.getWorkspaceDirs();
    if (workspaceDirs.length > 0) {
      // Check for prettier config
      try {
        const prettierConfig = await extras.ide.readFile(`${workspaceDirs[0]}/.prettierrc`);
        const config = JSON.parse(prettierConfig);
        if (config.tabWidth) conventions.indentSize = config.tabWidth;
        if (config.useTabs) conventions.indentation = 'tabs';
        if (config.singleQuote !== undefined) conventions.quotes = config.singleQuote ? 'single' : 'double';
        if (config.semi !== undefined) conventions.semicolons = config.semi;
      } catch { /* no prettier config */ }
      
      // Check for eslint config
      try {
        const eslintConfig = await extras.ide.readFile(`${workspaceDirs[0]}/.eslintrc.json`);
        // Parse eslint rules for conventions
      } catch { /* no eslint config */ }
    }
  } catch { /* ignore errors */ }
  
  return conventions;
}

interface CodeConventions {
  namingStyle: 'camelCase' | 'snake_case' | 'PascalCase';
  indentation: 'spaces' | 'tabs';
  indentSize: number;
  quotes: 'single' | 'double';
  semicolons: boolean;
  fileNaming: 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case';
  testPattern: string;
  componentPattern: string;
}

interface ScaffoldFile {
  path: string;
  description: string;
  content: string;
}

/**
 * Generate scaffold plan for a new feature
 */
function generateScaffoldPlan(
  featureName: string, 
  description: string, 
  conventions: CodeConventions,
  targetDir?: string
): ScaffoldFile[] {
  const basePath = targetDir || 'src';
  const fileName = toKebabCase(featureName);
  const className = toPascalCase(featureName);
  const varName = toCamelCase(featureName);
  
  const indent = conventions.indentation === 'tabs' ? '\t' : ' '.repeat(conventions.indentSize);
  const quote = conventions.quotes === 'single' ? "'" : '"';
  const semi = conventions.semicolons ? ';' : '';
  
  const files: ScaffoldFile[] = [
    {
      path: `${basePath}/${fileName}/index.ts`,
      description: 'Main entry point',
      content: `/**
 * ${className} - ${description}
 */

export * from ${quote}./${fileName}${quote}${semi}
export * from ${quote}./types${quote}${semi}
`
    },
    {
      path: `${basePath}/${fileName}/${fileName}.ts`,
      description: 'Core implementation',
      content: `/**
 * ${className} Implementation
 * 
 * ${description}
 */

import { ${className}Options, ${className}Result } from ${quote}./types${quote}${semi}

/**
 * Main ${className} class
 */
export class ${className} {
${indent}private options: ${className}Options${semi}

${indent}constructor(options: ${className}Options = {}) {
${indent}${indent}this.options = options${semi}
${indent}}

${indent}/**
${indent} * Execute the main ${featureName} logic
${indent} */
${indent}async execute(): Promise<${className}Result> {
${indent}${indent}// Scaffold placeholder — replace with real ${featureName} logic.
${indent}${indent}throw new Error(
${indent}${indent}${indent}${quote}[scaffold] ${className}.execute() is not implemented — add ${featureName} logic${quote}
${indent}${indent})${semi}
${indent}}
}

/**
 * Factory function for quick instantiation
 */
export function create${className}(options?: ${className}Options): ${className} {
${indent}return new ${className}(options)${semi}
}
`
    },
    {
      path: `${basePath}/${fileName}/types.ts`,
      description: 'Type definitions',
      content: `/**
 * Types for ${className}
 */

export interface ${className}Options {
${indent}/** Enable debug mode */
${indent}debug?: boolean${semi}
${indent}/** Custom configuration */
${indent}config?: Record<string, unknown>${semi}
}

export interface ${className}Result {
${indent}success: boolean${semi}
${indent}message: string${semi}
${indent}data?: unknown${semi}
${indent}error?: Error${semi}
}
`
    }
  ];
  
  return files;
}

/**
 * Generate test scaffold for feature files
 */
function generateTestScaffold(
  featureName: string, 
  scaffoldPlan: ScaffoldFile[],
  conventions: CodeConventions
): ScaffoldFile[] {
  const fileName = toKebabCase(featureName);
  const className = toPascalCase(featureName);
  const quote = conventions.quotes === 'single' ? "'" : '"';
  const semi = conventions.semicolons ? ';' : '';
  
  return [
    {
      path: `${scaffoldPlan[0].path.replace('/index.ts', '')}/${fileName}.test.ts`,
      description: 'Unit tests',
      content: `/**
 * Tests for ${className}
 */

import { ${className}, create${className} } from ${quote}./${fileName}${quote}${semi}

describe(${quote}${className}${quote}, () => {
  describe(${quote}constructor${quote}, () => {
    it(${quote}should create instance with default options${quote}, () => {
      const instance = new ${className}()${semi}
      expect(instance).toBeInstanceOf(${className})${semi}
    })${semi}

    it(${quote}should create instance with custom options${quote}, () => {
      const instance = new ${className}({ debug: true })${semi}
      expect(instance).toBeInstanceOf(${className})${semi}
    })${semi}
  })${semi}

  describe(${quote}execute${quote}, () => {
    it(${quote}should execute successfully${quote}, async () => {
      const instance = create${className}()${semi}
      const result = await instance.execute()${semi}
      expect(result.success).toBe(true)${semi}
    })${semi}
  })${semi}
})${semi}
`
    }
  ];
}

/**
 * Generate documentation for a feature
 */
function generateFeatureDocumentation(
  featureName: string, 
  description: string, 
  scaffoldPlan: ScaffoldFile[]
): string {
  const className = toPascalCase(featureName);
  
  return `# ${className}

## Overview
${description}

## Files Created

${scaffoldPlan.map(f => `- \`${f.path}\`: ${f.description}`).join('\n')}

## Usage

\`\`\`typescript
import { ${className}, create${className} } from './${toKebabCase(featureName)}';

// Using the class directly
const instance = new ${className}({ debug: true });
const result = await instance.execute();

// Using the factory function
const quick = create${className}();
await quick.execute();
\`\`\`

## API Reference

### \`${className}\`

Main class for ${featureName} functionality.

#### Constructor

\`\`\`typescript
new ${className}(options?: ${className}Options)
\`\`\`

#### Methods

- \`execute(): Promise<${className}Result>\` - Execute the main logic

### Types

- \`${className}Options\` - Configuration options
- \`${className}Result\` - Execution result
`;
}

/**
 * Extract line number from search result content
 */
function extractLineNumber(content: string): number {
  const match = content.match(/line\s*(\d+)/i) || content.match(/:(\d+):/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Extract code snippet around a pattern
 */
function extractSnippet(content: string, pattern: string): string {
  const index = content.indexOf(pattern);
  if (index === -1) return content.substring(0, 100);
  
  const start = Math.max(0, index - 30);
  const end = Math.min(content.length, index + pattern.length + 30);
  return content.substring(start, end);
}

/**
 * Generate migration report
 */
function generateMigrationReport(
  migrationType: string,
  fromPattern: string,
  toPattern: string,
  changes: MigrationChange[],
  dryRun: boolean
): string {
  const applied = changes.filter(c => c.status === 'applied').length;
  const failed = changes.filter(c => c.status === 'failed').length;
  const pending = changes.filter(c => c.status === 'pending').length;
  
  return `# Migration Report

## Migration Type
${migrationType}

## Pattern
\`${fromPattern}\` → \`${toPattern}\`

## Summary
- **Total locations found:** ${changes.length}
- **Applied:** ${applied}
- **Failed:** ${failed}
- **Pending:** ${pending}
${dryRun ? '\n⚠️ **This was a dry run. No changes were made.**' : ''}

## Changes by File

${changes.map(c => `### ${c.file}:${c.lineNumber}
- **Status:** ${c.status}
- **Before:** \`${c.before.substring(0, 50)}...\`
- **After:** \`${c.after.substring(0, 50)}...\`
${c.error ? `- **Error:** ${c.error}` : ''}`).join('\n\n')}

## Next Steps
${dryRun ? `
1. Review the changes above
2. Run again with \`dryRun: false\` to apply changes
3. Run tests to verify the migration
` : `
1. Review the applied changes
2. Run the test suite
3. Commit the changes with a descriptive message
`}
`;
}

// String case conversion helpers
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Map of definition `function.name` → implementation (must match definitions/composite). */
export const compositeImplementations: Record<string, ToolImpl> = {
  composite_smart_edit: smartEditImpl,
  composite_investigate_bug: bugInvestigationImpl,
  composite_code_review: codeReviewImpl,
  composite_health_check: projectHealthImpl,
  composite_learn_codebase: learnCodebaseImpl,
  composite_implement_feature: featureImplementationImpl,
  composite_migrate: migrationImpl,
};
