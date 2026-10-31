/**
 * MEM-17 / MEM-18 / MEM-39 — attribution log and `[mem:id]` cites.
 *
 * Injected semantic / episodic / recipe hints render a stable cite token.
 * After the turn, model output is parsed for those tokens and written to
 * `brain_attribution` (`injected`, `cited`, winning `channel`, inject `score`).
 *
 *   Helpful = cited and turn succeeded → h += 1, FSRS useful
 *   Next user turn corrects a cited memory → u += 1, FSRS harmful
 *   Recipe hint/stub cites use `mem_type='recipe'` and increment recipe leaf
 *   h/u (MEM-39). Replay ok/revert writes the same table (MEM-18).
 *   Injected-not-cited → calibration only (feeds θ, not S)
 *   Sleep φ₇ refits w_s and calibrated θ from this log (MEM-18)
 *   Product tool `attribute` writes the same helper (MEM-19)
 */

import { BrainStore } from "./BrainStore.js";
import { winningChannel, type FusionChannel } from "./memoryOutcomes.js";
import { contentWords } from "./RetrievalQuery.js";
import type { InjectedMemoryItem, PipelineInput } from "./types.js";

export const ATTRIBUTABLE_MEM_TYPES = ["semantic", "episodic", "recipe"] as const;
export type AttributableMemType = (typeof ATTRIBUTABLE_MEM_TYPES)[number];

export const MEMORY_CITE_RE = /\[mem:(semantic|episodic|recipe):([^\s\]]+)\]/gi;

export type TurnAttributionOutcome = "succeeded" | "failed" | "unknown";

export interface MemoryCite {
  type: AttributableMemType;
  mem_id: string;
  token: string;
  channel?: FusionChannel;
  score?: number;
}

export interface AttributionApplyCounts {
  helpful: number;
  unhelpful: number;
  pending: number;
}

export interface AttributionTurnResult {
  turn_id: string;
  injected: number;
  cited: number;
  rows: number;
  outcome: TurnAttributionOutcome;
  applied: AttributionApplyCounts;
  finalized_previous: AttributionApplyCounts;
}

const EMPTY_APPLIED: AttributionApplyCounts = { helpful: 0, unhelpful: 0, pending: 0 };
let attributeSeq = 0;

const CORRECTION_RE =
  /\b(that'?s (not|wrong|incorrect)|that is (not|wrong|incorrect)|you('re| are) wrong|incorrect memory|not (true|right|correct)|not how (we|it)|wrong memory|the memory is wrong|don'?t use (that|this)|\[mem:(semantic|episodic|recipe):[^\]]+\]\s+is (wrong|incorrect))\b/i;

const TOOL_FAIL_RE = /^- \S+ fail\b/m;
const TOOL_VERIFY_OK_RE =
  /^- \S*(?:test|tests|build|oracle|vitest|jest|pytest|compile)\S* ok\b/im;
const PROSE_PASS_RE = /\b(tests? passed|all tests pass|oracle passed|build succeeded)\b/i;
const PROSE_FAIL_RE = /\b(tests? failed|build failed|oracle failed)\b/i;

export function emptyAttributionResult(turnId = ""): AttributionTurnResult {
  return {
    turn_id: turnId,
    injected: 0,
    cited: 0,
    rows: 0,
    outcome: "unknown",
    applied: { ...EMPTY_APPLIED },
    finalized_previous: { ...EMPTY_APPLIED },
  };
}

export function generateTurnId(sessionId?: string | null, at: number = Date.now()): string {
  const session = sessionId?.trim() || "local";
  return `${session}:${at}`;
}

export function isAttributableMemType(value: string | null | undefined): value is AttributableMemType {
  return value === "semantic" || value === "episodic" || value === "recipe";
}

export function memoryCiteToken(type: AttributableMemType, id: string | number): string {
  return `[mem:${type}:${id}]`;
}

function validMemId(type: AttributableMemType, raw: string): string | null {
  const id = raw.trim();
  if (!id || id.length > 128) return null;
  if (type === "semantic" || type === "episodic") {
    return /^\d+$/.test(id) && Number(id) > 0 ? id : null;
  }
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

export function parseMemoryCites(text: string | null | undefined): MemoryCite[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: MemoryCite[] = [];
  const re = new RegExp(MEMORY_CITE_RE.source, MEMORY_CITE_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const type = match[1].toLowerCase() as AttributableMemType;
    const memId = validMemId(type, match[2] ?? "");
    if (!memId) continue;
    const token = memoryCiteToken(type, memId);
    const key = `${type}:${memId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, mem_id: memId, token });
  }
  return out;
}

export function attributableRef(
  item: Pick<InjectedMemoryItem, "kind" | "id" | "mem_id" | "cite">,
): MemoryCite | null {
  if (item.cite) {
    const parsed = parseMemoryCites(item.cite)[0];
    if (parsed) return parsed;
  }
  if (item.kind === "semantic" || item.kind === "episodic") {
    const id = typeof item.id === "number" && item.id > 0 ? item.id : Number(item.mem_id);
    if (id > 0) {
      return { type: item.kind, mem_id: String(id), token: memoryCiteToken(item.kind, id) };
    }
  }
  if (item.kind === "recipe") {
    const id = item.mem_id?.trim();
    if (id && validMemId("recipe", id)) {
      return { type: "recipe", mem_id: id, token: memoryCiteToken("recipe", id) };
    }
  }
  return null;
}

export function recipeInjectItem(
  recipe: { id: string; title?: string },
  reason = "recipe-hint",
): InjectedMemoryItem {
  const id = recipe.id.trim();
  return {
    id: null,
    kind: "recipe",
    mem_id: id,
    cite: memoryCiteToken("recipe", id),
    title: recipe.title?.trim() || id.slice(0, 8),
    reason,
  };
}

export function inferTurnOutcome(input: {
  turnSucceeded?: boolean;
  userCorrected?: boolean;
  assistantMessage?: string;
  toolSummary?: string;
}): TurnAttributionOutcome {
  if (input.userCorrected) return "failed";
  if (input.turnSucceeded === true) return "succeeded";
  if (input.turnSucceeded === false) return "failed";

  const tools = input.toolSummary ?? "";
  const assistant = input.assistantMessage ?? "";
  if (TOOL_FAIL_RE.test(tools) || PROSE_FAIL_RE.test(tools) || PROSE_FAIL_RE.test(assistant)) {
    return "failed";
  }
  if (TOOL_VERIFY_OK_RE.test(tools) || PROSE_PASS_RE.test(tools) || PROSE_PASS_RE.test(assistant)) {
    return "succeeded";
  }
  return "unknown";
}

export function looksLikeMemoryCorrection(text: string | null | undefined): boolean {
  return Boolean(text?.trim() && CORRECTION_RE.test(text));
}

function citeKey(type: string, memId: string): string {
  return `${type}:${memId}`;
}

function citeFromInjected(item: InjectedMemoryItem): MemoryCite | null {
  const cite = attributableRef(item);
  if (!cite) return null;
  const channel = item.channel ?? winningChannel(item) ?? undefined;
  return {
    ...cite,
    ...(channel ? { channel } : {}),
    ...(item.score != null ? { score: item.score } : {}),
  };
}

function collectInjected(input: PipelineInput, extra: InjectedMemoryItem[]): MemoryCite[] {
  const out = new Map<string, MemoryCite>();
  const add = (cite: MemoryCite | null) => {
    if (!cite) return;
    const key = citeKey(cite.type, cite.mem_id);
    const prev = out.get(key);
    if (!prev) {
      out.set(key, cite);
      return;
    }
    if (!prev.channel && cite.channel) prev.channel = cite.channel;
    if (prev.score == null && cite.score != null) prev.score = cite.score;
  };
  for (const item of extra) add(citeFromInjected(item));
  if (input.recipe_hint) {
    for (const cite of parseMemoryCites(input.recipe_hint)) add(cite);
  }
  return [...out.values()];
}

function helpfulForOutcome(
  injected: boolean,
  cited: boolean,
  outcome: TurnAttributionOutcome,
): boolean | null {
  if (!injected || !cited) return null;
  if (outcome === "succeeded") return true;
  if (outcome === "failed") return false;
  return null;
}

async function applyLeafOutcome(
  cite: MemoryCite,
  helpful: boolean,
): Promise<boolean> {
  if (cite.type === "recipe") {
    const row = await BrainStore.incrementRecipeUtilityCounts(
      cite.mem_id,
      helpful ? { helpful: 1 } : { unhelpful: 1 },
    );
    return Boolean(row);
  }
  const id = Number(cite.mem_id);
  if (!(id > 0)) return false;
  await BrainStore.incrementUtilityCounts(cite.type, id, helpful ? { helpful: 1 } : { unhelpful: 1 });
  await BrainStore.applyMemoryFsrs(cite.type, id, helpful ? "helpful" : "harmful");
  await BrainStore.applyMemoryTier(cite.type, id).catch(() => null);
  return true;
}

export function parseHelpfulFlag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const flag = value.trim().toLowerCase();
    if (flag === "true" || flag === "1" || flag === "yes" || flag === "helpful") return true;
    if (
      flag === "false" ||
      flag === "0" ||
      flag === "no" ||
      flag === "unhelpful" ||
      flag === "not_helpful" ||
      flag === "harmful"
    ) {
      return false;
    }
  }
  return null;
}

/**
 * Resolve a product-tool target. Numeric ids default to semantic (same as
 * pin/delete). Cite tokens and `type:id` keep the type the model saw.
 */
export function parseAttributeTarget(
  id: string | number | null | undefined,
  memType?: string | null,
): MemoryCite | null {
  if (id == null) return null;
  const raw = String(id).trim();
  if (!raw) return null;

  const fromCite = parseMemoryCites(raw)[0];
  if (fromCite) {
    if (memType && isAttributableMemType(memType) && memType !== fromCite.type) return null;
    return fromCite;
  }

  const typed = raw.match(/^(semantic|episodic|recipe):(.+)$/i);
  if (typed) {
    const type = typed[1].toLowerCase() as AttributableMemType;
    const memId = validMemId(type, typed[2] ?? "");
    if (!memId) return null;
    if (memType && isAttributableMemType(memType) && memType !== type) return null;
    return { type, mem_id: memId, token: memoryCiteToken(type, memId) };
  }

  const type = isAttributableMemType(memType) ? memType : "semantic";
  const memId = validMemId(type, raw);
  if (!memId) return null;
  return { type, mem_id: memId, token: memoryCiteToken(type, memId) };
}

async function memoryExists(cite: MemoryCite): Promise<boolean> {
  if (cite.type === "semantic") {
    return Boolean(await BrainStore.getSemanticById(Number(cite.mem_id)));
  }
  const db = await BrainStore.get();
  if (cite.type === "episodic") {
    const row = await db.get("SELECT id FROM brain_episodic WHERE id = ?", [Number(cite.mem_id)]);
    return Boolean(row);
  }
  try {
    const row = await db.get("SELECT id FROM brain_recipes WHERE id = ?", [cite.mem_id]);
    return Boolean(row);
  } catch {
    return false;
  }
}

export interface AttributeMemoryInput {
  id?: string | number | null;
  memory_id?: string | number | null;
  cite?: string | null;
  helpful?: unknown;
  mem_type?: string | null;
  session_id?: string | null;
  turn_id?: string | null;
}

export interface AttributeMemoryResult {
  ok: boolean;
  applied: "helpful" | "unhelpful" | null;
  cite: MemoryCite | null;
  message: string;
}

/**
 * MEM-19: model/GUI mark a memory helpful or not. Persists through
 * {@link persistAttributionDecision} so h/u + FSRS stay on the same path.
 */
export async function attributeMemory(input: AttributeMemoryInput): Promise<AttributeMemoryResult> {
  const helpful = parseHelpfulFlag(input.helpful);
  if (helpful == null) {
    return {
      ok: false,
      applied: null,
      cite: null,
      message: "attribute needs helpful: true or false.",
    };
  }
  const cite = parseAttributeTarget(
    input.id ?? input.memory_id ?? input.cite,
    input.mem_type,
  );
  if (!cite) {
    return {
      ok: false,
      applied: null,
      cite: null,
      message: "attribute needs id (memory number or [mem:type:id] cite).",
    };
  }
  if (!(await memoryExists(cite))) {
    return {
      ok: false,
      applied: null,
      cite,
      message: `Memory ${cite.token} not found.`,
    };
  }

  const sessionId = input.session_id?.trim() || null;
  const turnId =
    input.turn_id?.trim() ||
    `tool-attribute:${cite.type}:${cite.mem_id}:${Date.now()}:${++attributeSeq}`;
  const result = await persistAttributionDecision({
    turn_id: turnId,
    session_id: sessionId,
    cite,
    injected: true,
    cited: true,
    helpful,
  });
  await BrainStore.auditLog("attribution", cite.type, cite.mem_id, {
    via: "tool",
    helpful,
    applied: result.applied,
    turn_id: turnId,
  }).catch(() => {});

  const label = helpful ? "helpful" : "unhelpful";
  return {
    ok: true,
    applied: result.applied,
    cite,
    message: `Memory ${cite.token} marked ${label}.`,
  };
}

/**
 * MEM-39: mark an injected recipe hint/stub helpful or not. Same helper as
 * {@link attributeMemory}; recipe leaf h/u move, replay stats do not.
 */
export async function attributeRecipeHint(input: {
  recipeId: string;
  helpful: unknown;
  session_id?: string | null;
  turn_id?: string | null;
}): Promise<AttributeMemoryResult> {
  const id = input.recipeId.trim();
  return attributeMemory({
    id,
    mem_type: "recipe",
    helpful: input.helpful,
    session_id: input.session_id,
    turn_id: input.turn_id?.trim() || `recipe-hint:${id}:${Date.now()}:${++attributeSeq}`,
  });
}

/**
 * Write or update one attribution row and apply h/u + FSRS when the
 * helpful flag newly becomes 0 or 1.
 */
export async function persistAttributionDecision(input: {
  turn_id: string;
  session_id?: string | null;
  cite: MemoryCite;
  injected: boolean;
  cited: boolean;
  helpful?: boolean | null;
  channel?: FusionChannel | string | null;
  score?: number | null;
}): Promise<{ row_helpful: number | null; applied: "helpful" | "unhelpful" | null }> {
  const existing = (await BrainStore.listAttributionsForTurn(input.turn_id)).find(
    (row) => row.mem_type === input.cite.type && row.mem_id === input.cite.mem_id,
  );
  const prevHelpful = existing?.helpful ?? null;
  const row = await BrainStore.upsertAttribution({
    turn_id: input.turn_id,
    session_id: input.session_id,
    mem_type: input.cite.type,
    mem_id: input.cite.mem_id,
    injected: input.injected,
    cited: input.cited,
    helpful: input.helpful,
    channel: input.channel ?? input.cite.channel,
    score: input.score ?? input.cite.score,
  });
  const nextHelpful = row?.helpful ?? (input.helpful === true ? 1 : input.helpful === false ? 0 : null);
  if (nextHelpful === 1 && prevHelpful !== 1) {
    const applied = await applyLeafOutcome(input.cite, true);
    return { row_helpful: nextHelpful, applied: applied ? "helpful" : null };
  }
  if (nextHelpful === 0 && prevHelpful !== 0) {
    const applied = await applyLeafOutcome(input.cite, false);
    return { row_helpful: nextHelpful, applied: applied ? "unhelpful" : null };
  }
  return { row_helpful: nextHelpful, applied: null };
}

async function loadCiteText(
  cite: MemoryCite,
): Promise<{ title: string; content: string }> {
  if (cite.type === "semantic") {
    const row = await BrainStore.getSemanticById(Number(cite.mem_id));
    return { title: row?.title ?? "", content: row?.content ?? "" };
  }
  if (cite.type === "episodic") {
    const db = await BrainStore.get();
    const row = (await db.get(
      "SELECT content FROM brain_episodic WHERE id = ?",
      [Number(cite.mem_id)],
    )) as { content?: string } | undefined;
    return { title: "", content: row?.content ?? "" };
  }
  const db = await BrainStore.get();
  const row = (await db.get(
    "SELECT title, intent_text FROM brain_recipes WHERE id = ?",
    [cite.mem_id],
  )) as { title?: string; intent_text?: string } | undefined;
  return { title: row?.title ?? cite.mem_id, content: row?.intent_text ?? cite.mem_id };
}

function sharesContentWords(user: string, title: string, content: string): boolean {
  const query = new Set(contentWords(user));
  if (query.size === 0) return false;
  return contentWords(`${title} ${content}`).some((word) => query.has(word));
}

async function selectCorrectedCites(
  userMessage: string,
  cited: MemoryCite[],
  userCorrected: boolean,
): Promise<MemoryCite[]> {
  if (cited.length === 0) return [];
  const explicit = parseMemoryCites(userMessage);
  if (explicit.length > 0) {
    const wanted = new Set(explicit.map((c) => citeKey(c.type, c.mem_id)));
    return cited.filter((c) => wanted.has(citeKey(c.type, c.mem_id)));
  }
  if (userCorrected) return cited;
  const matched: MemoryCite[] = [];
  for (const cite of cited) {
    const text = await loadCiteText(cite);
    if (sharesContentWords(userMessage, text.title, text.content)) matched.push(cite);
  }
  return matched.length > 0 ? matched : cited;
}

export async function finalizePreviousAttribution(input: {
  session_id?: string | null;
  user_message?: string | null;
  user_corrected?: boolean;
  skip_turn_id?: string | null;
}): Promise<AttributionApplyCounts> {
  const applied = { ...EMPTY_APPLIED };
  const session = input.session_id?.trim();
  if (!session) return applied;

  const latest = await BrainStore.listLatestAttributedTurn(session);
  if (!latest || latest.turn_id === input.skip_turn_id) return applied;

  const cited = latest.rows
    .filter((row) => row.cited === 1 && row.injected === 1 && isAttributableMemType(row.mem_type))
    .map((row) => ({
      type: row.mem_type as AttributableMemType,
      mem_id: row.mem_id,
      token: memoryCiteToken(row.mem_type as AttributableMemType, row.mem_id),
    }));
  if (cited.length === 0) return applied;

  const userMessage = input.user_message ?? "";
  const corrected =
    input.user_corrected === true || looksLikeMemoryCorrection(userMessage);
  const targets = corrected
    ? await selectCorrectedCites(userMessage, cited, input.user_corrected === true)
    : cited.filter((cite) => {
        const row = latest.rows.find((r) => r.mem_type === cite.type && r.mem_id === cite.mem_id);
        return row?.helpful == null;
      });

  for (const cite of targets) {
    const row = latest.rows.find((r) => r.mem_type === cite.type && r.mem_id === cite.mem_id);
    if (!row) continue;
    if (!corrected && row.helpful != null) continue;
    const result = await persistAttributionDecision({
      turn_id: latest.turn_id,
      session_id: session,
      cite,
      injected: true,
      cited: true,
      helpful: corrected ? false : true,
    });
    if (result.applied === "helpful") applied.helpful += 1;
    else if (result.applied === "unhelpful") applied.unhelpful += 1;
    else if (result.row_helpful == null) applied.pending += 1;
  }
  return applied;
}

export async function recordTurnAttribution(
  input: PipelineInput,
  injectedItems: InjectedMemoryItem[] = [],
): Promise<AttributionTurnResult> {
  const sessionId = input.session_id ?? null;
  const assistant = [input.assistant_message, input.turn_content, input.message]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n");
  const citedList = parseMemoryCites(assistant);
  const injectedList = collectInjected(input, injectedItems);
  const outcome = inferTurnOutcome({
    turnSucceeded: input.turn_succeeded,
    userCorrected: input.user_corrected,
    assistantMessage: input.assistant_message ?? input.turn_content,
    toolSummary: input.tool_summary,
  });

  const turnId = input.turn_id?.trim() || generateTurnId(sessionId);
  const finalized = await finalizePreviousAttribution({
    session_id: sessionId,
    user_message: input.user_message,
    user_corrected: input.user_corrected,
    skip_turn_id: turnId,
  });

  const keys = new Set<string>([
    ...injectedList.map((c) => citeKey(c.type, c.mem_id)),
    ...citedList.map((c) => citeKey(c.type, c.mem_id)),
  ]);
  if (keys.size === 0) {
    return {
      ...emptyAttributionResult(turnId),
      outcome,
      finalized_previous: finalized,
    };
  }

  const injectedMap = new Map(injectedList.map((c) => [citeKey(c.type, c.mem_id), c]));
  const citedMap = new Map(citedList.map((c) => [citeKey(c.type, c.mem_id), c]));
  const applied = { ...EMPTY_APPLIED };

  for (const key of keys) {
    const cite = injectedMap.get(key) ?? citedMap.get(key);
    if (!cite) continue;
    const injected = injectedMap.has(key);
    const cited = citedMap.has(key);
    const helpful = helpfulForOutcome(injected, cited, outcome);
    const result = await persistAttributionDecision({
      turn_id: turnId,
      session_id: sessionId,
      cite,
      injected,
      cited,
      helpful,
    });
    if (result.applied === "helpful") applied.helpful += 1;
    else if (result.applied === "unhelpful") applied.unhelpful += 1;
    else if (result.row_helpful == null) applied.pending += 1;
  }

  await BrainStore.auditLog("attribution", "pipeline", sessionId, {
    turn_id: turnId,
    injected: injectedList.length,
    cited: citedList.length,
    outcome,
    applied,
    finalized_previous: finalized,
  }).catch(() => {});

  return {
    turn_id: turnId,
    injected: injectedList.length,
    cited: citedList.length,
    rows: keys.size,
    outcome,
    applied,
    finalized_previous: finalized,
  };
}

export const Attribution = {
  ATTRIBUTABLE_MEM_TYPES,
  MEMORY_CITE_RE,
  emptyAttributionResult,
  generateTurnId,
  isAttributableMemType,
  memoryCiteToken,
  parseMemoryCites,
  parseHelpfulFlag,
  parseAttributeTarget,
  attributeMemory,
  attributeRecipeHint,
  attributableRef,
  recipeInjectItem,
  inferTurnOutcome,
  looksLikeMemoryCorrection,
  persistAttributionDecision,
  finalizePreviousAttribution,
  recordTurnAttribution,
};
