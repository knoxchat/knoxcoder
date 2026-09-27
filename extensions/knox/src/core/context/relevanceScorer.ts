/**
 * Relevance Scorer
 *
 * Scores candidate files by their relevance to the user's query.
 * Combines multiple signals: direct mention, symbol overlap,
 * import distance, edit recency, and file-type affinity.
 */

export interface RelevanceSignals {
  /** File was directly mentioned by path in the message (0 or 1) */
  directMention: number;
  /** Number of query symbols found in the file (0–1 normalized) */
  symbolOverlap: number;
  /** Inverse of import distance from a root file (0–1, closer = higher) */
  importProximity: number;
  /** How recently the file was edited (0–1, more recent = higher) */
  editRecency: number;
  /** File type relevance: source > tests > docs > config (0–1) */
  fileTypeAffinity: number;
}

export interface ScoredFile {
  path: string;
  score: number;
  signals: RelevanceSignals;
  reason: string;
}

// Weights for combining signals into a final score
const DEFAULT_WEIGHTS: Record<keyof RelevanceSignals, number> = {
  directMention: 0.35,
  symbolOverlap: 0.25,
  importProximity: 0.20,
  editRecency: 0.10,
  fileTypeAffinity: 0.10,
};

// File extension to type-affinity score mapping
const FILE_TYPE_AFFINITY: Record<string, number> = {
  // Source code (high affinity)
  ".ts": 0.9, ".tsx": 0.9, ".js": 0.9, ".jsx": 0.9,
  ".py": 0.9, ".rs": 0.9, ".go": 0.9, ".java": 0.9,
  ".cpp": 0.9, ".c": 0.9, ".cs": 0.9, ".rb": 0.9,
  ".swift": 0.9, ".kt": 0.9, ".scala": 0.9,

  // Test files (medium-high affinity)
  ".test.ts": 0.7, ".test.tsx": 0.7, ".test.js": 0.7,
  ".spec.ts": 0.7, ".spec.tsx": 0.7, ".spec.js": 0.7,
  ".test.py": 0.7, ".test.rs": 0.7,

  // Config files (medium affinity)
  ".json": 0.5, ".yaml": 0.5, ".yml": 0.5, ".toml": 0.5,
  ".xml": 0.4, ".env": 0.3,

  // Documentation (lower affinity for code tasks)
  ".md": 0.3, ".txt": 0.2, ".rst": 0.2,

  // Styles (low affinity unless frontend task)
  ".css": 0.4, ".scss": 0.4, ".less": 0.4,
  ".html": 0.4, ".vue": 0.7, ".svelte": 0.7,
};

/**
 * Get file type affinity score.
 */
function getFileTypeAffinity(filePath: string): number {
  const lower = filePath.toLowerCase();

  // Check compound extensions first (.test.ts, .spec.js)
  for (const [ext, score] of Object.entries(FILE_TYPE_AFFINITY)) {
    if (ext.includes(".") && ext.startsWith(".") && lower.endsWith(ext)) {
      return score;
    }
  }

  // Single extension
  const ext = lower.match(/\.[^.]+$/)?.[0] ?? "";
  return FILE_TYPE_AFFINITY[ext] ?? 0.3;
}

/**
 * Calculate symbol overlap between query symbols and file content.
 *
 * @param querySymbols - Symbols extracted from the user's message
 * @param fileContent - The file content to search
 * @returns Normalized score 0–1
 */
export function calculateSymbolOverlap(
  querySymbols: string[],
  fileContent: string,
): number {
  if (querySymbols.length === 0) return 0;

  let matchCount = 0;
  for (const symbol of querySymbols) {
    // Case-sensitive match for symbols
    if (fileContent.includes(symbol)) {
      matchCount++;
    }
  }

  return matchCount / querySymbols.length;
}

/**
 * Calculate import proximity score given an import distance.
 * Distance 0 = the file itself (1.0), distance 1 = direct import (0.7), etc.
 */
export function calculateImportProximity(
  importDistance: number | null,
): number {
  if (importDistance === null) return 0;
  if (importDistance === 0) return 1.0;
  // Exponential decay: closer files score higher
  return Math.max(0, 1.0 - importDistance * 0.3);
}

/**
 * Calculate edit recency score.
 *
 * @param lastEditTimestamp - Timestamp of last edit (ms since epoch)
 * @param now - Current timestamp
 * @returns Score 0–1 (recent = higher)
 */
export function calculateEditRecency(
  lastEditTimestamp: number | null,
  now: number = Date.now(),
): number {
  if (lastEditTimestamp === null) return 0;

  const ageMs = now - lastEditTimestamp;
  const ageMinutes = ageMs / (1000 * 60);

  // Within 5 minutes = 1.0, decays over 1 hour to ~0.1
  if (ageMinutes <= 5) return 1.0;
  if (ageMinutes <= 15) return 0.8;
  if (ageMinutes <= 30) return 0.5;
  if (ageMinutes <= 60) return 0.3;
  return 0.1;
}

/**
 * Score a candidate file by its relevance to the user's query.
 */
export function scoreFile(
  filePath: string,
  signals: Partial<RelevanceSignals>,
  weights: Partial<Record<keyof RelevanceSignals, number>> = {},
): ScoredFile {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const fullSignals: RelevanceSignals = {
    directMention: signals.directMention ?? 0,
    symbolOverlap: signals.symbolOverlap ?? 0,
    importProximity: signals.importProximity ?? 0,
    editRecency: signals.editRecency ?? 0,
    fileTypeAffinity: signals.fileTypeAffinity ?? getFileTypeAffinity(filePath),
  };

  // Weighted sum
  const score =
    fullSignals.directMention * w.directMention +
    fullSignals.symbolOverlap * w.symbolOverlap +
    fullSignals.importProximity * w.importProximity +
    fullSignals.editRecency * w.editRecency +
    fullSignals.fileTypeAffinity * w.fileTypeAffinity;

  // Build reason string from top signals
  const reasons: string[] = [];
  if (fullSignals.directMention > 0) reasons.push("directly mentioned");
  if (fullSignals.symbolOverlap > 0.5) reasons.push("high symbol overlap");
  if (fullSignals.importProximity > 0.5) reasons.push("closely imported");
  if (fullSignals.editRecency > 0.5) reasons.push("recently edited");
  if (reasons.length === 0) reasons.push("general relevance");

  return {
    path: filePath,
    score: Math.min(1.0, Math.max(0, score)),
    signals: fullSignals,
    reason: reasons.join(", "),
  };
}

/**
 * Score and rank multiple candidate files.
 *
 * @param candidates - File paths to score
 * @param signalsMap - Pre-computed signals for each file
 * @param limit - Maximum number of results to return
 * @returns Array of scored files, sorted by score (descending)
 */
export function rankFiles(
  candidates: string[],
  signalsMap: Map<string, Partial<RelevanceSignals>>,
  limit: number = 10,
): ScoredFile[] {
  const scored = candidates.map((path) =>
    scoreFile(path, signalsMap.get(path) ?? {}),
  );

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
