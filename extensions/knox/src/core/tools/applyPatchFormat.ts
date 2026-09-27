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
  return line.slice(prefix.length).trim();
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

/**
 * Parse a Codex-style apply_patch document into file operations.
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
  if (needle.length === 0) {
    return [];
  }
  const hits: number[] = [];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      hits.push(i);
    }
  }
  return hits;
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

export function applyHunksToContent(
  content: string,
  hunks: PatchHunk[],
  filepath: string,
): string {
  if (hunks.length === 0) {
    return content;
  }

  let { lines, trailingNl } = splitFileLines(content);

  for (const hunk of hunks) {
    const oldLines = hunkOldLines(hunk);
    const newLines = hunkNewLines(hunk);

    if (oldLines.length === 0) {
      if (hunk.header) {
        const hintHits = findSequence(lines, [hunk.header]);
        const at = hintHits[0] ?? -1;
        if (at >= 0) {
          lines.splice(at + 1, 0, ...newLines);
          continue;
        }
      }
      lines.push(...newLines);
      trailingNl = true;
      continue;
    }

    let hits = findSequence(lines, oldLines);
    if (hits.length > 1 && hunk.header) {
      const hintHits = findSequence(lines, [hunk.header]);
      if (hintHits.length > 0) {
        const hint = hintHits[0];
        const near = hits.filter((h) => h >= hint);
        if (near.length > 0) {
          hits = near;
        }
      }
    }

    if (hits.length === 0) {
      throw new Error(
        `Patch hunk did not match "${filepath}". Read the file and regenerate the hunk with exact context.`,
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `Patch hunk matched ${hits.length} times in "${filepath}". Add more unique context or an @@ locator.`,
      );
    }

    lines.splice(hits[0], oldLines.length, ...newLines);
  }

  return joinFileLines(lines, trailingNl);
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
