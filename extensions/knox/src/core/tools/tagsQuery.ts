/**
 * ctags / cscope fallback when clangd is not ready (HL-26).
 *
 * Does not ship exuberant-ctags. If `tags` / `TAGS` / `cscope.out` exists
 * in the workspace, query it. Documented workflow: `make tags`.
 */

import type { IDE } from "..";
import { joinPathsToUri } from "../util/uri";

export const TAGS_FILENAMES = ["tags", "TAGS"] as const;
export const CSCOPE_FILENAME = "cscope.out";

const MAX_TAG_HITS = 50;

export interface TagHit {
  name: string;
  file: string;
  address: string;
  kind?: string;
}

function isMetaLine(line: string): boolean {
  return line.startsWith("!_");
}

/** Parse exuberant / universal ctags (tab-separated). */
export function parseCtags(contents: string): TagHit[] {
  const hits: TagHit[] = [];
  for (const raw of contents.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || isMetaLine(line)) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 2) {
      continue;
    }
    const name = parts[0];
    const file = parts[1];
    const address = (parts[2] ?? "").replace(/;"\s*$/, "");
    let kind: string | undefined;
    for (const extra of parts.slice(3)) {
      if (/^[a-zA-Z]$/.test(extra) || extra.startsWith("kind:")) {
        kind = extra.replace(/^kind:/, "");
        break;
      }
    }
    if (name && file) {
      hits.push({ name, file, address, kind });
    }
  }
  return hits;
}

export function queryParsedTags(tags: TagHit[], query: string): TagHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const exact: TagHit[] = [];
  const prefix: TagHit[] = [];
  const lower = q.toLowerCase();
  for (const hit of tags) {
    if (hit.name === q) {
      exact.push(hit);
    } else if (hit.name.toLowerCase().startsWith(lower)) {
      prefix.push(hit);
    }
    if (exact.length + prefix.length >= MAX_TAG_HITS) {
      break;
    }
  }
  return [...exact, ...prefix].slice(0, MAX_TAG_HITS);
}

export function formatTagHits(query: string, hits: TagHit[]): string {
  if (hits.length === 0) {
    return `No tags matches for ${query}. Generate with \`make tags\` (exuberant-ctags / universal-ctags).`;
  }
  const lines = hits.map((hit) => {
    const kind = hit.kind ? ` [${hit.kind}]` : "";
    return `${hit.name}${kind}\t${hit.file}\t${hit.address}`;
  });
  return [
    `Resolved via tags (LSP unavailable or empty). ${hits.length} hit(s) for "${query}".`,
    `Regenerate with \`make tags\` if this is stale.`,
    ...lines,
  ].join("\n");
}

export async function findTagsFileUri(ide: IDE): Promise<string | undefined> {
  const dirs = await ide.getWorkspaceDirs();
  for (const dir of dirs) {
    for (const name of TAGS_FILENAMES) {
      const uri = joinPathsToUri(dir, name);
      try {
        if (await ide.fileExists(uri)) {
          return uri;
        }
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

export async function findCscopeUri(ide: IDE): Promise<string | undefined> {
  const dirs = await ide.getWorkspaceDirs();
  for (const dir of dirs) {
    const uri = joinPathsToUri(dir, CSCOPE_FILENAME);
    try {
      if (await ide.fileExists(uri)) {
        return uri;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

export async function queryTagsFile(
  ide: IDE,
  query: string,
): Promise<string | undefined> {
  const uri = await findTagsFileUri(ide);
  if (!uri) {
    return undefined;
  }
  let contents: string;
  try {
    contents = await ide.readFile(uri);
  } catch {
    return undefined;
  }
  const hits = queryParsedTags(parseCtags(contents), query);
  if (hits.length === 0) {
    return undefined;
  }
  return formatTagHits(query, hits);
}

/**
 * Best-effort cscope line-oriented query (`cscope -d -L1`). Returns undefined
 * when cscope is missing or the db cannot be read. Does not require cscope
 * in the VSIX.
 */
export async function queryCscope(
  ide: IDE,
  query: string,
): Promise<string | undefined> {
  const db = await findCscopeUri(ide);
  if (!db || typeof ide.subprocess !== "function") {
    return undefined;
  }
  const q = query.trim();
  if (!q) {
    return undefined;
  }
  try {
    const cwd = db.replace(/\/cscope\.out$/, "").replace(/^file:\/\//, "");
    const [stdout, stderr] = await ide.subprocess(
      `cscope -d -L1 ${JSON.stringify(q)}`,
      cwd,
    );
    const text = (stdout ?? "").trim();
    if (!text) {
      return undefined;
    }
    return [
      `Resolved via cscope.out (LSP unavailable or empty).`,
      text,
      stderr?.trim() ? `stderr:\n${stderr.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return undefined;
  }
}

export async function queryWorkspaceTagsOrCscope(
  ide: IDE,
  query: string,
): Promise<string | undefined> {
  const fromTags = await queryTagsFile(ide, query);
  if (fromTags) {
    return fromTags;
  }
  return queryCscope(ide, query);
}
