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

import { isSafeRelPath } from "./preconditions.js";
import type { Recipe, RecipeSlot, RecipeStep } from "./types.js";

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

export interface SlotFillExtra {
  /** Open editors, @-mentioned files, recently edited paths. */
  paths?: readonly string[];
  /** Selection text and basenames of focused files. */
  identifiers?: readonly string[];
  packages?: readonly string[];
}

export interface FillSlotsOptions {
  extra?: SlotFillExtra;
  /** Prefill when the message has no candidate (shown on the ask card). */
  defaults?: Record<string, string>;
}

export interface SlotFill {
  /** Slot name → value taken from the message, extras, or defaults. */
  values: Record<string, string>;
  /** Slots that still need a value; exact replay is refused while this is > 0. */
  unfilled: number;
  /** How many values came from the chat message itself. */
  fromMessage: number;
  /** Values inferred from extras / defaults (ask before applying). */
  guessed: Record<string, string>;
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
      const word = value.toLowerCase();
      if (PACKAGE_KEYWORDS.has(word)) continue;
      const neighbours = [tokens[i - 1], tokens[i + 1]].filter((w): w is string => !!w).map((w) => w.toLowerCase());
      if (value.includes("@") || neighbours.some((w) => PACKAGE_KEYWORDS.has(w))) uniquePush(out, seen, value);
      continue;
    }
    uniquePush(out, seen, value);
  }
  return out;
}

/** Candidates of this kind in `text` (paths, identifiers, packages). */
export function slotCandidates(text: string, kind: RecipeSlot["kind"]): string[] {
  return candidatesOfKind(text, kind);
}

function extraOfKind(extra: SlotFillExtra | undefined, kind: RecipeSlot["kind"]): string[] {
  if (!extra) return [];
  if (kind === "path") return [...(extra.paths ?? [])];
  if (kind === "package") return [...(extra.packages ?? [])];
  const names = [...(extra.identifiers ?? [])];
  for (const p of extra.paths ?? []) {
    const base = p.split("/").pop()?.replace(/\.[A-Za-z0-9]{1,8}$/, "");
    if (base) names.push(base);
  }
  return names;
}

/**
 * Fill recipe slots from the new message (P1.5). A different path / name is
 * the point of parameterized exact: values need not appear in the captured
 * intent. Each value must be `isSafeSlotValue`. Unfilled slots refuse exact.
 */
export function fillSlotsFromMessage(
  slots: readonly RecipeSlot[],
  message: string,
  opts: FillSlotsOptions | string = {},
): SlotFill {
  const options: FillSlotsOptions = typeof opts === "string" ? {} : opts;
  const values: Record<string, string> = {};
  const guessed: Record<string, string> = {};
  if (!slots.length) return { values, unfilled: 0, fromMessage: 0, guessed };
  const used = new Set<string>();
  const text = message.replace(/(^|[\s])@/g, "$1");
  let unfilled = 0;
  let fromMessage = 0;
  for (const slot of slots) {
    const found = candidatesOfKind(text, slot.kind).find((value) => !used.has(value.toLowerCase()));
    if (found) {
      used.add(found.toLowerCase());
      values[slot.name] = found;
      fromMessage++;
      continue;
    }
    const extraFound = extraOfKind(options.extra, slot.kind).find(
      (value) => isSafeSlotValue(value) && !used.has(value.toLowerCase()),
    );
    const fallback = extraFound ?? options.defaults?.[slot.name];
    if (fallback && isSafeSlotValue(fallback) && !used.has(fallback.toLowerCase())) {
      used.add(fallback.toLowerCase());
      values[slot.name] = fallback;
      guessed[slot.name] = fallback;
    } else {
      unfilled++;
    }
  }
  return { values, unfilled, fromMessage, guessed };
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Identifier / package tokens only: do not replace a prefix of a longer name. */
function replaceToken(text: string, from: string, to: string, kind: RecipeSlot["kind"]): string {
  if (!from || from === to) return text;
  if (kind === "path") return text.split(from).join(to);
  return text.replace(new RegExp(`(?<![A-Za-z0-9_$@])${escapeRegExp(from)}(?![A-Za-z0-9_])`, "g"), to);
}

function capturedFrom(recipe: Recipe, slot: RecipeSlot, haystack: string): string | undefined {
  const owned = recipe.slotValues?.[slot.name];
  if (owned && haystack.includes(owned)) return owned;
  for (const ex of slot.examples ?? []) {
    if (haystack.includes(ex)) return ex;
  }
  return owned;
}

export type ApplySlotsResult =
  | { ok: true; recipe: Recipe; merged: Map<string, string>; values: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Substitute filled slot values into step paths and file text, then hand the
 * in-memory result to `replayExact({ merged })`. Refuses traversal, absolute
 * paths, and shell-bearing values.
 */
export function applySlots(
  recipe: Recipe,
  values: Record<string, string>,
  contents: ReadonlyMap<string, string>,
): ApplySlotsResult {
  if (recipe.slots.length === 0) {
    return { ok: true, recipe, merged: new Map(contents), values: {} };
  }
  for (const [name, value] of Object.entries(values)) {
    if (!recipe.slots.some((s) => s.name === name)) continue;
    if (!isSafeSlotValue(value)) return { ok: false, reason: `unsafe slot value for ${name}` };
  }
  const missing = recipe.slots.filter((s) => !values[s.name]);
  if (missing.length) return { ok: false, reason: `unfilled slots: ${missing.map((s) => s.name).join(", ")}` };

  const haystack = [
    ...recipe.steps.map((s) => s.path ?? s.command ?? ""),
    ...contents.values(),
    recipe.intentText,
  ].join("\n");
  const replacements: { name: string; kind: RecipeSlot["kind"]; from: string; to: string }[] = [];
  for (const slot of recipe.slots) {
    const to = values[slot.name];
    const from = capturedFrom(recipe, slot, haystack);
    if (!from) return { ok: false, reason: `no captured value for slot ${slot.name}` };
    if (!isSafeSlotValue(from) || !isSafeSlotValue(to)) {
      return { ok: false, reason: `unsafe slot value for ${slot.name}` };
    }
    replacements.push({ name: slot.name, kind: slot.kind, from, to });
  }
  replacements.sort((a, b) => b.from.length - a.from.length);

  const identical = replacements.every((r) => r.from === r.to);
  if (identical) return { ok: true, recipe, merged: new Map(contents), values };

  const steps: RecipeStep[] = [];
  const merged = new Map<string, string>();
  for (const step of recipe.steps) {
    if (step.kind === "command") {
      steps.push(step);
      continue;
    }
    let path = step.path ?? "";
    for (const r of replacements) path = path.split(r.from).join(r.to);
    if (!isSafeRelPath(path)) return { ok: false, reason: `substituted path is not inside the workspace: ${path}` };
    const next: RecipeStep = { ...step, path };
    if (path !== step.path) {
      delete next.baseBlobHash;
    }
    steps.push(next);
    const original = step.path ? contents.get(step.path) : undefined;
    if (step.kind === "write_file") {
      if (original === undefined) return { ok: false, reason: `no contents for ${step.path}` };
      if (original.includes("\0")) return { ok: false, reason: `binary file cannot be slot-substituted: ${step.path}` };
      let text = original;
      for (const r of replacements) text = replaceToken(text, r.from, r.to, r.kind);
      merged.set(path, text);
    }
  }

  const preconditions = recipe.preconditions.map((p) => {
    let value = p.value;
    for (const r of replacements) value = value.split(r.from).join(r.to);
    return { ...p, value };
  });

  return {
    ok: true,
    recipe: { ...recipe, steps, preconditions },
    merged,
    values,
  };
}
