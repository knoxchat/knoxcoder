/**
 * Shared doom-loop detection (HL-11) for GUI chat, `/autonomous`, subagents, and eval.
 *
 * Rebuild/boot tools (`make`, QEMU, PTY read) fingerprint parsed gcc/oops errors so a
 * new compiler failure is not "stuck". Identical greps still trip the loop.
 */

import { BuiltInToolNames } from "../tools/builtIn";
import { diagnosticSignature } from "../tools/build/parseDiagnostics";
import { DEFAULT_DOOM_LOOP_THRESHOLD } from "../config/agentProfile";

export { DEFAULT_DOOM_LOOP_THRESHOLD };

/** Rebuild/boot oracles: identical args are expected across edit→make/QEMU cycles. */
export const REBUILD_TOOL_NAMES = new Set<string>([
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.Build,
  BuiltInToolNames.AwaitShell,
  BuiltInToolNames.Qemu,
  BuiltInToolNames.PtyRead,
]);

const MUTATING_TOOL_NAMES = new Set<string>([
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.CreateNewFile,
]);

export function isRebuildToolName(name: string): boolean {
  return REBUILD_TOOL_NAMES.has(name);
}

export type DoomLoopKind =
  | "repeat"
  | "fail_streak"
  | "same_strategy"
  | "oscillating_edit"
  | "oracle_stuck"
  | "repeat_question";

export interface DoomLoopHit {
  kind: DoomLoopKind;
  threshold: number;
  count: number;
  fingerprint?: string;
  toolName?: string;
}

/** Settled or pending tool call in conversation order. */
export interface DoomLoopCall {
  name: string;
  args?: unknown;
  output?: string;
  items?: Array<{ name?: string; icon?: string; content?: string }>;
  /** When false, counts toward a failure streak. */
  ok?: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** Canonical JSON for tool args so `{a:1,b:2}` matches `{b:2,a:1}`. */
export function canonicalizeToolArgs(args: unknown): string {
  if (args == null) {
    return "{}";
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) {
      return "{}";
    }
    try {
      return canonicalizeToolArgs(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (typeof args !== "object") {
    return String(args);
  }
  return stableStringify(args);
}

export function fingerprintToolCall(name: string, args?: unknown): string {
  return `${name}::${canonicalizeToolArgs(args)}`;
}

function callOutputText(call: DoomLoopCall): string {
  if (call.output) {
    return call.output;
  }
  return (call.items ?? []).map((item) => item.content ?? "").join("\n");
}

/** Rebuild fingerprint includes parsed error text so a new gcc error is not "the same make". */
export function fingerprintRebuildCall(call: DoomLoopCall): string {
  return `${fingerprintToolCall(call.name, call.args)}::${diagnosticSignature(callOutputText(call))}`;
}

export function isFailedToolOutput(
  items?: Array<{ name?: string; icon?: string; content?: string }> | null,
  ok?: boolean,
): boolean {
  if (ok === false) {
    return true;
  }
  return (items ?? []).some((item) => {
    if (item.name === "Tool Call Error" || item.icon === "problems") {
      return true;
    }
    const content = item.content ?? "";
    return content.includes('Tool call "') && content.includes(" failed");
  });
}

export function isFailedToolCall(call: DoomLoopCall): boolean {
  if (isFailedToolOutput(call.items, call.ok)) {
    return true;
  }
  const content = callOutputText(call);
  return content.includes('Tool call "') && content.includes(" failed");
}

/**
 * Identical-args repeats (except rebuild oracles), consecutive identical rebuilds
 * with the same error signature, or a streak of failed calls.
 */
export function detectDoomLoop(
  calls: DoomLoopCall[],
  options?: {
    threshold?: number | null;
  },
): DoomLoopHit | null {
  const threshold =
    options?.threshold === undefined
      ? DEFAULT_DOOM_LOOP_THRESHOLD
      : options.threshold;
  if (threshold === null || threshold < 2) {
    return null;
  }
  if (calls.length < threshold) {
    return detectRepeatQuestion(calls);
  }

  const counts = new Map<string, { count: number; name: string }>();
  for (const call of calls) {
    if (isRebuildToolName(call.name)) {
      continue;
    }
    const fingerprint = fingerprintToolCall(call.name, call.args);
    const current = counts.get(fingerprint);
    if (current) {
      current.count += 1;
    } else {
      counts.set(fingerprint, {
        count: 1,
        name: call.name,
      });
    }
  }
  for (const [fingerprint, info] of counts) {
    if (info.count >= threshold) {
      return {
        kind: "repeat",
        threshold,
        count: info.count,
        fingerprint,
        toolName: info.name,
      };
    }
  }

  const rebuildHit = detectRebuildRepeat(calls, threshold);
  if (rebuildHit) {
    return rebuildHit;
  }

  const tail = calls.slice(-threshold);
  if (tail.length >= threshold && tail.every((call) => isFailedToolCall(call))) {
    return {
      kind: "fail_streak",
      threshold,
      count: tail.length,
      toolName: tail[tail.length - 1]?.name,
    };
  }

  return (
    detectOscillatingEdit(calls) ??
    detectOracleStuck(calls, threshold) ??
    detectRepeatQuestion(calls)
  );
}

function argRecord(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

/** Resulting-content key for an edit (what the file should look like after). */
function editStateKey(call: DoomLoopCall): { file: string; state: string } | null {
  if (!MUTATING_TOOL_NAMES.has(call.name) || isFailedToolCall(call)) {
    return null;
  }
  const a = argRecord(call.args);
  if (call.name === BuiltInToolNames.ApplyPatch) {
    const patch = typeof a.patch === "string" ? a.patch : "";
    const files = [...patch.matchAll(/^\*\*\* Update File:\s*(.+)$/gm)].map((m) => m[1].trim());
    if (files.length === 0) {
      return null;
    }
    return { file: [...files].sort().join("+"), state: patch.trim() };
  }
  const file = String(a.filepath ?? a.path ?? a.file_path ?? "");
  if (!file) {
    return null;
  }
  const state = Array.isArray(a.edits)
    ? stableStringify((a.edits as Array<Record<string, unknown>>).map((e) => e?.new_string))
    : a.new_string ?? a.content ?? a.contents;
  if (state === undefined) {
    return null;
  }
  return { file, state: typeof state === "string" ? state : stableStringify(state) };
}

/** Same file flipping A,B,A,B (successful edits only). */
export function detectOscillatingEdit(calls: DoomLoopCall[]): DoomLoopHit | null {
  const perFile = new Map<string, string[]>();
  for (const call of calls) {
    const key = editStateKey(call);
    if (!key) {
      continue;
    }
    const seq = perFile.get(key.file) ?? [];
    seq.push(key.state);
    perFile.set(key.file, seq);
    if (seq.length >= 4) {
      const [a, b, c, d] = seq.slice(-4);
      if (a === c && b === d && a !== b) {
        return {
          kind: "oscillating_edit",
          threshold: 4,
          count: seq.length,
          fingerprint: `oscillating_edit::${key.file}`,
          toolName: call.name,
        };
      }
    }
  }
  return null;
}

/** Rebuild/test oracle keeps failing with the same diagnostics even across edits. */
export function detectOracleStuck(
  calls: DoomLoopCall[],
  threshold: number,
): DoomLoopHit | null {
  const seen = new Map<string, number>();
  for (const call of calls) {
    if (!isRebuildToolName(call.name)) {
      continue;
    }
    const sig = diagnosticSignature(callOutputText(call));
    if (sig === "ok") {
      continue;
    }
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    if (n >= threshold) {
      return {
        kind: "oracle_stuck",
        threshold,
        count: n,
        fingerprint: `oracle_stuck::${sig}`,
        toolName: call.name,
      };
    }
  }
  return null;
}

/** The same question put to the user twice. */
export function detectRepeatQuestion(calls: DoomLoopCall[]): DoomLoopHit | null {
  const seen = new Map<string, number>();
  for (const call of calls) {
    if (call.name !== BuiltInToolNames.AskUser) {
      continue;
    }
    const fp = canonicalizeToolArgs(call.args);
    const n = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, n);
    if (n >= 2) {
      return {
        kind: "repeat_question",
        threshold: 2,
        count: n,
        fingerprint: `repeat_question::${fp}`,
        toolName: call.name,
      };
    }
  }
  return null;
}

/** One-click "change strategy" prompt to inject as a user/system turn. */
export function buildChangeStrategyInstruction(hit: DoomLoopHit): string {
  return [
    `[Change strategy] ${describeHit(hit)}.`,
    "Stop repeating that approach. State in one sentence why it failed,",
    "then pick a materially different approach (different tool, file, or hypothesis) and continue.",
  ].join(" ");
}

function describeHit(hit: DoomLoopHit): string {
  switch (hit.kind) {
    case "repeat":
      return `repeated identical ${hit.toolName ?? "tool"} calls (${hit.count} times)`;
    case "same_strategy":
      return `repeating the same failed approach (${hit.toolName ?? "tools"}, ${hit.count} recent calls)`;
    case "oscillating_edit":
      return "the same file is being edited back and forth between two states";
    case "oracle_stuck":
      return `the build/test oracle failed with the same errors ${hit.count} times despite edits`;
    case "repeat_question":
      return "the same question was asked to the user again";
    default:
      return `a streak of ${hit.count} failed tool calls`;
  }
}

/**
 * Consecutive identical rebuilds (same args + same error signature) doom-loop.
 * A mutating edit or a *new* compiler error resets the streak.
 */
function detectRebuildRepeat(
  calls: DoomLoopCall[],
  threshold: number,
): DoomLoopHit | null {
  let streak = 0;
  let lastFp: string | undefined;
  let lastName: string | undefined;

  for (const call of calls) {
    if (MUTATING_TOOL_NAMES.has(call.name)) {
      streak = 0;
      lastFp = undefined;
      continue;
    }
    if (!isRebuildToolName(call.name)) {
      continue;
    }
    const fingerprint = fingerprintRebuildCall(call);
    if (fingerprint === lastFp) {
      streak += 1;
    } else {
      streak = 1;
      lastFp = fingerprint;
    }
    lastName = call.name;
    if (streak >= threshold) {
      return {
        kind: "repeat",
        threshold,
        count: streak,
        fingerprint,
        toolName: lastName,
      };
    }
  }

  return null;
}

export function buildDoomLoopSummaryInstruction(hit: DoomLoopHit): string {
  return [
    `[Agent doom loop] You appear stuck: ${describeHit(hit)}.`,
    "Do not call any tools.",
    "Summarize what you already learned, what failed, and the recommended next steps for the user.",
    "If you need a different approach, ask the user instead of retrying the same call.",
  ].join(" ");
}

export function buildDoomLoopBlockedMessage(hit: DoomLoopHit): string {
  return [
    `Blocked: doom-loop detection (${describeHit(hit)}).`,
    "This call was not executed.",
    "Stop retrying the same arguments. Summarize or try a different approach.",
  ].join(" ");
}
