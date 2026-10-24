/**
 * Slot extraction (MC-16): find the parts of a recipe that vary between two
 * successful runs of the same kind of task (a component name, a package, a
 * path) so replay can later fill them in (MC-30/32).
 *
 * Pure and editor-free. The host supplies each run's intent text plus the
 * workspace-relative paths (and, optionally, file text) it produced. A varying
 * intent word only becomes a slot if it also shows up in that run's output;
 * otherwise it is just wording, not something replay would need to fill.
 */

import type { RecipeSlot } from "./types.js";

export interface SlotRun {
  intentText: string;
  /** Files the run wrote. `content` is optional; paths alone are enough for most slots. */
  files: readonly { path: string; content?: string }[];
}

export interface SlotPair {
  slot: RecipeSlot;
  /** The value in run A and in run B. */
  values: [string, string];
}

/** Words that name the thing a slot refers to. "create React component X" -> `componentName`. */
const NAMING_KEYWORDS = [
  "component", "hook", "class", "function", "service", "page", "module", "route", "model", "store",
  "controller", "endpoint", "test", "interface", "type", "util", "command", "table", "package", "dependency",
  "library",
];
const PACKAGE_KEYWORDS = new Set(["package", "dependency", "library", "install", "add"]);

const TOKEN_SPLIT = /[\s,;:!?()"'`]+/;

function tokenize(text: string): string[] {
  return text
    .split(TOKEN_SPLIT)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
    .filter(Boolean);
}

/**
 * Values replay would substitute into paths and files. Anything that could
 * traverse out of the project or reach a shell is refused here, at the source.
 */
export function isSafeSlotValue(value: string): boolean {
  if (!value || value.length > 120) return false;
  if (value.includes("..") || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/.test(value)) return false;
  return /^[A-Za-z0-9_@][A-Za-z0-9_@./-]*$/.test(value);
}

export interface SlotFill {
  /** Slot name → value taken from the message. */
  values: Record<string, string>;
  /** Slots that still need a value; exact replay is refused while this is > 0. */
  unfilled: number;
}

const IDENTIFIER_STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "in", "on", "and", "or", "please", "this", "that", "my", "new",
]);

function looksLikeName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(value) || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(value);
}

function uniquePush(out: string[], seen: Set<string>, value: string): void {
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(value);
}

/**
 * T5 / MC-32: a token is only a slot value when it is an obvious path, package,
 * or name — not every word in the sentence. Identifiers prefer the token after
 * a naming keyword ("component Button") over PascalCase verbs ("Create").
 */
function candidatesOfKind(text: string, kind: RecipeSlot["kind"]): string[] {
  const tokens = tokenize(text);
  const seen = new Set<string>();
  const out: string[] = [];
  if (kind === "identifier") {
    const after: string[] = [];
    const before: string[] = [];
    const shaped: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const value = tokens[i];
      const word = value.toLowerCase();
      if (NAMING_KEYWORDS.includes(word) && !PACKAGE_KEYWORDS.has(word)) {
        const nxt = tokens[i + 1];
        const prv = tokens[i - 1];
        if (nxt && isSafeSlotValue(nxt) && nxt.length > 1 && !IDENTIFIER_STOPWORDS.has(nxt.toLowerCase())) after.push(nxt);
        if (prv && isSafeSlotValue(prv) && prv.length > 1 && !IDENTIFIER_STOPWORDS.has(prv.toLowerCase())) before.push(prv);
      }
      if (looksLikeName(value) && isSafeSlotValue(value) && !IDENTIFIER_STOPWORDS.has(word)) shaped.push(value);
    }
    for (const value of [...after, ...before, ...shaped]) uniquePush(out, seen, value);
    return out;
  }
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i];
    if (!isSafeSlotValue(value)) continue;
    if (kind === "path") {
      if (value.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(value)) uniquePush(out, seen, value);
      continue;
    }
    if (kind === "package") {
      const neighbours = [tokens[i - 1], tokens[i + 1]].filter((w): w is string => !!w).map((w) => w.toLowerCase());
      if (value.includes("@") || neighbours.some((w) => PACKAGE_KEYWORDS.has(w))) uniquePush(out, seen, value);
      continue;
    }
    uniquePush(out, seen, value);
  }
  return out;
}

/**
 * Fill recipe slots from the user's message (MC-32). Exact replay is allowed
 * only when every slot can be filled with a value that also appears in the
 * captured intent (same path/identifier). A different path still refuses exact.
 */
export function fillSlotsFromMessage(
  slots: readonly RecipeSlot[],
  message: string,
  originalIntent = "",
): SlotFill {
  const values: Record<string, string> = {};
  if (!slots.length) return { values, unfilled: 0 };
  const used = new Set<string>();
  const originalByKind = new Map<RecipeSlot["kind"], string[]>();
  if (originalIntent) {
    for (const kind of ["identifier", "path", "package", "text"] as const) {
      originalByKind.set(
        kind,
        candidatesOfKind(originalIntent, kind).map((v) => v.toLowerCase()),
      );
    }
  }
  let unfilled = 0;
  for (const slot of slots) {
    const found = candidatesOfKind(message, slot.kind).find((value) => {
      const key = value.toLowerCase();
      if (used.has(key)) return false;
      if (!originalIntent) return true;
      return (originalByKind.get(slot.kind) ?? []).includes(key);
    });
    if (found) {
      used.add(found.toLowerCase());
      values[slot.name] = found;
    } else {
      unfilled++;
    }
  }
  return { values, unfilled };
}

/** Longest-common-subsequence diff over lowercased tokens: returns the mismatched gaps. */
function diffGaps(a: string[], b: string[]): { a: string[]; b: string[]; at: number }[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i].toLowerCase() === b[j].toLowerCase() ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const gaps: { a: string[]; b: string[]; at: number }[] = [];
  let i = 0;
  let j = 0;
  let cur: { a: string[]; b: string[]; at: number } | undefined;
  const flush = () => {
    if (cur) gaps.push(cur);
    cur = undefined;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i].toLowerCase() === b[j].toLowerCase()) {
      flush();
      i++;
      j++;
    } else {
      cur ??= { a: [], b: [], at: i };
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) cur.a.push(a[i++]);
      else cur.b.push(b[j++]);
    }
  }
  flush();
  return gaps;
}

function artifactText(run: SlotRun): string {
  return run.files.map((f) => `${f.path}\n${f.content ?? ""}`).join("\n").toLowerCase();
}

function slotKind(value: string, neighbours: string[]): RecipeSlot["kind"] {
  if (value.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(value)) return "path";
  // A noun like "component" beats a generic verb like "add".
  const names = neighbours.some((w) => NAMING_KEYWORDS.includes(w) && !PACKAGE_KEYWORDS.has(w));
  if (!names && neighbours.some((w) => PACKAGE_KEYWORDS.has(w))) return "package";
  return "identifier";
}

function slotName(kind: RecipeSlot["kind"], neighbours: string[]): string {
  if (kind === "path") return "targetPath";
  const keyword = neighbours.find((w) => NAMING_KEYWORDS.includes(w));
  if (keyword === "dependency" || keyword === "library") return "packageName";
  if (keyword) return `${keyword}Name`;
  return kind === "package" ? "packageName" : "name";
}

/**
 * Compare two successful runs and return the slots that vary between them.
 * Returns [] when nothing safe and confirmed by the output differs.
 */
export function extractSlots(runA: SlotRun, runB: SlotRun): SlotPair[] {
  const ta = tokenize(runA.intentText);
  const tb = tokenize(runB.intentText);
  const textA = artifactText(runA);
  const textB = artifactText(runB);

  const out: SlotPair[] = [];
  const usedNames = new Set<string>();
  const seenValues = new Set<string>();

  for (const gap of diffGaps(ta, tb)) {
    // Only same-size swaps are a substitution; insertions/deletions are wording changes.
    if (gap.a.length !== gap.b.length) continue;
    for (let k = 0; k < gap.a.length; k++) {
      const va = gap.a[k];
      const vb = gap.b[k];
      if (!isSafeSlotValue(va) || !isSafeSlotValue(vb)) continue;
      // Must appear in each run's own output, and the other value must not leak into it.
      if (!textA.includes(va.toLowerCase()) || !textB.includes(vb.toLowerCase())) continue;
      if (textA.includes(vb.toLowerCase()) || textB.includes(va.toLowerCase())) continue;
      const key = `${va.toLowerCase()}\0${vb.toLowerCase()}`;
      if (seenValues.has(key)) continue;
      seenValues.add(key);

      const idx = gap.at + k;
      const neighbours = [ta[idx - 2], ta[idx - 1], ta[idx + 1], ta[idx + 2]]
        .filter((w): w is string => !!w)
        .map((w) => w.toLowerCase());
      const kind = slotKind(va, neighbours);
      const base = slotName(kind, neighbours);
      let name = base;
      for (let n = 2; usedNames.has(name); n++) name = `${base}${n}`;
      usedNames.add(name);
      out.push({ slot: { name, kind }, values: [va, vb] });
    }
  }
  return out;
}
