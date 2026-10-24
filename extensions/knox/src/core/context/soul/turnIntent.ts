/**
 * MC-60 / MC-61: what the user asked for this turn, and a short label for the checkpoints it produced.
 *
 * Editor-free. The host calls `begin` at turn start, `attach` when a turn checkpoint is created, and
 * `finish` when the turn ends to get the ids to label. Labels are heuristic (intent + files touched),
 * so they cost no LLM call and never block a turn.
 */
import { redactSecrets } from "../../util/redactSecrets";

export const MAX_INTENT_CHARS = 280;
export const MAX_LABEL_CHARS = 80;
const MAX_TRACKED_SESSIONS = 50;

const LEADING_FILLER =
  /^(?:(?:hey|hi|hello|ok|okay|so|and|then)[,\s]+)*(?:(?:please|pls|kindly)[,\s]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+|i'd\s+like\s+(?:you\s+)?to\s+|help\s+me\s+(?:to\s+)?|let'?s\s+)?/i;

/** One line, redacted, capped. Empty when there is nothing usable. */
export function normalizeIntent(message: string | undefined): string {
  if (!message) return "";
  const oneLine = redactSecrets(message).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_INTENT_CHARS ? `${oneLine.slice(0, MAX_INTENT_CHARS - 1).trimEnd()}…` : oneLine;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** Longest shared directory of `files` (posix), or "" when they share none. */
export function commonDir(files: readonly string[]): string {
  const dirs = files.map((f) => f.replace(/\\/g, "/").split("/").slice(0, -1));
  if (dirs.length === 0) return "";
  let prefix = dirs[0];
  for (const d of dirs.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < d.length && prefix[i] === d[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.join("/");
}

export interface LabelInput {
  intent?: string;
  /** Files the turn's tools touched (workspace-relative). */
  files?: readonly string[];
}

/**
 * "Add JWT middleware · 3 files in src/auth". Falls back to the files alone when there is no intent,
 * and to "" when there is neither (the caller then keeps the original description).
 */
export function deriveCheckpointLabel(input: LabelInput): string {
  const files = [...new Set((input.files ?? []).map((f) => f.replace(/\\/g, "/")).filter(Boolean))];
  let head = normalizeIntent(input.intent).replace(LEADING_FILLER, "").replace(/[?.!\s]+$/, "");
  if (head) head = head[0].toUpperCase() + head.slice(1);

  let scope = "";
  if (files.length === 1) scope = files[0].split("/").pop() ?? "";
  else if (files.length > 1) {
    const dir = commonDir(files);
    scope = `${files.length} files${dir ? ` in ${dir}` : ""}`;
  }

  if (!head && !scope) return "";
  if (!head) return clip(`Edited ${scope}`, MAX_LABEL_CHARS);
  if (!scope) return clip(head, MAX_LABEL_CHARS);
  // Keep the scope intact; shorten the intent to fit around it.
  const room = MAX_LABEL_CHARS - scope.length - 3;
  return room >= 12 ? `${clip(head, room)} · ${scope}` : clip(head, MAX_LABEL_CHARS);
}

interface TurnRecord {
  intent: string;
  checkpointIds: string[];
}

/** Per-session record of the running turn. In memory only; a lost entry just means no label. */
export class TurnIntentRegistry {
  private readonly turns = new Map<string, TurnRecord>();

  begin(sessionId: string, message: string | undefined): string {
    if (!sessionId) return "";
    const intent = normalizeIntent(message);
    this.turns.delete(sessionId);
    this.turns.set(sessionId, { intent, checkpointIds: [] });
    while (this.turns.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.turns.keys().next().value;
      if (oldest === undefined) break;
      this.turns.delete(oldest);
    }
    return intent;
  }

  intentFor(sessionId: string | undefined): string | undefined {
    const intent = sessionId ? this.turns.get(sessionId)?.intent : undefined;
    return intent || undefined;
  }

  /** True while `begin` has run and `finish` has not. Omit `sessionId` to test any session. */
  isActive(sessionId?: string | null): boolean {
    if (sessionId) return this.turns.has(sessionId);
    return this.turns.size > 0;
  }

  attach(sessionId: string | undefined, checkpointId: string | undefined): void {
    if (!sessionId || !checkpointId) return;
    const turn = this.turns.get(sessionId);
    if (turn && !turn.checkpointIds.includes(checkpointId)) turn.checkpointIds.push(checkpointId);
  }

  /** Ends the turn: returns its intent and checkpoint ids once. */
  finish(sessionId: string): { intent: string; checkpointIds: string[] } | undefined {
    const turn = this.turns.get(sessionId);
    this.turns.delete(sessionId);
    return turn;
  }
}

export const turnIntents = new TurnIntentRegistry();
