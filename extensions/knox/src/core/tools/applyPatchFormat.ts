/**
 * Codex-style apply_patch format.
 *
 * *** Begin Patch
 * *** Add File: path/to/new.ts
 * +line
 * *** Update File: path/to/existing.ts
 * @@ optional locator
 *  context
 * -old
 * +new
 * *** Delete File: path/to/gone.ts
 * *** Update File: old/path.ts
 * *** Move to: new/path.ts
 * @@
 *  context
 * *** End Patch
 */

import { sanitizeToolFilePath } from "../util/toolFilePath";
import {
  applyEditsAgainstOriginal,
  detectLineEnding,
  FileEditMatchError,
  findClosestLines,
  findLineSequence,
  normalizeToLF,
  restoreLineEndings,
  splitBom,
} from "./fileEditCore";

export type PatchLineKind = " " | "+" | "-";

export interface PatchHunk {
  /** Text after `@@` used as a locator hint. */
  header: string;
  lines: Array<{ kind: PatchLineKind; text: string }>;
}

export type PatchOp =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: PatchHunk[] };

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File:";
const UPDATE = "*** Update File:";
const DELETE = "*** Delete File:";
const MOVE = "*** Move to:";

export function stripPatchFences(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const fence = text.match(/^```(?:patch|diff)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) {
    text = fence[1];
  }
  return text.trim();
}

function stripOpPrefix(line: string, prefix: string): string {
  return sanitizeToolFilePath(line.slice(prefix.length));
}

function isOpHeader(line: string): boolean {
  return (
    line.startsWith(ADD) ||
    line.startsWith(UPDATE) ||
    line.startsWith(DELETE) ||
    line === BEGIN ||
    line === END
  );
}

function isDiffMetaLine(raw: string): boolean {
  return (
    /^---\s+(a\/|b\/|\/dev\/null)/.test(raw) ||
    /^\+\+\+\s+(a\/|b\/|\/dev\/null)/.test(raw) ||
    /^---\s+\S/.test(raw) ||
    /^\+\+\+\s+\S/.test(raw) ||
    raw.startsWith("diff --git ") ||
    /^index [0-9a-f]+\.\./i.test(raw) ||
    raw.startsWith("new file mode ") ||
    raw.startsWith("deleted file mode ") ||
    raw.startsWith("old mode ") ||
    raw.startsWith("new mode ") ||
    raw.startsWith("similarity index ") ||
    raw.startsWith("rename from ") ||
    raw.startsWith("rename to ")
  );
}

function parseHunkLines(bodyLines: string[]): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | null = null;

  const flush = () => {
    if (current && current.lines.length > 0) {
      hunks.push(current);
    }
    current = null;
  };

  for (const raw of bodyLines) {
    if (isDiffMetaLine(raw)) {
      continue;
    }
    if (raw.startsWith("@@")) {
      flush();
      current = { header: raw.slice(2).trim(), lines: [] };
      continue;
    }
    if (!current) {
      current = { header: "", lines: [] };
    }
    if (raw.startsWith("+")) {
      current.lines.push({ kind: "+", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "-", text: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: " ", text: raw.slice(1) });
    } else if (raw === "\\ No newline at end of file") {
      continue;
    } else if (raw.trim() === "") {
      // Blank line without prefix — treat as context
      current.lines.push({ kind: " ", text: "" });
    } else {
      // Models sometimes omit the leading space on context lines
      current.lines.push({ kind: " ", text: raw });
    }
  }
  flush();
  return hunks;
}

function parseAddContent(bodyLines: string[]): string {
  const lines: string[] = [];
  for (const raw of bodyLines) {
    if (isDiffMetaLine(raw) || raw.startsWith("@@")) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push(raw.slice(1));
    } else if (raw.startsWith(" ")) {
      lines.push(raw.slice(1));
    } else if (raw === "\\ No newline at end of file") {
      return lines.join("\n");
    } else if (raw.startsWith("-")) {
      throw new Error(
        "Add File hunks cannot contain '-' lines. Use Update File to change existing content.",
      );
    } else {
      lines.push(raw);
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function stripUnifiedPath(raw: string): string {
  let path = raw.trim();
  const tab = path.indexOf("\t");
  if (tab !== -1) {
    path = path.slice(0, tab);
  }
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    path = path.slice(1, -1);
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  if (path === "/dev/null" || path === "dev/null") {
    return "/dev/null";
  }
  return sanitizeToolFilePath(path);
}

function looksLikeUnifiedDiff(text: string): boolean {
  const hasHunk = text.split("\n").some((line) => line.startsWith("@@"));
  return (
    /^diff --git /m.test(text) ||
    (hasHunk && (/^--- /m.test(text) || /^\+\+\+ /m.test(text)))
  );
}

function hasCodexOpHeader(text: string): boolean {
  return (
    text.includes("*** Update File:") ||
    text.includes("*** Add File:") ||
    text.includes("*** Delete File:")
  );
}

/**
 * Parse a unified diff (`--- a/file` / `+++ b/file` / `@@`) into patch ops.
 */
export function parseUnifiedDiff(text: string): PatchOp[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const ops: PatchOp[] = [];
  let i = 0;
  let oldPath: string | undefined;
  let current: PatchOp | null = null;
  let hunks: PatchHunk[] = [];
  let addLines: string[] = [];

  const flush = () => {
    if (!current) {
      return;
    }
    if (current.type === "update") {
      ops.push({ type: "update", path: current.path, hunks, moveTo: current.moveTo });
    } else if (current.type === "add") {
      const content =
        addLines.length > 0
          ? addLines.join("\n") + "\n"
          : hunks.length > 0
            ? hunkNewLines({ header: "", lines: hunks.flatMap((h) => h.lines) }).join("\n") + "\n"
            : "";
      ops.push({ type: "add", path: current.path, content });
    } else {
      ops.push({ type: "delete", path: current.path });
    }
    current = null;
    hunks = [];
    addLines = [];
    oldPath = undefined;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (
      line.startsWith("diff --git ") ||
      /^index [0-9a-f]+\.\./i.test(line) ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("old mode ") ||
      line.startsWith("new mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      i++;
      continue;
    }
    if (line.startsWith("--- ")) {
      flush();
      oldPath = stripUnifiedPath(line.slice(4));
      i++;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = stripUnifiedPath(line.slice(4));
      const oldNull = !oldPath || oldPath === "/dev/null";
      const newNull = newPath === "/dev/null";
      if (newNull && oldPath && oldPath !== "/dev/null") {
        current = { type: "delete", path: oldPath };
      } else if (oldNull && !newNull) {
        current = { type: "add", path: newPath, content: "" };
      } else {
        current = { type: "update", path: newNull ? oldPath ?? newPath : newPath, hunks: [] };
      }
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      if (!current) {
        throw new Error(`Invalid patch line: "${line}". Expected "*** Add File:", "*** Update File:", or "*** Delete File:".`);
      }
      const body: string[] = [line];
      i++;
      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("--- ") &&
        !lines[i].startsWith("diff --git ") &&
        lines[i].trim() !== END
      ) {
        body.push(lines[i]);
        i++;
      }
      const parsed = parseHunkLines(body);
      if (current.type === "update") {
        hunks.push(...parsed);
      } else if (current.type === "add") {
        addLines.push(
          ...parsed.flatMap((h) =>
            h.lines.filter((l) => l.kind === "+" || l.kind === " ").map((l) => l.text),
          ),
        );
      }
      continue;
    }
    i++;
  }
  flush();
  return ops;
}

/**
 * Parse a Codex-style apply_patch document into file operations.
 * Also accepts a unified diff when there are no `*** Update File:` headers.
 */
export function parseApplyPatch(raw: string): PatchOp[] {
  const text = stripPatchFences(raw);
  if (!text) {
    throw new Error("Patch is empty.");
  }

  const lines = text.split("\n");
  const ops: PatchOp[] = [];
  let i = 0;

  if (lines[0]?.trim() === BEGIN) {
    i = 1;
  }
  while (i < lines.length && lines[i].trim() === "") {
    i++;
  }

  const rest = lines.slice(i).join("\n");
  if (looksLikeUnifiedDiff(rest) && !hasCodexOpHeader(rest)) {
    const unified = parseUnifiedDiff(rest);
    if (unified.length === 0) {
      throw new Error("Patch contains no file operations.");
    }
    return unified;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === END || line.trim() === "") {
      i++;
      continue;
    }

    if (line.startsWith(ADD)) {
      const path = stripOpPrefix(line, ADD);
      if (!path) {
        throw new Error("Add File is missing a path.");
      }
      i++;
      const body: string[] = [];
      while (i < lines.length && !isOpHeader(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      ops.push({ type: "add", path, content: parseAddContent(body) });
      continue;
    }

    if (line.startsWith(DELETE)) {
      const path = stripOpPrefix(line, DELETE);
      if (!path) {
        throw new Error("Delete File is missing a path.");
      }
      i++;
      while (i < lines.length && !isOpHeader(lines[i])) {
        i++;
      }
      ops.push({ type: "delete", path });
      continue;
    }

    if (line.startsWith(UPDATE)) {
      const path = stripOpPrefix(line, UPDATE);
      if (!path) {
        throw new Error("Update File is missing a path.");
      }
      i++;
      let moveTo: string | undefined;
      if (i < lines.length && lines[i].startsWith(MOVE)) {
        moveTo = stripOpPrefix(lines[i], MOVE);
        if (!moveTo) {
          throw new Error(`Move to is missing a path for "${path}".`);
        }
        i++;
      }
      const body: string[] = [];
      while (i < lines.length && !isOpHeader(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      const hunks = parseHunkLines(body);
      ops.push({ type: "update", path, moveTo, hunks });
      continue;
    }

    throw new Error(
      `Invalid patch line: "${line}". Expected "*** Add File:", "*** Update File:", or "*** Delete File:".`,
    );
  }

  if (ops.length === 0) {
    throw new Error("Patch contains no file operations.");
  }
  return ops;
}

/** Unique file paths touched by a patch (source + move targets). */
export function extractPatchFilePaths(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }
  try {
    const ops = parseApplyPatch(raw);
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const op of ops) {
      const candidates =
        op.type === "update" && op.moveTo
          ? [op.path, op.moveTo]
          : [op.path];
      for (const p of candidates) {
        if (!seen.has(p)) {
          seen.add(p);
          paths.push(p);
        }
      }
    }
    return paths;
  } catch {
    return [];
  }
}

function hunkOldLines(hunk: PatchHunk): string[] {
  return hunk.lines.filter((l) => l.kind === " " || l.kind === "-").map((l) => l.text);
}

function hunkNewLines(hunk: PatchHunk): string[] {
  return hunk.lines.filter((l) => l.kind === " " || l.kind === "+").map((l) => l.text);
}

function findSequence(haystack: string[], needle: string[]): number[] {
  return findLineSequence(haystack, needle);
}

function splitFileLines(content: string): { lines: string[]; trailingNl: boolean } {
  if (content === "") {
    return { lines: [], trailingNl: false };
  }
  const trailingNl = content.endsWith("\n");
  const trimmed = trailingNl ? content.slice(0, -1) : content;
  return { lines: trimmed.split("\n"), trailingNl };
}

function joinFileLines(lines: string[], trailingNl: boolean): string {
  if (lines.length === 0) {
    return trailingNl ? "\n" : "";
  }
  return lines.join("\n") + (trailingNl ? "\n" : "");
}

function locateUnique(
  lines: string[],
  needle: string[],
  header: string,
): number[] {
  let hits = findSequence(lines, needle);
  if (hits.length > 1 && header) {
    const hintHits = findSequence(lines, [header]);
    if (hintHits.length > 0) {
      const hint = hintHits[0];
      const near = hits.filter((h) => h >= hint);
      if (near.length > 0) {
        hits = near;
      }
    }
  }
  return hits;
}

function alignNewLines(
  fileBlock: string[],
  oldLines: string[],
  newLines: string[],
): string[] {
  const idx = oldLines.findIndex((line) => line.trim());
  if (idx === -1) {
    return newLines;
  }
  const modelIndent = oldLines[idx].match(/^[ \t]*/)?.[0] ?? "";
  const fileIndent = fileBlock[idx]?.match(/^[ \t]*/)?.[0] ?? "";
  if (modelIndent === fileIndent) {
    return newLines;
  }
  return newLines.map((line) =>
    line.startsWith(modelIndent) ? fileIndent + line.slice(modelIndent.length) : line,
  );
}

function fuzzSides(hunk: PatchHunk): Array<{ old: string[]; next: string[] }> {
  const { lines } = hunk;
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].kind === " ") {
    start++;
  }
  while (end > start && lines[end - 1].kind === " ") {
    end--;
  }
  const out: Array<{ old: string[]; next: string[] }> = [];
  for (let dropL = 0; dropL <= start; dropL++) {
    for (let dropT = 0; dropT <= lines.length - end; dropT++) {
      if (dropL === 0 && dropT === 0) {
        continue;
      }
      const slice = lines.slice(dropL, lines.length - dropT);
      const old = slice.filter((l) => l.kind === " " || l.kind === "-").map((l) => l.text);
      const next = slice.filter((l) => l.kind === " " || l.kind === "+").map((l) => l.text);
      if (old.length === 0) {
        continue;
      }
      out.push({ old, next });
    }
  }
  return out;
}

function trySplice(
  lines: string[],
  trailingNl: boolean,
  needle: string[],
  replacement: string[],
  header: string,
): { next: string } | { many: number } | undefined {
  const hits = locateUnique(lines, needle, header);
  if (hits.length === 1) {
    const aligned = alignNewLines(
      lines.slice(hits[0], hits[0] + needle.length),
      needle,
      replacement,
    );
    const next = [...lines];
    next.splice(hits[0], needle.length, ...aligned);
    return { next: joinFileLines(next, trailingNl) };
  }
  if (hits.length > 1) {
    return { many: hits.length };
  }
  return undefined;
}

function tryJoinedReplacement(
  content: string,
  oldText: string,
  newText: string,
  filepath: string,
): string | undefined {
  if (!oldText) {
    return undefined;
  }
  const { bom, text } = splitBom(content);
  const ending = detectLineEnding(text);
  const normalized = normalizeToLF(text);
  try {
    const applied = applyEditsAgainstOriginal(
      normalized,
      [{ oldText, newText }],
      filepath,
    );
    return bom + restoreLineEndings(applied.next, ending);
  } catch (error) {
    if (error instanceof FileEditMatchError && error.kind === "not_unique") {
      throw new Error(
        `Patch hunk matched more than once in "${filepath}". Add more unique context or an @@ locator.`,
      );
    }
    return undefined;
  }
}

function hunkMissHint(content: string, oldLines: string[]): string {
  const closest = findClosestLines(content, oldLines.filter((l) => l.trim()).join("\n"));
  return closest.length ? `\nClosest lines currently in the file:\n${closest.join("\n")}` : "";
}

export function applyHunksToContent(
  content: string,
  hunks: PatchHunk[],
  filepath: string,
): string {
  if (hunks.length === 0) {
    return content;
  }

  let current = content;
  for (const hunk of hunks) {
    const oldLines = hunkOldLines(hunk);
    const newLines = hunkNewLines(hunk);
    const { lines, trailingNl } = splitFileLines(current);

    if (oldLines.length === 0) {
      if (hunk.header) {
        const hintHits = findSequence(lines, [hunk.header]);
        const at = hintHits[0] ?? -1;
        if (at >= 0) {
          lines.splice(at + 1, 0, ...newLines);
          current = joinFileLines(lines, trailingNl);
          continue;
        }
      }
      lines.push(...newLines);
      current = joinFileLines(lines, true);
      continue;
    }

    const exact = trySplice(lines, trailingNl, oldLines, newLines, hunk.header);
    if (exact && "next" in exact) {
      current = exact.next;
      continue;
    }
    if (exact && "many" in exact) {
      throw new Error(
        `Patch hunk matched ${exact.many} times in "${filepath}". Add more unique context or an @@ locator.`,
      );
    }

    let applied = false;
    for (const side of fuzzSides(hunk)) {
      const fuzzHit = trySplice(lines, trailingNl, side.old, side.next, hunk.header);
      if (fuzzHit && "next" in fuzzHit) {
        current = fuzzHit.next;
        applied = true;
        break;
      }
    }
    if (applied) {
      continue;
    }

    const joined = tryJoinedReplacement(
      current,
      oldLines.join("\n"),
      newLines.join("\n"),
      filepath,
    );
    if (joined !== undefined) {
      current = joined;
      continue;
    }

    const deleted = hunk.lines.filter((l) => l.kind === "-").map((l) => l.text);
    const added = hunk.lines.filter((l) => l.kind === "+").map((l) => l.text);
    if (deleted.length > 0) {
      const onlyDel = trySplice(lines, trailingNl, deleted, added, hunk.header);
      if (onlyDel && "next" in onlyDel) {
        current = onlyDel.next;
        continue;
      }
      const joinedDel = tryJoinedReplacement(
        current,
        deleted.join("\n"),
        added.join("\n"),
        filepath,
      );
      if (joinedDel !== undefined) {
        current = joinedDel;
        continue;
      }
    }

    throw new Error(
      `Patch hunk did not match "${filepath}". Read the file and regenerate the hunk with exact context.` +
        hunkMissHint(current, oldLines),
    );
  }

  return current;
}

export function formatOpsSummary(ops: PatchOp[]): string {
  return ops
    .map((op) => {
      if (op.type === "add") {
        return `A\t${op.path}`;
      }
      if (op.type === "delete") {
        return `D\t${op.path}`;
      }
      if (op.moveTo) {
        return `R\t${op.path} -> ${op.moveTo}`;
      }
      return `M\t${op.path}`;
    })
    .join("\n");
}

/** Unified-diff style preview of computed file changes. */
export function formatUnifiedDiffPreview(
  changes: Array<{
    path: string;
    kind: "add" | "delete" | "update" | "rename";
    before: string | null;
    after: string | null;
    moveTo?: string;
  }>,
): string {
  const blocks: string[] = [];
  for (const change of changes) {
    const label =
      change.kind === "rename" && change.moveTo
        ? `${change.path} -> ${change.moveTo}`
        : change.path;
    blocks.push(`--- ${change.kind === "add" ? "/dev/null" : change.path}`);
    blocks.push(
      `+++ ${change.kind === "delete" ? "/dev/null" : change.moveTo ?? change.path}`,
    );
    const beforeLines = (change.before ?? "").split("\n");
    const afterLines = (change.after ?? "").split("\n");
    // Keep the preview bounded; full contents still live on disk.
    const max = 80;
    if (change.kind === "add") {
      for (const line of afterLines.slice(0, max)) {
        blocks.push(`+${line}`);
      }
      if (afterLines.length > max) {
        blocks.push(`+... (${afterLines.length - max} more lines)`);
      }
    } else if (change.kind === "delete") {
      for (const line of beforeLines.slice(0, max)) {
        blocks.push(`-${line}`);
      }
      if (beforeLines.length > max) {
        blocks.push(`-... (${beforeLines.length - max} more lines)`);
      }
    } else {
      blocks.push(`@@ ${label} @@`);
      const shown = Math.min(beforeLines.length, max);
      for (let i = 0; i < shown; i++) {
        if (beforeLines[i] !== afterLines[i]) {
          blocks.push(`-${beforeLines[i]}`);
          if (i < afterLines.length) {
            blocks.push(`+${afterLines[i]}`);
          }
        } else {
          blocks.push(` ${beforeLines[i]}`);
        }
      }
      if (beforeLines.length > max || afterLines.length > max) {
        blocks.push(` ... (truncated)`);
      }
    }
    blocks.push("");
  }
  return blocks.join("\n").trimEnd();
}
