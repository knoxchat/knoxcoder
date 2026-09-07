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

export type DoomLoopKind = "repeat" | "fail_streak";

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
    return null;
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

  return null;
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
  const what =
    hit.kind === "repeat"
      ? `repeated identical ${hit.toolName ?? "tool"} calls (${hit.count} times)`
      : `a streak of ${hit.count} failed tool calls`;
  return [
    `[Agent doom loop] You appear stuck: ${what}.`,
    "Do not call any tools.",
    "Summarize what you already learned, what failed, and the recommended next steps for the user.",
    "If you need a different approach, ask the user instead of retrying the same call.",
  ].join(" ");
}

export function buildDoomLoopBlockedMessage(hit: DoomLoopHit): string {
  const what =
    hit.kind === "repeat"
      ? `identical ${hit.toolName ?? "tool"} call repeated ${hit.count} times`
      : `${hit.count} consecutive tool failures`;
  return [
    `Blocked: doom-loop detection (${what}).`,
    "This call was not executed.",
    "Stop retrying the same arguments. Summarize or try a different approach.",
  ].join(" ");
}
