/**
 * MEM-23 — Ripgrep retrieval channel.
 *
 * Ranked exact / regex / identifier hits over stored memory text (semantic +
 * episodic) and, when `memory_scope=project`, workspace files already allowed
 * by `.knoxignore`. Hits map back to memory ids (file hits → file entities /
 * recent rows that mention those paths). This is a channel over the same
 * rows, not a second store.
 *
 * Part V: four channels over Ω(q); ripgrep is not BM25 (that is lexical) and
 * not extra C_addr. Search cost is inverted-index MATCH then rg on that hit
 * list — not a recency dump of Ω(q) (Dilution Lemma / Search(q) = O(log N_q)).
 *
 * Reuses `core/tools/ripgrep` (bundled rg + knoxignore). Fail-open if the
 * binary is missing. Never shells out.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isSearchFileHeader,
  isSearchMatchLine,
  resolveRipgrepBinary,
  runRipgrepSearch,
  searchWorkspaceWithRipgrep,
} from "../../../../tools/ripgrep.js";
import { GENERIC_GATE_WORDS, extractEntityLikeTokens } from "../RelevanceGate.js";
import { contentWords } from "../RetrievalQuery.js";
import { queryScopeSql } from "../store/validity.js";
import { truncateSqliteLikePattern } from "../../../../util/refreshIndex.js";
import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import type { SemanticCategory } from "../types.js";

export const RIPGREP_NEEDLE_CAP = 6;
export const RIPGREP_WORKSPACE_NEEDLE_CAP = 3;
/** Rows written for rg after FTS MATCH. Must not scan Ω(q). */
export const RIPGREP_CORPUS_ROW_CAP = 256;
export const RIPGREP_FILE_HIT_CAP = 20;
export const RIPGREP_MEMORIES_PER_FILE = 5;
export const RIPGREP_MATCH_CAP_PER_NEEDLE = 8;
/** Recency dump only when FTS is missing and the table is still small. */
const RIPGREP_CORPUS_LIKE_MAX_ROWS = 5000;
const FTS_CORPUS_OVERFETCH = 10;

export const RIPGREP_IDENTIFIER_WEIGHT = 2;
export const RIPGREP_EXACT_WEIGHT = 1.5;
export const RIPGREP_REGEX_WEIGHT = 1;
export const RIPGREP_FILE_MAP_WEIGHT = 0.75;

/**
 * Whole-word tokens shorter than this are lexical BM25, not ripgrep-exact
 * (`session`, `refresh`). Quoted / identifier / regex needles have no floor.
 */
const RIPGREP_EXACT_WORD_MIN = 12;
const CORPUS_FILENAME = "corpus.txt";

export type RipgrepNeedleKind = "identifier" | "exact" | "regex";
export type RipgrepHitSource = "corpus" | "file";
export type RipgrepMemoryType = "semantic" | "episodic";

export interface RipgrepNeedle {
  pattern: string;
  kind: RipgrepNeedleKind;
  wholeWord: boolean;
  fixedStrings: boolean;
}

export interface RipgrepMemoryHit {
  type: RipgrepMemoryType;
  id: number;
  score: number;
  source: RipgrepHitSource;
}

export interface RipgrepFileHit {
  file: string;
  matches: number;
}

export interface RipgrepChannelOptions {
  query: string;
  db: DatabaseConnection;
  includeEpisodic?: boolean;
  category?: SemanticCategory;
  sessionId?: string;
  projectSessionIds?: string[];
  workspaceDir?: string;
  /** Workspace file search. Caller sets this when `memory_scope=project`. */
  searchWorkspace?: boolean;
  limit?: number;
}

export function hasRipgrepHit(hit?: {
  ranks?: { ripgrep?: number; lexical?: number; graph?: number; tree?: number };
  scores?: { ripgrep?: number };
} | null): boolean {
  if (!hit) return false;
  const rank = hit.ranks?.ripgrep;
  if (rank != null && Number.isFinite(rank) && rank >= 1) return true;
  return (hit.scores?.ripgrep ?? 0) > 0;
}

export function looksLikeRegex(query: string): boolean {
  const q = query.trim();
  if (q.length < 2 || q.length > 80) return false;
  if (/^\/.+\/[gimsuy]*$/.test(q)) return true;
  if (/\\[bBdDsSwWnt]|\\[0-9]|\.\*|\.\+|\[\^|\(\?:/.test(q)) return true;
  return /^[^\s|]{1,40}\|[^\s|]{1,40}$/.test(q);
}

export function unwrapRegexLiteral(query: string): string {
  const m = query.trim().match(/^\/(.+)\/[gimsuy]*$/);
  return m?.[1] ?? query.trim();
}

export function extractRipgrepNeedles(query: string): RipgrepNeedle[] {
  const needles: RipgrepNeedle[] = [];
  const seen = new Set<string>();

  const add = (needle: RipgrepNeedle) => {
    const pattern = needle.pattern.trim();
    if (!pattern || pattern.length < 2) return;
    const key = `${needle.kind}:${needle.fixedStrings ? "F" : "R"}:${pattern.toLowerCase()}`;
    if (seen.has(key)) return;
    if (GENERIC_GATE_WORDS.has(pattern.toLowerCase())) return;
    seen.add(key);
    needles.push({ ...needle, pattern });
  };

  for (const m of query.matchAll(/"([^"]{2,})"|'([^']{2,})'|`([^`]{2,})`/g)) {
    add({
      pattern: (m[1] ?? m[2] ?? m[3] ?? "").trim(),
      kind: "exact",
      wholeWord: false,
      fixedStrings: true,
    });
  }

  const filePattern =
    /(?:^|[\s"'`(])([./~]?(?:[\w.-]+\/)+[\w.-]+\.\w{1,10})/g;
  for (const m of query.matchAll(filePattern)) {
    add({
      pattern: m[1],
      kind: "identifier",
      wholeWord: false,
      fixedStrings: true,
    });
  }

  for (const ident of extractEntityLikeTokens(query)) {
    add({
      pattern: ident,
      kind: "identifier",
      wholeWord: !/[./\\]/.test(ident),
      fixedStrings: true,
    });
  }

  if (looksLikeRegex(query)) {
    add({
      pattern: unwrapRegexLiteral(query),
      kind: "regex",
      wholeWord: false,
      fixedStrings: false,
    });
  }

  for (const word of contentWords(query)) {
    if (word.length < RIPGREP_EXACT_WORD_MIN) continue;
    add({
      pattern: word,
      kind: "exact",
      wholeWord: true,
      fixedStrings: true,
    });
  }

  return needles.slice(0, RIPGREP_NEEDLE_CAP);
}

export function workspaceNeedles(needles: readonly RipgrepNeedle[]): RipgrepNeedle[] {
  return corpusNeedles(needles).slice(0, RIPGREP_WORKSPACE_NEEDLE_CAP);
}

/**
 * Ω(q) corpus needles: exact / regex / identifier only (Part V). Short
 * whole-word content tokens stay on the lexical channel.
 */
export function corpusNeedles(needles: readonly RipgrepNeedle[]): RipgrepNeedle[] {
  return needles.filter((n) => {
    if (n.kind === "identifier" || n.kind === "regex") return true;
    if (n.kind === "exact" && !n.wholeWord) return true;
    return n.kind === "exact" && n.wholeWord && n.pattern.length >= RIPGREP_EXACT_WORD_MIN;
  });
}

/** FTS5 MATCH clause that finds Ω(q) candidate rows for one corpus needle. */
export function ftsMatchQueryForNeedle(needle: RipgrepNeedle): string | null {
  if (needle.kind === "regex") {
    const literals = needle.pattern.match(/[A-Za-z0-9_]{3,}/g) ?? [];
    const parts = uniqueKeep(literals).map(formatFtsToken).filter((t): t is string => Boolean(t));
    return parts.length > 0 ? parts.join(" OR ") : null;
  }
  const parts = needle.pattern
    .split(/[^\w]+/)
    .map(formatFtsToken)
    .filter((t): t is string => Boolean(t));
  if (parts.length === 0) return null;
  if (needle.kind === "exact" && !needle.wholeWord && parts.length === 1) return parts[0];
  return parts.join(" AND ");
}

function formatFtsToken(raw: string): string | null {
  const token = raw.trim().replace(/"/g, "");
  if (token.length < 2) return null;
  if (/^(AND|OR|NOT|NEAR)$/i.test(token)) return null;
  if (/^\w+$/.test(token)) return `${token}*`;
  return `"${token}"`;
}

export function needleWeight(kind: RipgrepNeedleKind): number {
  if (kind === "identifier") return RIPGREP_IDENTIFIER_WEIGHT;
  if (kind === "exact") return RIPGREP_EXACT_WEIGHT;
  return RIPGREP_REGEX_WEIGHT;
}

export function normalizeRelPath(file: string, workspaceDir?: string): string {
  const trimmed = file.trim();
  if (!trimmed) return "";
  let raw = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (workspaceDir) {
    const ws = path.resolve(workspaceDir);
    const abs = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(workspaceDir, trimmed);
    const rel = path.relative(ws, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      raw = rel.replace(/\\/g, "/");
    }
  }
  return raw.replace(/^\.\//, "");
}

export function filePathMatches(entityName: string, hitPath: string): boolean {
  const a = normalizeRelPath(entityName);
  const b = normalizeRelPath(hitPath);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.endsWith(`/${b}`) || b.endsWith(`/${a}`)) return true;
  const baseA = path.posix.basename(a);
  const baseB = path.posix.basename(b);
  if (baseA !== baseB) return false;
  return (a === baseA && b.endsWith(`/${baseA}`)) || (b === baseB && a.endsWith(`/${baseB}`));
}

export function parseRipgrepContentHits(output: string): RipgrepFileHit[] {
  if (isEmptyRipgrepOutput(output)) return [];
  const files: RipgrepFileHit[] = [];
  let current: RipgrepFileHit | null = null;
  for (const line of output.split("\n")) {
    if (!line.trim() || line === "--") continue;
    if (line.startsWith("truncated;") || line.startsWith("[search stopped:")) break;
    if (isSearchFileHeader(line) && !isSearchMatchLine(line)) {
      current = { file: line.replace(/^\.\//, ""), matches: 0 };
      files.push(current);
      continue;
    }
    if (isSearchMatchLine(line) && current) {
      current.matches++;
    }
  }
  return files.filter((f) => f.matches > 0);
}

export function countCorpusMatches(
  output: string,
  lineToKey: Map<number, string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (isEmptyRipgrepOutput(output)) return counts;
  for (const line of output.split("\n")) {
    const match = /^(\d+):/.exec(line);
    if (!match) continue;
    const key = lineToKey.get(Number(match[1]));
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function parseMemoryKey(key: string): { type: RipgrepMemoryType; id: number } | null {
  const match = /^(semantic|episodic):(\d+)$/.exec(key);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isFinite(id) || id < 1) return null;
  return { type: match[1] as RipgrepMemoryType, id };
}

/**
 * Ranked ripgrep hits mapped to memory ids. Empty when there is nothing
 * searchable or bundled rg is missing.
 */
export async function searchRipgrepChannel(
  options: RipgrepChannelOptions,
): Promise<RipgrepMemoryHit[]> {
  try {
    const needles = extractRipgrepNeedles(options.query);
    if (needles.length === 0) return [];
    const binary = resolveRipgrepBinary();
    if (!binary) return [];

    const scores = new Map<string, { score: number; source: RipgrepHitSource }>();
    const add = (key: string, delta: number, source: RipgrepHitSource) => {
      if (!Number.isFinite(delta) || delta <= 0) return;
      const parsed = parseMemoryKey(key);
      if (!parsed) return;
      if (parsed.type === "episodic" && options.includeEpisodic === false) return;
      const prev = scores.get(key);
      if (prev) {
        scores.set(key, {
          score: prev.score + delta,
          source: prev.source === "corpus" ? "corpus" : source,
        });
      } else {
        scores.set(key, { score: delta, source });
      }
    };

    await searchMemoryCorpus(options, needles, binary, add);

    if (options.searchWorkspace && options.workspaceDir) {
      await searchWorkspaceFiles(options, needles, binary, add);
    }

    const limit = Math.max(1, options.limit ?? 50);
    return [...scores.entries()]
      .map(([key, value]) => {
        const parsed = parseMemoryKey(key);
        if (!parsed) return null;
        return {
          type: parsed.type,
          id: parsed.id,
          score: value.score,
          source: value.source,
        };
      })
      .filter((hit): hit is RipgrepMemoryHit => hit != null)
      .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id - b.id)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function isEmptyRipgrepOutput(output: string): boolean {
  return (
    !output ||
    output === "No matches found" ||
    output.startsWith("Error:") ||
    output.startsWith("Search error:")
  );
}

function addScore(
  counts: Map<string, number>,
  weight: number,
  source: RipgrepHitSource,
  add: (key: string, delta: number, source: RipgrepHitSource) => void,
): void {
  for (const [key, raw] of counts) {
    const n = Math.min(RIPGREP_MATCH_CAP_PER_NEEDLE, raw);
    if (n > 0) add(key, weight * n, source);
  }
}

async function searchMemoryCorpus(
  options: RipgrepChannelOptions,
  needles: readonly RipgrepNeedle[],
  binary: string,
  add: (key: string, delta: number, source: RipgrepHitSource) => void,
): Promise<void> {
  const scoped = corpusNeedles(needles);
  if (scoped.length === 0) return;
  const rows = await loadCorpusRows(options, scoped);
  if (rows.length === 0) return;

  const tmp = mkdtempSync(path.join(tmpdir(), "knox-rg-mem-"));
  try {
    const { lineToKey } = writeCorpusFile(path.join(tmp, CORPUS_FILENAME), rows);
    for (const needle of scoped) {
      const output = await runRipgrepSearch(binary, tmp, needle.pattern, {
        path: CORPUS_FILENAME,
        maxResults: 80,
        contextLines: 0,
        fixedStrings: needle.fixedStrings,
        wholeWord: needle.wholeWord,
        caseSensitive: false,
      });
      addScore(
        countCorpusMatches(output, lineToKey),
        needleWeight(needle.kind),
        "corpus",
        add,
      );
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // already gone
    }
  }
}

async function searchWorkspaceFiles(
  options: RipgrepChannelOptions,
  needles: readonly RipgrepNeedle[],
  binary: string,
  add: (key: string, delta: number, source: RipgrepHitSource) => void,
): Promise<void> {
  const workspaceDir = options.workspaceDir;
  if (!workspaceDir) return;
  const fileScores = new Map<string, number>();
  for (const needle of workspaceNeedles(needles)) {
    const output = await searchWorkspaceWithRipgrep(
      [workspaceDir],
      needle.pattern,
      {
        maxResults: 40,
        contextLines: 0,
        fixedStrings: needle.fixedStrings,
        wholeWord: needle.wholeWord,
        caseSensitive: false,
      },
      binary,
    );
    for (const hit of parseRipgrepContentHits(output)) {
      const rel = normalizeRelPath(hit.file, workspaceDir);
      if (!rel) continue;
      fileScores.set(rel, (fileScores.get(rel) ?? 0) + hit.matches);
    }
  }

  const rankedFiles = [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, RIPGREP_FILE_HIT_CAP);
  if (rankedFiles.length === 0) return;

  const mapped = await memoriesForFilePaths(
    options,
    rankedFiles.map(([file]) => file),
  );
  const fileScore = new Map(rankedFiles);
  for (const [key, file] of mapped) {
    const matches = fileScore.get(file) ?? 1;
    add(key, RIPGREP_FILE_MAP_WEIGHT * Math.min(RIPGREP_MATCH_CAP_PER_NEEDLE, matches), "file");
  }
}

type CorpusRow = {
  type: RipgrepMemoryType;
  id: number;
  title?: string;
  content?: string;
  keywords?: string;
};

async function loadCorpusRows(
  options: RipgrepChannelOptions,
  needles: readonly RipgrepNeedle[],
): Promise<CorpusRow[]> {
  const semantic = await loadScopedCorpusRows(options, needles, "semantic");
  if (options.includeEpisodic === false) return semantic;
  const episodic = await loadScopedCorpusRows(options, needles, "episodic");
  return [...semantic, ...episodic];
}

async function loadScopedCorpusRows(
  options: RipgrepChannelOptions,
  needles: readonly RipgrepNeedle[],
  type: RipgrepMemoryType,
): Promise<CorpusRow[]> {
  const seen = new Set<number>();
  const rows: CorpusRow[] = [];
  let ftsFailed = false;
  for (const needle of needles) {
    const match = ftsMatchQueryForNeedle(needle);
    if (!match) continue;
    try {
      const hits = await ftsCorpusHits(options, type, match);
      for (const row of hits) {
        if (seen.has(row.id) || rows.length >= RIPGREP_CORPUS_ROW_CAP) continue;
        seen.add(row.id);
        rows.push(row);
      }
    } catch {
      ftsFailed = true;
      break;
    }
    if (rows.length >= RIPGREP_CORPUS_ROW_CAP) break;
  }
  if (rows.length > 0 || !ftsFailed) return rows;
  return recencyCorpusFallback(options, type);
}

async function ftsCorpusHits(
  options: RipgrepChannelOptions,
  type: RipgrepMemoryType,
  matchQuery: string,
): Promise<CorpusRow[]> {
  const fetch = Math.min(RIPGREP_CORPUS_ROW_CAP * FTS_CORPUS_OVERFETCH, 2_000);
  if (type === "semantic") {
    const extra: string[] = [
      "(s.expires_at IS NULL OR s.expires_at > datetime('now'))",
      queryScopeSql("semantic", "s"),
    ];
    const extraParams: unknown[] = [];
    if (options.category) {
      extra.push("s.category = ?");
      extraParams.push(options.category);
    }
    appendSessionScope(extra, extraParams, "s.source_session_id", options.projectSessionIds);
    extraParams.push(RIPGREP_CORPUS_ROW_CAP);
    const semantic = await options.db.all(
      `WITH hits AS (
         SELECT rowid AS id, -bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS rank
         FROM brain_semantic_fts
         WHERE brain_semantic_fts MATCH ?
         ORDER BY rank DESC
         LIMIT ?
       )
       SELECT s.id, s.title, s.content, s.keywords
       FROM hits JOIN brain_semantic s ON s.id = hits.id
       WHERE ${extra.join(" AND ")}
       ORDER BY hits.rank DESC
       LIMIT ?`,
      [matchQuery, fetch, ...extraParams],
    );
    return (semantic as Array<{
      id: number;
      title?: string;
      content?: string;
      keywords?: string;
    }>).map((row) => ({
      type: "semantic" as const,
      id: row.id,
      title: row.title,
      content: row.content,
      keywords: row.keywords,
    }));
  }

  const extra: string[] = [queryScopeSql("episodic", "e")];
  const extraParams: unknown[] = [];
  if (options.projectSessionIds !== undefined) {
    appendSessionScope(extra, extraParams, "e.session_id", options.projectSessionIds);
  } else if (options.sessionId) {
    extra.push("e.session_id = ?");
    extraParams.push(options.sessionId);
  }
  extraParams.push(RIPGREP_CORPUS_ROW_CAP);
  const episodic = await options.db.all(
    `WITH hits AS (
       SELECT rowid AS id, -bm25(brain_episodic_fts) AS rank
       FROM brain_episodic_fts
       WHERE brain_episodic_fts MATCH ?
       ORDER BY rank DESC
       LIMIT ?
     )
     SELECT e.id, e.content
     FROM hits JOIN brain_episodic e ON e.id = hits.id
     WHERE ${extra.join(" AND ")}
     ORDER BY hits.rank DESC
     LIMIT ?`,
    [matchQuery, fetch, ...extraParams],
  );
  return (episodic as Array<{ id: number; content?: string }>).map((row) => ({
    type: "episodic" as const,
    id: row.id,
    content: row.content,
  }));
}

/** Leftover FTS-less path for small tables only. Not a ranking over Ω(q). */
async function recencyCorpusFallback(
  options: RipgrepChannelOptions,
  type: RipgrepMemoryType,
): Promise<CorpusRow[]> {
  const table = type === "semantic" ? "brain_semantic" : "brain_episodic";
  const total = await options.db.get(`SELECT COUNT(*) AS n FROM ${table}`).catch(() => null);
  if (((total as { n?: number } | null)?.n ?? 0) > RIPGREP_CORPUS_LIKE_MAX_ROWS) return [];

  if (type === "semantic") {
    const extra: string[] = [
      "(expires_at IS NULL OR expires_at > datetime('now'))",
      queryScopeSql("semantic"),
    ];
    const extraParams: unknown[] = [];
    if (options.category) {
      extra.push("category = ?");
      extraParams.push(options.category);
    }
    appendSessionScope(extra, extraParams, "source_session_id", options.projectSessionIds);
    extraParams.push(RIPGREP_CORPUS_LIKE_MAX_ROWS);
    const semantic = await options.db.all(
      `SELECT id, title, content, keywords FROM brain_semantic
       WHERE ${extra.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
      extraParams,
    );
    return (semantic as Array<{
      id: number;
      title?: string;
      content?: string;
      keywords?: string;
    }>).map((row) => ({
      type: "semantic" as const,
      id: row.id,
      title: row.title,
      content: row.content,
      keywords: row.keywords,
    }));
  }

  const extra: string[] = [queryScopeSql("episodic")];
  const extraParams: unknown[] = [];
  if (options.projectSessionIds !== undefined) {
    appendSessionScope(extra, extraParams, "session_id", options.projectSessionIds);
  } else if (options.sessionId) {
    extra.push("session_id = ?");
    extraParams.push(options.sessionId);
  }
  extraParams.push(RIPGREP_CORPUS_LIKE_MAX_ROWS);
  const episodic = await options.db.all(
    `SELECT id, content FROM brain_episodic
     WHERE ${extra.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?`,
    extraParams,
  );
  return (episodic as Array<{ id: number; content?: string }>).map((row) => ({
    type: "episodic" as const,
    id: row.id,
    content: row.content,
  }));
}

function appendSessionScope(
  extra: string[],
  params: unknown[],
  column: string,
  sessionIds: string[] | undefined,
): void {
  if (sessionIds === undefined) return;
  if (sessionIds.length === 0) {
    extra.push("1 = 0");
    return;
  }
  extra.push(`${column} IN (${sessionIds.map(() => "?").join(",")})`);
  params.push(...sessionIds);
}

function writeCorpusFile(
  filePath: string,
  rows: readonly CorpusRow[],
): { lineToKey: Map<number, string> } {
  const lines: string[] = [];
  const lineToKey = new Map<number, string>();
  for (const row of rows) {
    const key = `${row.type}:${row.id}`;
    lines.push(`KNOXMEM\t${row.type}\t${row.id}`);
    const body = [row.title ?? "", row.content ?? "", row.keywords ?? ""];
    for (const line of body) {
      lines.push(line);
      lineToKey.set(lines.length, key);
    }
    lines.push("");
  }
  writeFileSync(filePath, lines.join("\n"), "utf8");
  return { lineToKey };
}

async function memoriesForFilePaths(
  options: RipgrepChannelOptions,
  files: string[],
): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();
  const variants = new Set<string>();
  for (const file of files) {
    const rel = normalizeRelPath(file, options.workspaceDir);
    if (rel) variants.add(rel);
    const base = path.posix.basename(rel || file);
    if (base && base.length >= 3) variants.add(base);
  }
  if (variants.size === 0) return mapped;

  const entityNames = await fileEntityNames(options.db, [...variants]);
  const needles = uniqueKeep([...variants, ...entityNames]).filter((n) => n.length >= 3);

  for (const file of files) {
    const rel = normalizeRelPath(file, options.workspaceDir) || file;
    const names = needles.filter((name) => filePathMatches(name, rel));
    if (names.length === 0) names.push(rel);
    const hits = await memoriesMentioning(options, names);
    for (const key of hits) {
      if (!mapped.has(key)) mapped.set(key, rel);
    }
  }
  return mapped;
}

async function fileEntityNames(db: DatabaseConnection, variants: string[]): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants.slice(0, RIPGREP_FILE_HIT_CAP)) {
    const exact = variant.toLowerCase();
    const safe = truncateSqliteLikePattern(variant);
    if (!safe) continue;
    const rows = await db.all(
      `SELECT name FROM brain_entities
       WHERE entity_type = 'file'
         AND (
           LOWER(REPLACE(name, '\\', '/')) = ?
           OR LOWER(REPLACE(name, '\\', '/')) LIKE ?
         )
       LIMIT 20`,
      [exact, `%${safe.toLowerCase()}%`],
    );
    for (const row of rows as Array<{ name?: string }>) {
      const name = (row.name ?? "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      if (!filePathMatches(name, variant) && !filePathMatches(variant, name)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

async function memoriesMentioning(
  options: RipgrepChannelOptions,
  names: string[],
): Promise<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const safe = truncateSqliteLikePattern(name);
    if (!safe) continue;
    const like = `%${safe.toLowerCase()}%`;
    const semExtra: string[] = [
      "(expires_at IS NULL OR expires_at > datetime('now'))",
      queryScopeSql("semantic"),
      "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
    ];
    const semParams: unknown[] = [like, like, like];
    if (options.category) {
      semExtra.push("category = ?");
      semParams.push(options.category);
    }
    appendSessionScope(semExtra, semParams, "source_session_id", options.projectSessionIds);
    semParams.push(RIPGREP_MEMORIES_PER_FILE);
    const semantic = await options.db.all(
      `SELECT id FROM brain_semantic
       WHERE ${semExtra.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
      semParams,
    );
    for (const row of semantic as Array<{ id: number }>) {
      const key = `semantic:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }

    if (options.includeEpisodic === false) continue;
    const epExtra: string[] = [queryScopeSql("episodic"), "LOWER(content) LIKE ?"];
    const epParams: unknown[] = [like];
    if (options.projectSessionIds !== undefined) {
      appendSessionScope(epExtra, epParams, "session_id", options.projectSessionIds);
    } else if (options.sessionId) {
      epExtra.push("session_id = ?");
      epParams.push(options.sessionId);
    }
    epParams.push(RIPGREP_MEMORIES_PER_FILE);
    const episodic = await options.db.all(
      `SELECT id FROM brain_episodic
       WHERE ${epExtra.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
      epParams,
    );
    for (const row of episodic as Array<{ id: number }>) {
      const key = `episodic:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function uniqueKeep(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}
