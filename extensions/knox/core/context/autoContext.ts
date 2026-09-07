import { ContextItem, IDE } from "../index.js";
import { countTokens } from "../llm/countTokens.js";
import { buildDependencyGraph, getFilesWithinDistance } from "./dependencyGraph.js";
import { rankFiles, type ScoredFile } from "./relevanceScorer.js";

/**
 * Auto-Context Selection Engine.
 *
 * Automatically identifies and gathers relevant files/symbols based on
 * the user's message, so users don't need to manually @-reference
 * every file.
 *
 * Strategy:
 * 1. Extract explicit file references from the message
 * 2. Extract symbol names (classes, functions, variables)
 * 3. Find related files via import chains & naming patterns
 * 4. Score candidates by relevance
 * 5. Select top-K within token budget
 */

export interface AutoContextConfig {
  /** Whether auto-context is enabled (default: true) */
  enabled: boolean;
  /** Maximum tokens to spend on auto-gathered context (default: 8000) */
  maxTokenBudget: number;
  /** Maximum number of files to include (default: 5) */
  maxFiles: number;
  /** Whether to include test files for modified source files (default: true) */
  includeRelatedTests: boolean;
  /** Whether to include recently edited files (default: true) */
  includeRecentEdits: boolean;
}

export const DEFAULT_AUTO_CONTEXT_CONFIG: AutoContextConfig = {
  enabled: true,
  maxTokenBudget: 8000,
  maxFiles: 5,
  includeRelatedTests: true,
  includeRecentEdits: true,
};

interface FileCandidate {
  path: string;
  score: number;
  reason: string;
}

/**
 * Extract file path references from a user message.
 * Matches patterns like: src/foo.ts, ./components/Bar.tsx, file.py, etc.
 */
export function extractFileReferences(message: string): string[] {
  const patterns = [
    // Explicit file paths with extensions (src/foo.ts, ./bar/baz.py)
    /(?:^|\s|["'`(,])([.~/]?[a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,10})(?:\s|["'`),:]|$)/gm,
    // File references in backticks (`foo.ts`)
    /`([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,10})`/gm,
  ];

  const refs = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      const ref = match[1].trim();
      // Filter out URLs, version numbers, and too-short matches
      if (
        !ref.includes("://") &&
        !ref.match(/^\d+\.\d+/) &&
        ref.length > 3 &&
        !ref.startsWith("http")
      ) {
        refs.add(ref);
      }
    }
  }
  return Array.from(refs);
}

/**
 * Extract symbol names (classes, functions, methods, variables) from the message.
 */
export function extractSymbolReferences(message: string): string[] {
  const symbols = new Set<string>();

  // PascalCase class/component names
  const pascalCase = message.match(/\b([A-Z][a-zA-Z0-9]{2,})\b/g);
  if (pascalCase) {
    for (const name of pascalCase) {
      // Skip common English words that happen to be capitalized
      const skipWords = new Set([
        "The", "This", "That", "What", "When", "Where", "Which", "While",
        "How", "For", "From", "With", "About", "After", "Before", "Because",
        "Also", "But", "And", "Not", "All", "Any", "Are", "Can", "Did",
        "Does", "Each", "Find", "Get", "Has", "Her", "His", "Into", "Its",
        "Let", "May", "New", "Now", "One", "Our", "Out", "Own", "Run",
        "Set", "She", "Too", "Try", "Two", "Use", "Was", "Way", "Who",
        "Add", "Fix", "Yes", "JSON", "API", "URL", "CSS", "HTML", "SQL",
        "CLI", "IDE", "TODO", "FIXME", "NOTE", "README",
      ]);
      if (!skipWords.has(name)) {
        symbols.add(name);
      }
    }
  }

  // camelCase or snake_case function/method names in backticks
  const backticked = message.match(/`([a-zA-Z_][a-zA-Z0-9_]*(?:\(\))?)`/g);
  if (backticked) {
    for (const match of backticked) {
      const name = match.replace(/[`()]/g, "");
      if (name.length > 2) {
        symbols.add(name);
      }
    }
  }

  return Array.from(symbols);
}

/**
 * Derive test file paths from a source file path.
 * E.g., src/utils/foo.ts → src/utils/foo.test.ts, tests/utils/foo.test.ts
 */
function deriveTestPaths(filePath: string): string[] {
  const candidates: string[] = [];
  const ext = filePath.match(/\.[^.]+$/)?.[0] || "";
  const base = filePath.replace(/\.[^.]+$/, "");

  // foo.test.ext, foo.spec.ext
  candidates.push(`${base}.test${ext}`);
  candidates.push(`${base}.spec${ext}`);

  // __tests__/foo.ext
  const parts = filePath.split("/");
  const fileName = parts.pop();
  if (fileName) {
    candidates.push([...parts, "__tests__", fileName].join("/"));
    candidates.push(["tests", ...parts.slice(1), fileName].join("/"));
    candidates.push(["test", ...parts.slice(1), fileName].join("/"));
  }

  return candidates;
}

/**
 * Gather auto-context items based on the user's message.
 *
 * @param message - The user's chat message text
 * @param ide - IDE interface for file operations
 * @param existingContextPaths - Paths already included by explicit @-references
 * @param modelName - Model name for token counting
 * @param config - Auto-context configuration
 * @returns Array of context items to inject
 */
export async function gatherAutoContext(
  message: string,
  ide: IDE,
  existingContextPaths: Set<string>,
  modelName: string,
  config: Partial<AutoContextConfig> = {},
): Promise<ContextItem[]> {
  const cfg: AutoContextConfig = { ...DEFAULT_AUTO_CONTEXT_CONFIG, ...config };

  if (!cfg.enabled) return [];

  const candidates: FileCandidate[] = [];

  // 1. Extract explicit file references from message
  const fileRefs = extractFileReferences(message);
  const workspaceDirs = await ide.getWorkspaceDirs();
  const baseDir = workspaceDirs[0] || "";

  for (const ref of fileRefs) {
    // Try relative to workspace root
    const fullPath = ref.startsWith("/") ? ref : `${baseDir}/${ref}`;
    if (!existingContextPaths.has(fullPath) && !existingContextPaths.has(ref)) {
      try {
        const exists = await ide.fileExists(fullPath);
        if (exists) {
          candidates.push({
            path: fullPath,
            score: 0.9,
            reason: "Directly referenced in message",
          });
        }
      } catch {
        // File doesn't exist, skip
      }
    }
  }

  // 2. Extract symbol references and find files containing them
  const symbols = extractSymbolReferences(message);
  if (symbols.length > 0 && symbols.length <= 10) {
    // Search for files containing these symbols (limit to avoid expensive searches)
    for (const symbol of symbols.slice(0, 5)) {
      try {
        const searchResults = await ide.getSearchResults(symbol);
        if (searchResults) {
          // Parse search results to extract file paths
          const pathMatches = searchResults.match(
            /^([^\n]+\.[a-zA-Z]{1,10}):/gm,
          );
          if (pathMatches) {
            const uniquePaths = new Set(
              pathMatches.map((m) => m.replace(/:$/, "")),
            );
            for (const path of uniquePaths) {
              if (!existingContextPaths.has(path)) {
                // Don't add duplicates
                if (!candidates.find((c) => c.path === path)) {
                  candidates.push({
                    path,
                    score: 0.6,
                    reason: `Contains symbol: ${symbol}`,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Search failed, skip this symbol
      }
    }
  }

  // 3. Build dependency graph from high-confidence candidates
  const highConfPaths = candidates
    .filter((c) => c.score >= 0.7)
    .map((c) => c.path);

  if (highConfPaths.length > 0) {
    try {
      const graph = await buildDependencyGraph(highConfPaths, ide, 2);
      const nearby = getFilesWithinDistance(graph, 2);
      for (const filePath of nearby) {
        if (
          !existingContextPaths.has(filePath) &&
          !candidates.find((c) => c.path === filePath)
        ) {
          const depth = graph.nodes.get(filePath)?.depth ?? 1;
          candidates.push({
            path: filePath,
            score: 0.5 / depth,
            reason: `Import-chain neighbor (depth ${depth})`,
          });
        }
      }
    } catch {
      // Dependency graph build failed, continue with existing candidates
    }
  }

  // 4. Include recently edited files (if enabled)
  if (cfg.includeRecentEdits) {
    try {
      const openFiles = await ide.getOpenFiles();
      for (const filePath of openFiles.slice(0, 3)) {
        if (
          !existingContextPaths.has(filePath) &&
          !candidates.find((c) => c.path === filePath)
        ) {
          candidates.push({
            path: filePath,
            score: 0.4,
            reason: "Recently open/edited file",
          });
        }
      }
    } catch {
      // Can't get open files, skip
    }
  }

  // 5. Include test files for referenced source files (if enabled)
  if (cfg.includeRelatedTests) {
    const sourceFiles = candidates
      .filter((c) => c.score >= 0.7)
      .map((c) => c.path);

    for (const sourcePath of sourceFiles) {
      const testPaths = deriveTestPaths(sourcePath);
      for (const testPath of testPaths) {
        try {
          const exists = await ide.fileExists(testPath);
          if (
            exists &&
            !existingContextPaths.has(testPath) &&
            !candidates.find((c) => c.path === testPath)
          ) {
            candidates.push({
              path: testPath,
              score: 0.5,
              reason: `Test file for ${sourcePath.split("/").pop()}`,
            });
            break; // Only include one test file per source
          }
        } catch {
          continue;
        }
      }
    }
  }

  // 6. Re-rank candidates using multi-signal relevance scorer
  let openFilePaths: string[] = [];
  try {
    openFilePaths = await ide.getOpenFiles();
  } catch {
    // ignore
  }

  // Build per-file signal maps for the relevance scorer
  const signalsMap = new Map<string, { directMention: number; symbolOverlap: number; importProximity: number; editRecency: number; fileTypeAffinity: number }>();
  for (const c of candidates) {
    const isDirectlyMentioned = fileRefs.some((r) => c.path.endsWith(r)) ? 1 : 0;
    const symbolMatches = symbols.filter((s) => c.path.toLowerCase().includes(s.toLowerCase())).length;
    const openIdx = openFilePaths.indexOf(c.path);
    signalsMap.set(c.path, {
      directMention: isDirectlyMentioned,
      symbolOverlap: symbols.length > 0 ? Math.min(symbolMatches / symbols.length, 1) : 0,
      importProximity: c.reason.includes("Import-chain") ? 0.5 / Math.max(1, parseFloat(c.reason.match(/depth (\d+)/)?.[1] ?? "1")) : 0,
      editRecency: openIdx >= 0 ? 1 - openIdx * 0.2 : 0,
      fileTypeAffinity: c.path.match(/\.(ts|tsx|js|jsx|py|rs|go|java)$/) ? 0.8 : 0.4,
    });
  }

  const scored: ScoredFile[] = rankFiles(
    candidates.map((c) => c.path),
    signalsMap,
    cfg.maxFiles * 2,
  );

  // Merge scorer results back — prefer scorer's ordering
  const scoredMap = new Map(scored.map((s) => [s.path, s]));

  // 7. Sort by combined score and select top-K within budget
  candidates.sort((a, b) => {
    const sa = scoredMap.get(a.path)?.score ?? a.score;
    const sb = scoredMap.get(b.path)?.score ?? b.score;
    return sb - sa;
  });
  const selected: ContextItem[] = [];
  let usedTokens = 0;

  for (const candidate of candidates.slice(0, cfg.maxFiles * 2)) {
    if (selected.length >= cfg.maxFiles) break;
    if (usedTokens >= cfg.maxTokenBudget) break;

    try {
      const content = await ide.readFile(candidate.path);
      const tokens = countTokens(content, modelName);

      // Skip very large files (> half budget)
      if (tokens > cfg.maxTokenBudget / 2) {
        // Truncate to a reasonable size
        const lines = content.split("\n");
        const truncated =
          lines.slice(0, 100).join("\n") +
          `\n\n... (${lines.length - 100} more lines)`;
        const truncatedTokens = countTokens(truncated, modelName);

        if (usedTokens + truncatedTokens <= cfg.maxTokenBudget) {
          selected.push({
            content: `\`\`\`${candidate.path}\n${truncated}\n\`\`\``,
            name: candidate.path.split("/").pop() || candidate.path,
            description: `${candidate.reason} (truncated)`,
            uri: { type: "file", value: candidate.path },
          });
          usedTokens += truncatedTokens;
        }
      } else if (usedTokens + tokens <= cfg.maxTokenBudget) {
        selected.push({
          content: `\`\`\`${candidate.path}\n${content}\n\`\`\``,
          name: candidate.path.split("/").pop() || candidate.path,
          description: candidate.reason,
          uri: { type: "file", value: candidate.path },
        });
        usedTokens += tokens;
      }
    } catch {
      // Can't read file, skip
    }
  }

  return selected;
}
