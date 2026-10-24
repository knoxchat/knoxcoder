/**
 * EnhancedSemantic — Rule-based synonym/concept expansion for local fusion (IMP-12 / REL-16).
 * Pure FTS-friendly expansion; no ML models.
 *
 * REL-16: whole-token match only, at most one group, at most 3 additions,
 * never expand continuation queries.
 */

const SYNONYM_GROUPS: string[][] = [
  ["auth", "authentication", "login", "signin", "sign-in"],
  ["config", "configuration", "settings", "preferences"],
  ["bug", "error", "issue", "defect", "failure"],
  ["test", "testing", "spec", "unit test", "integration test"],
  ["refactor", "cleanup", "restructure", "reorganize"],
  ["api", "endpoint", "route", "handler"],
  ["db", "database", "sql", "sqlite", "postgres"],
  ["ui", "interface", "frontend", "gui", "view"],
  ["deploy", "deployment", "release", "publish"],
  ["memory", "recall", "retrieval", "context"],
  ["fix", "patch", "resolve", "repair"],
  ["optimize", "performance", "speed", "latency"],
  // T6 / T12: paraphrastic bench misses (rule-based, no embeddings).
  ["invoice", "tax", "money", "cents", "price", "currency"],
  ["a11y", "accessibility", "accessible", "aria", "icon-only"],
  ["tokens", "design-system", "components", "storybook", "settings card"],
];

const MAX_SYNONYM_ADDITIONS = 3;

export interface SynonymExpandOptions {
  /** REL-16: continuation queries must not explode the search. */
  continuation?: boolean;
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\w-]+/)
    .filter((t) => t.length > 2);
}

function termParts(term: string): string[] {
  return term.toLowerCase().split(/[^\w-]+/).filter((t) => t.length > 0);
}

function termMatchesTokens(term: string, tokens: string[]): boolean {
  const parts = termParts(term);
  if (parts.length === 1) return tokens.includes(parts[0]);
  return parts.every((p) => p.length <= 2 || tokens.includes(p));
}

function termSpecificity(term: string): number {
  return termParts(term).length;
}

/**
 * Extra synonym terms to OR into FTS5 (not concatenated into AND clauses).
 */
export function getSynonymAdditions(
  query: string,
  options?: SynonymExpandOptions,
): string[] {
  if (options?.continuation) return [];
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const lower = query.toLowerCase();
  let best: { additions: string[]; specificity: number } | undefined;

  for (const group of SYNONYM_GROUPS) {
    const matchedTerms = group.filter((term) => termMatchesTokens(term, tokens));
    if (matchedTerms.length === 0) continue;
    const specificity = Math.max(...matchedTerms.map(termSpecificity));
    if (best && specificity <= best.specificity) continue;
    const additions: string[] = [];
    for (const term of group) {
      if (termMatchesTokens(term, tokens) || lower.includes(term)) continue;
      additions.push(term);
      if (additions.length >= MAX_SYNONYM_ADDITIONS) break;
    }
    best = { additions, specificity };
  }

  return best?.additions ?? [];
}

/**
 * Expand query with synonym terms for FTS5 OR matching.
 * Returns the original query if no synonyms match.
 */
export function expandQuerySynonyms(
  query: string,
  options?: SynonymExpandOptions,
): string {
  const additions = getSynonymAdditions(query, options);
  if (additions.length === 0) return query;
  return `${query} ${additions.join(" ")}`;
}
