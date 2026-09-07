/**
 * Extract development-loop state so compaction cannot drop the compile
 * oracle, plan, or live jobs (HL-16 / HL-17).
 */

import { ChatMessage } from "../index.js";
import { renderChatMessage } from "../util/messageContent.js";
import {
  formatBuildDiagnostics,
  parseBuildOutput,
  type ParsedBuildOutput,
} from "../tools/build/parseDiagnostics.js";
import { formatOops, parseOops } from "../tools/build/parseOops.js";
import {
  formatQemuMonitor,
  parseQemuMonitor,
} from "../tools/build/parseQemuMonitor.js";
import { formatPlanInject, TASK_EXECUTION_PLAN_MARKER } from "../tools/planStore.js";

export const DEVELOPMENT_LOOP_STATE_MARKER = "## Development Loop State";
export const LAST_BUILD_ERRORS_MARKER = "Last Build Errors";

const VERIFY_COMMAND_RE =
  /(?:knoxchat\.)?verifyCommand\s*[:=]\s*[`"']?([^\s`"'\n]+(?:\s+[^\s`"'\n]+)*)/i;
const JOB_ID_RE = /\bjob_id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/gi;
const FAILING_TEST_RE =
  /(?:FAIL(?:ED)?|not ok)\s*:?\s+([A-Za-z0-9_./:-]+)/i;
const CC_LINE_RE = /^\s*CC\b/;

export interface DevelopmentLoopState {
  verifyCommand?: string;
  buildSummary?: string;
  buildErrors: string[];
  jobIds: string[];
  sessions: string[];
  failingTest?: string;
  plan?: string;
  ccFileCount: number;
  oops?: string;
  monitor?: string;
}

export function isDevelopmentLoopStateContent(text: string): boolean {
  return (
    text.includes(DEVELOPMENT_LOOP_STATE_MARKER) ||
    text.includes(LAST_BUILD_ERRORS_MARKER)
  );
}

function uniquePush(list: string[], value: string, cap: number): void {
  const trimmed = value.trim();
  if (!trimmed || list.includes(trimmed) || list.length >= cap) {
    return;
  }
  list.push(trimmed);
}

function collectText(messages: ChatMessage[]): string {
  return messages.map((message) => renderChatMessage(message)).join("\n");
}

function extractVerifyCommand(text: string): string | undefined {
  const match = text.match(VERIFY_COMMAND_RE);
  const command = match?.[1]?.trim();
  return command || undefined;
}

function extractJobIds(text: string): string[] {
  const ids: string[] = [];
  JOB_ID_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JOB_ID_RE.exec(text)) !== null) {
    uniquePush(ids, match[1], 12);
  }
  return ids;
}

function extractSessions(text: string): string[] {
  const sessions: string[] = [];
  const qemu = text.match(
    /qemu-system-[\w-]+[^\n]{0,160}/i,
  );
  if (qemu) {
    uniquePush(sessions, `QEMU ${qemu[0].trim().slice(0, 160)}`, 4);
  }
  const gdb = text.match(
    /\b(?:gdb|kgdb)(?:stub)?[^\n]{0,120}/i,
  );
  if (gdb && /gdb/i.test(gdb[0])) {
    uniquePush(sessions, `GDB ${gdb[0].trim().slice(0, 120)}`, 4);
  }
  return sessions;
}

function extractPlan(text: string): string | undefined {
  const idx = text.lastIndexOf(TASK_EXECUTION_PLAN_MARKER);
  if (idx < 0) {
    return undefined;
  }
  const slice = text.slice(idx, idx + 4000);
  const lines = slice.split(/\r?\n/).slice(0, 40);
  return lines.join("\n").trim() || undefined;
}

function extractFailingTest(text: string): string | undefined {
  const match = text.match(FAILING_TEST_RE);
  const name = match?.[1]?.trim();
  if (!name || name.length < 3) {
    return undefined;
  }
  return name;
}

function countCcLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => CC_LINE_RE.test(line)).length;
}

function buildErrorLines(parsed: ParsedBuildOutput, cap = 12): string[] {
  return parsed.errors.slice(0, cap).map((item) => {
    const loc = item.file
      ? item.line
        ? `${item.file}:${item.line}`
        : item.file
      : item.kind;
    return `${loc}: ${item.message}`;
  });
}

/**
 * Pull compile/test/job/plan facts from a conversation so they can be
 * re-injected as protected system content.
 */
export function extractDevelopmentLoopState(
  messages: ChatMessage[],
  sessionId?: string | null,
): DevelopmentLoopState {
  const text = collectText(messages);
  const parsed = parseBuildOutput(text);
  const storedPlan = formatPlanInject(sessionId);
  const oops = parseOops(text);
  const monitor = parseQemuMonitor(text);
  return {
    verifyCommand: extractVerifyCommand(text),
    buildSummary:
      parsed.errors.length > 0 || parsed.warnings.length > 0
        ? formatBuildDiagnostics(parsed)
        : undefined,
    buildErrors: buildErrorLines(parsed),
    jobIds: extractJobIds(text),
    sessions: extractSessions(text),
    failingTest: extractFailingTest(text),
    plan: storedPlan || extractPlan(text),
    ccFileCount: countCcLines(text),
    oops: oops ? formatOops(oops) : undefined,
    monitor: monitor ? formatQemuMonitor(monitor) : undefined,
  };
}

export function hasDevelopmentLoopState(state: DevelopmentLoopState): boolean {
  return Boolean(
    state.verifyCommand ||
      state.buildErrors.length ||
      state.jobIds.length ||
      state.sessions.length ||
      state.failingTest ||
      state.plan ||
      state.ccFileCount > 0 ||
      state.oops ||
      state.monitor,
  );
}

/**
 * Compact CC spam into a one-line make summary for tool compaction.
 */
export function summarizeBuildLog(content: string, maxChars = 500): string {
  const parsed = parseBuildOutput(content);
  const ccFileCount = countCcLines(content);
  const lines = content.split(/\r?\n/);
  const header = lines.slice(0, 2).join("\n");
  const makeLine = `make: ${ccFileCount || Math.max(0, lines.length - 8)} files, ${parsed.errors.length} error(s)`;
  const diagnostics = formatBuildDiagnostics(content);
  const result = [header, makeLine, diagnostics].filter(Boolean).join("\n");
  if (result.length > maxChars) {
    return result.slice(0, maxChars) + "...";
  }
  return result;
}

export function looksLikeVerboseBuildLog(content: string): boolean {
  if (countCcLines(content) >= 8) {
    return true;
  }
  if (
    /(?:^|\n)\s*(?:CC|LD|AR|AS)\s+\S+/m.test(content) &&
    content.length > 800
  ) {
    return true;
  }
  if (
    /^\s{2,}(?:Compiling|Checking)\s+\S+/m.test(content) &&
    content.length > 800
  ) {
    return true;
  }
  return /\berror\[E\d+\]/.test(content) && content.length > 400;
}

export function formatDevelopmentLoopState(
  state: DevelopmentLoopState,
): string | undefined {
  if (!hasDevelopmentLoopState(state)) {
    return undefined;
  }

  const parts: string[] = [DEVELOPMENT_LOOP_STATE_MARKER, "[pinned]"];

  if (state.plan) {
    parts.push(state.plan);
  }

  if (state.verifyCommand) {
    parts.push(`verifyCommand: ${state.verifyCommand}`);
  }

  if (state.ccFileCount > 0 || state.buildErrors.length > 0) {
    parts.push(
      `make: ${state.ccFileCount} files, ${state.buildErrors.length} error(s)`,
    );
  }

  if (state.buildErrors.length > 0) {
    parts.push(LAST_BUILD_ERRORS_MARKER);
    parts.push(...state.buildErrors);
  } else if (state.buildSummary) {
    parts.push(state.buildSummary);
  }

  if (state.jobIds.length > 0) {
    parts.push(`Active Jobs: ${state.jobIds.join(", ")}`);
  }

  if (state.sessions.length > 0) {
    parts.push("Sessions:");
    parts.push(...state.sessions.map((session) => `- ${session}`));
  }

  if (state.failingTest) {
    parts.push(`Last failing test: ${state.failingTest}`);
  }

  if (state.oops) {
    parts.push(state.oops);
  }

  if (state.monitor) {
    parts.push(state.monitor);
  }

  return parts.join("\n");
}

export function upsertDevelopmentLoopStateMessage(
  messages: ChatMessage[],
  loopStateText: string | undefined,
): ChatMessage[] {
  const withoutPrior = messages.filter((message) => {
    if (message.role !== "system") {
      return true;
    }
    const text = renderChatMessage(message);
    return !isDevelopmentLoopStateContent(text);
  });

  if (!loopStateText) {
    return withoutPrior;
  }

  const injected: ChatMessage = {
    role: "system",
    content: loopStateText,
  };

  const firstNonSystem = withoutPrior.findIndex(
    (message) => message.role !== "system",
  );
  if (firstNonSystem <= 0) {
    return [injected, ...withoutPrior];
  }
  return [
    ...withoutPrior.slice(0, firstNonSystem),
    injected,
    ...withoutPrior.slice(firstNonSystem),
  ];
}
