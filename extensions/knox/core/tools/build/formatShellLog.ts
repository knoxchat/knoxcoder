/**
 * Compact agent-facing shell output for verbose builds (HL-09).
 * Full logs live on disk; the model gets parsed errors + a short tail.
 */

import {
  formatBuildDiagnostics,
  parseBuildOutput,
} from "./parseDiagnostics";
import { formatOops, parseOops } from "./parseOops";

export const SHELL_LOG_TAIL_LINES = 80;

const VERBOSE_BUILD_RE =
  /(?:^|[\s;|&])(?:make|gmake|ninja|cmake|meson|gcc|g\+\+|clang(?:\+\+)?|ld(?:\.lld)?|qemu-system-[\w-]+|\.\/configure|cargo(?:\s+\+\S+)?\s+(?:check|build|test|clippy|nextest|bench|doc|miri))\b/i;

export function isVerboseBuildCommand(command: string): boolean {
  if (!command) {
    return false;
  }
  return VERBOSE_BUILD_RE.test(command);
}

export function tailLines(text: string, count = SHELL_LOG_TAIL_LINES): string {
  if (!text) {
    return "";
  }
  const lines = text.split(/\r?\n/);
  if (lines.length <= count) {
    return text.replace(/\n+$/, "");
  }
  return lines.slice(-count).join("\n").replace(/\n+$/, "");
}

export function compactShellBody(params: {
  stdout: string;
  stderr: string;
  logPath?: string;
  tailCount?: number;
}): string {
  const combined = [params.stdout, params.stderr].filter(Boolean).join("\n");
  const oops = parseOops(combined);
  const parsed = parseBuildOutput(combined);
  const diagnostics = formatBuildDiagnostics(parsed);
  const tail = tailLines(combined, params.tailCount ?? SHELL_LOG_TAIL_LINES);
  const parts = [];
  if (oops) {
    parts.push(formatOops(oops));
  }
  parts.push(diagnostics);
  if (params.logPath) {
    parts.push(`Full log: ${params.logPath}`);
  } else {
    parts.push("Full log: (in-memory only; truncated to last 200KB)");
  }
  parts.push("--- last 80 lines ---", tail || "(empty)");
  return parts.join("\n");
}

export interface JobOutputFilters {
  tailLines?: number;
  grep?: string;
  sinceByte?: number;
  errorsOnly?: boolean;
}

export function grepLines(text: string, pattern: string): string {
  if (!pattern) {
    return text;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  return text
    .split(/\r?\n/)
    .filter((line) => regex.test(line))
    .join("\n");
}

export function applyJobOutputFilters(
  text: string,
  filters: JobOutputFilters = {},
): string {
  let next = text;
  if (typeof filters.sinceByte === "number" && filters.sinceByte > 0) {
    const buf = Buffer.from(next, "utf8");
    const start = Math.min(filters.sinceByte, buf.length);
    next = buf.subarray(start).toString("utf8");
  }
  if (filters.grep) {
    next = grepLines(next, filters.grep);
  }
  if (filters.errorsOnly) {
    const oops = parseOops(next);
    const parsed = parseBuildOutput(next);
    const diagnostics = formatBuildDiagnostics(parsed);
    const tail = tailLines(next, filters.tailLines ?? SHELL_LOG_TAIL_LINES);
    return [oops ? formatOops(oops) : "", diagnostics, "--- last lines ---", tail || "(empty)"]
      .filter(Boolean)
      .join("\n");
  }
  if (typeof filters.tailLines === "number" && filters.tailLines > 0) {
    next = tailLines(next, filters.tailLines);
  }
  return next;
}
