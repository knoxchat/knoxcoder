/**
 * GraphRetrieval — REL-11 helpers to stop common-noun entity leakage.
 *
 * Graph expansion used to LIKE-match short / generic names (`file`, `config`)
 * against every semantic row. These helpers:
 *   - skip expansion when the query has no entity-like tokens
 *   - refuse substring joins for denylisted / short names
 *   - require word-boundary (or exact name) matches instead of `%name%`
 */

import { extractEntityLikeTokens, hasWordBoundary } from "./RelevanceGate.js";
import { contentWords, isStopword } from "./RetrievalQuery.js";

/** Common nouns that must not substring-match the world. */
export const GRAPH_COMMON_NOUN_DENYLIST: ReadonlySet<string> = new Set([
  "file",
  "files",
  "user",
  "users",
  "config",
  "error",
  "errors",
  "memory",
  "test",
  "tests",
  "data",
  "item",
  "items",
  "name",
  "type",
  "value",
  "code",
  "text",
  "line",
  "path",
  "list",
  "object",
  "string",
  "number",
  "class",
  "function",
  "method",
  "module",
  "system",
  "service",
  "client",
  "server",
  "request",
  "response",
  "index",
  "key",
  "id",
]);

/** Names shorter than this must not use substring LIKE (word-boundary / exact only). */
export const GRAPH_SHORT_NAME_MAX = 4;

export function isCommonNounEntityName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (GRAPH_COMMON_NOUN_DENYLIST.has(n)) return true;
  return contentWords(n).length > 0 && contentWords(n).every((w) => GRAPH_COMMON_NOUN_DENYLIST.has(w));
}

export function isShortEntityName(name: string): boolean {
  return name.trim().length > 0 && name.trim().length <= GRAPH_SHORT_NAME_MAX;
}

/** Query is worth graph expansion: quoted/CamelCase token, or a content word ≥ 3 chars. */
export function hasGraphExpandableTokens(query: string): boolean {
  if (!query?.trim()) return false;
  if (extractEntityLikeTokens(query).length > 0) return true;
  return contentWords(query).some((w) => w.length >= 3 && !isStopword(w));
}

export function queryMentionsEntity(query: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (hasWordBoundary(query, n)) return true;
  const lower = n.toLowerCase();
  return extractEntityLikeTokens(query).some((t) => t.toLowerCase() === lower);
}

/**
 * Terms used to look up entities. Stopwords dropped. Denylist nouns are kept
 * only when the query actually mentions them (so "file" still finds entity file).
 */
export function entitySearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 3) return;
    const key = t.toLowerCase();
    if (seen.has(key) || isStopword(key)) return;
    if (isCommonNounEntityName(t) && !queryMentionsEntity(query, t)) return;
    seen.add(key);
    out.push(t);
  };
  for (const tok of extractEntityLikeTokens(query)) push(tok);
  for (const w of contentWords(query)) push(w);
  return out;
}

/**
 * Neighbor → memory join is allowed unless the name is a denylisted common noun
 * that the query did not mention.
 */
export function shouldJoinEntityToMemories(query: string, entityName: string): boolean {
  const n = entityName.trim();
  if (n.length < 3 || isStopword(n)) return false;
  if (isCommonNounEntityName(n) && !queryMentionsEntity(query, n)) return false;
  return true;
}

/** True when this entity name must not use unbounded `%name%` substring SQL. */
export function requiresBoundedEntityMatch(entityName: string): boolean {
  return isCommonNounEntityName(entityName) || isShortEntityName(entityName);
}

export function entityNameMatchesMemory(memoryText: string, entityName: string): boolean {
  const n = entityName.trim();
  if (!n || !memoryText) return false;
  return hasWordBoundary(memoryText, n);
}

/**
 * REL-11: graph may rank, but must not lift a weak/zero-lexical candidate over θ.
 * Returns the allowed weighted graph contribution.
 */
export function capGraphContribution(
  textLexical: number,
  graphWeighted: number,
  recencyImportanceCapped: number,
  theta: number,
  fts5: number,
  trigram: number,
  lexicalFloor: number,
  thetaMargin: number,
): number {
  if (graphWeighted <= 0) return 0;
  if (fts5 + trigram >= lexicalFloor) return graphWeighted;
  const maxGraph = Math.max(
    0,
    theta - thetaMargin - textLexical - recencyImportanceCapped,
  );
  return Math.min(graphWeighted, maxGraph);
}
