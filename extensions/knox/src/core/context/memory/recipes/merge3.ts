/**
 * Line-based diff and conservative 3-way merge (MC-35, MC-36). Pure, no I/O.
 *
 * `merge3(base, current, result)` keeps the user's edits (`current`) and applies the recipe's
 * edits (`result`). Any overlapping or touching edits are a conflict: we never guess.
 */

export interface Hunk {
  /** Replaces base lines [start, end) with `lines`. */
  start: number;
  end: number;
  lines: string[];
}

/** Above this many LCS cells we refuse to diff and treat the pair as fully changed. */
export const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

/** Hunks that turn `a` into `b`, or undefined when the inputs are too large to diff. */
export function diffHunks(a: string[], b: string[]): Hunk[] | undefined {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  if (A.length === 0 && B.length === 0) return [];
  if ((A.length + 1) * (B.length + 1) > MAX_DIFF_CELLS) return undefined;

  const w = B.length + 1;
  const dp = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | undefined;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = undefined;
  };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      flush();
      i++;
      j++;
    } else if (j < B.length && (i === A.length || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      cur ??= { start: head + i, end: head + i, lines: [] };
      cur.lines.push(B[j++]);
    } else {
      cur ??= { start: head + i, end: head + i, lines: [] };
      i++;
      cur.end = head + i;
    }
  }
  flush();
  return hunks;
}

export type Merge3Result = { ok: true; text: string } | { ok: false; reason: string };

export function merge3(base: string, current: string, result: string): Merge3Result {
  if (current === result) return { ok: true, text: result };
  if (current === base) return { ok: true, text: result };
  if (result === base) return { ok: true, text: current };
  const b = splitLines(base);
  const ha = diffHunks(b, splitLines(current));
  const hb = diffHunks(b, splitLines(result));
  if (!ha || !hb) return { ok: false, reason: "file too large to merge" };

  const out: string[] = [];
  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < ha.length || j < hb.length) {
    const a = ha[i];
    const r = hb[j];
    let h: Hunk;
    if (a && r && a.start <= r.end && r.start <= a.end) {
      const same = a.start === r.start && a.end === r.end && a.lines.join("\n") === r.lines.join("\n");
      if (!same) return { ok: false, reason: `conflicting edits near line ${Math.min(a.start, r.start) + 1}` };
      h = a;
      i++;
      j++;
    } else if (!r || (a && a.start < r.start)) {
      h = a!;
      i++;
    } else {
      h = r;
      j++;
    }
    out.push(...b.slice(pos, h.start), ...h.lines);
    pos = h.end;
  }
  out.push(...b.slice(pos));
  return { ok: true, text: out.join("\n") };
}

export interface LineDelta {
  added: number;
  removed: number;
}

export function lineDelta(before: string, after: string): LineDelta {
  const hunks = diffHunks(splitLines(before), splitLines(after));
  if (!hunks) return { added: splitLines(after).length, removed: splitLines(before).length };
  return hunks.reduce((d, h) => ({ added: d.added + h.lines.length, removed: d.removed + (h.end - h.start) }), { added: 0, removed: 0 });
}

/** Compact unified-style diff (no headers beyond the file name), capped for display. */
export function unifiedDiff(path: string, before: string | undefined, after: string | undefined, maxLines = 200): string {
  const a = splitLines(before ?? "");
  const b = splitLines(after ?? "");
  const hunks = diffHunks(a, b);
  const out = [`--- ${before === undefined ? "/dev/null" : `a/${path}`}`, `+++ ${after === undefined ? "/dev/null" : `b/${path}`}`];
  if (!hunks) {
    out.push("(file too large to diff)");
    return out.join("\n");
  }
  const CTX = 2;
  for (const h of hunks) {
    const s = Math.max(0, h.start - CTX);
    const e = Math.min(a.length, h.end + CTX);
    out.push(`@@ -${s + 1},${e - s} @@`);
    for (let k = s; k < h.start; k++) out.push(` ${a[k]}`);
    for (let k = h.start; k < h.end; k++) out.push(`-${a[k]}`);
    for (const l of h.lines) out.push(`+${l}`);
    for (let k = h.end; k < e; k++) out.push(` ${a[k]}`);
  }
  if (out.length > maxLines) return [...out.slice(0, maxLines), `… (${out.length - maxLines} more lines)`].join("\n");
  return out.join("\n");
}
