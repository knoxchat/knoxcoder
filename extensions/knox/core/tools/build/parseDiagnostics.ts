/**
 * Parse compiler / linker / build-system / boot-test diagnostics from
 * shell output.
 *
 * Used by doom-loop fingerprints (identical `make` with a *new* gcc error
 * is not "stuck") and by build-verify (HL-07) so the model sees file:line
 * errors instead of a 200KB CC log. Kernel panic / kselftest FAIL count as
 * oracle failures so a QEMU boot is not "clean".
 */

import { formatOops, parseOops } from "./parseOops";
import { formatRustcRemedyReminder } from "./rustcRemedies";

export type BuildDiagnosticKind = "error" | "warning" | "note" | "link" | "make";

export interface BuildDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  kind: BuildDiagnosticKind;
  /** rustc `E0425`, clippy `clippy::unwrap_used`, gcc `-Wunused-variable`, etc. */
  code?: string;
  message: string;
  raw: string;
  /** rustc/clippy `suggested_replacement` when machine-applicable. */
  suggestedReplacement?: string;
}

export interface ParsedBuildOutput {
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  notes: BuildDiagnostic[];
  /** All structured hits in log order (errors, warnings, notes, link, make). */
  diagnostics: BuildDiagnostic[];
}

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

const GCC_CLANG_RE =
  /^(.+?):(\d+)(?::(\d+))?:\s+(fatal error|error|warning|note|remark):\s+(.*)$/i;

const GCC_CODE_RE = /\[((?:-W)[\w=-]+|[\w-]+)\]\s*$/;

const RUSTC_ERROR_RE =
  /^(error|warning|note)(?:\[((?:E\d+|clippy::[\w]+))\])?:\s+(.*)$/i;
const RUSTC_ARROW_RE = /^\s*-->\s+(.+):(\d+):(\d+)\s*$/;
const RUSTC_HELP_RE = /^(?:help|\s*=\s*help):\s+(.*)$/i;
const CLIPPY_LINT_RE = /\bclippy::([\w]+)\b/;
const CARGO_TEST_FAIL_RE = /^test\s+(\S+)\s+\.\.\.\s+FAILED\b/;
const NEXTEST_FAIL_RE = /^\s*FAIL\s+\[[^\]]+\]\s+(\S+)\s+(\S+)/;
const CARGO_COULD_NOT_COMPILE_RE = /^error:\s+could not compile\b/i;

const LD_UNDEF_RE =
  /^(?:.*?:\s*)?(?:undefined reference to|undefined symbol:?)\s+[`'"]?([^`'"\s]+)[`'"]?/i;
const LD_FILE_RE = /^(.+?)(?:\((\.[^)]+)\))?:(?:\d+:)?\s/;

const MAKE_RE =
  /^(make(?:\[\d+\])?):\s+\*\*\*\s+(?:\[([^\]]+)\]\s+)?Error\s+(\d+)/i;
const NINJA_FAILED_RE = /^FAILED:\s+(.+)$/;
const NINJA_ERROR_RE = /^ninja:\s+error:\s+(.*)$/i;
const MESON_RE = /^(meson\.build):(\d+):\d+:\s+ERROR:\s+(.*)$/i;
const COLLECT2_RE = /^collect2:\s+error:\s+(.*)$/i;

/** TAP / kselftest / KUnit failures (not ninja `FAILED:` — that is parseMakeLine). */
const TAP_NOT_OK_RE = /^not ok\s+\d+\b/i;
const KSELFTEST_BRACKETS_FAIL_RE = /\s\[FAIL\]\s*$/;
const KUNIT_FAIL_RE = /^#\s+\S+:\s+FAIL:/i;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function classifyPrefix(prefix: string): BuildDiagnosticKind {
  const lower = prefix.toLowerCase();
  if (lower.includes("fatal") || lower === "error") {
    return "error";
  }
  if (lower === "warning") {
    return "warning";
  }
  return "note";
}

function push(
  parsed: ParsedBuildOutput,
  diagnostic: BuildDiagnostic,
): void {
  parsed.diagnostics.push(diagnostic);
  if (diagnostic.kind === "warning") {
    parsed.warnings.push(diagnostic);
    return;
  }
  if (diagnostic.kind === "note") {
    parsed.notes.push(diagnostic);
    return;
  }
  parsed.errors.push(diagnostic);
}

function parseGccLine(line: string): BuildDiagnostic | null {
  const match = line.match(GCC_CLANG_RE);
  if (!match) {
    return null;
  }
  const message = match[5].trim();
  const codeMatch = message.match(GCC_CODE_RE);
  return {
    file: match[1].trim(),
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
    kind: classifyPrefix(match[4]),
    code: codeMatch?.[1],
    message,
    raw: line,
  };
}

function parseMakeLine(line: string): BuildDiagnostic | null {
  const make = line.match(MAKE_RE);
  if (make) {
    const target = make[2]?.trim();
    return {
      file:
        target && (target.includes(".") || target.includes("/"))
          ? target
          : undefined,
      kind: "make",
      message: target
        ? `${make[1]} [${target}] Error ${make[3]}`
        : `${make[1]} Error ${make[3]}`,
      raw: line,
    };
  }
  const ninjaFailed = line.match(NINJA_FAILED_RE);
  if (ninjaFailed) {
    return {
      file: ninjaFailed[1].trim(),
      kind: "make",
      message: `FAILED: ${ninjaFailed[1].trim()}`,
      raw: line,
    };
  }
  const ninjaError = line.match(NINJA_ERROR_RE);
  if (ninjaError) {
    return {
      kind: "make",
      message: ninjaError[1].trim(),
      raw: line,
    };
  }
  const meson = line.match(MESON_RE);
  if (meson) {
    return {
      file: meson[1],
      line: Number(meson[2]),
      kind: "error",
      message: meson[3].trim(),
      raw: line,
    };
  }
  const collect2 = line.match(COLLECT2_RE);
  if (collect2) {
    return {
      kind: "link",
      message: collect2[1].trim(),
      raw: line,
    };
  }
  return null;
}

function parseLdLine(line: string): BuildDiagnostic | null {
  const undef = line.match(LD_UNDEF_RE);
  if (!undef) {
    return null;
  }
  const fileMatch = line.match(LD_FILE_RE);
  let file: string | undefined;
  let lineNo: number | undefined;
  if (fileMatch) {
    file = fileMatch[1].trim();
  }
  const loc = line.match(/^(.+?):(\d+):\s+undefined reference/i);
  if (loc) {
    file = loc[1].trim();
    lineNo = Number(loc[2]);
  }
  return {
    file,
    line: lineNo,
    kind: "link",
    message: `undefined reference to ${undef[1]}`,
    raw: line,
  };
}

function firstSuggestedReplacement(spans: unknown): string | undefined {
  if (!Array.isArray(spans)) {
    return undefined;
  }
  for (const span of spans) {
    if (!span || typeof span !== "object") {
      continue;
    }
    const replacement = (span as { suggested_replacement?: unknown })
      .suggested_replacement;
    if (typeof replacement === "string" && replacement.length > 0) {
      return replacement;
    }
  }
  return undefined;
}

function primaryJsonSpan(spans: unknown): {
  file?: string;
  line?: number;
  column?: number;
  suggestedReplacement?: string;
} {
  if (!Array.isArray(spans)) {
    return {};
  }
  const typed = spans.filter(
    (span): span is Record<string, unknown> =>
      Boolean(span) && typeof span === "object",
  );
  const primary =
    typed.find((span) => span.is_primary === true) ?? typed[0];
  if (!primary) {
    return { suggestedReplacement: firstSuggestedReplacement(spans) };
  }
  return {
    file: typeof primary.file_name === "string" ? primary.file_name : undefined,
    line:
      typeof primary.line_start === "number" ? primary.line_start : undefined,
    column:
      typeof primary.column_start === "number"
        ? primary.column_start
        : undefined,
    suggestedReplacement: firstSuggestedReplacement(spans),
  };
}

function parseCargoJsonLine(line: string): BuildDiagnostic[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const reason = (parsed as { reason?: unknown }).reason;
  if (reason !== "compiler-message") {
    return reason ? [] : null;
  }
  const message = (parsed as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return [];
  }
  const msg = message as {
    message?: unknown;
    level?: unknown;
    code?: { code?: unknown } | null;
    spans?: unknown;
    children?: unknown;
    rendered?: unknown;
  };
  const level = typeof msg.level === "string" ? msg.level : "error";
  const kind = classifyPrefix(level === "failure-note" ? "note" : level);
  const code =
    typeof msg.code?.code === "string" ? msg.code.code : undefined;
  const span = primaryJsonSpan(msg.spans);
  let suggested = span.suggestedReplacement;
  if (!suggested && Array.isArray(msg.children)) {
    for (const child of msg.children) {
      if (!child || typeof child !== "object") {
        continue;
      }
      suggested = firstSuggestedReplacement(
        (child as { spans?: unknown }).spans,
      );
      if (suggested) {
        break;
      }
    }
  }
  const text =
    typeof msg.message === "string" && msg.message.trim()
      ? msg.message.trim()
      : "compiler message";
  const raw =
    typeof msg.rendered === "string" && msg.rendered.trim()
      ? msg.rendered.trim()
      : line;
  return [
    {
      file: span.file,
      line: span.line,
      column: span.column,
      kind,
      code,
      message: text,
      raw,
      suggestedReplacement: suggested,
    },
  ];
}

function parseTestFailLine(line: string): BuildDiagnostic | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const cargoTest = trimmed.match(CARGO_TEST_FAIL_RE);
  if (cargoTest) {
    return {
      kind: "error",
      code: "test",
      message: `test ${cargoTest[1]} ... FAILED`,
      raw: line,
    };
  }
  const nextest = trimmed.match(NEXTEST_FAIL_RE);
  if (nextest) {
    return {
      kind: "error",
      code: "nextest",
      message: `FAIL ${nextest[1]} ${nextest[2]}`,
      raw: line,
    };
  }
  if (TAP_NOT_OK_RE.test(trimmed)) {
    return {
      kind: "error",
      code: "kselftest",
      message: trimmed,
      raw: line,
    };
  }
  if (KSELFTEST_BRACKETS_FAIL_RE.test(trimmed)) {
    return {
      kind: "error",
      code: "kselftest",
      message: trimmed,
      raw: line,
    };
  }
  if (KUNIT_FAIL_RE.test(trimmed)) {
    return {
      kind: "error",
      code: "kunit",
      message: trimmed,
      raw: line,
    };
  }
  return null;
}

/**
 * Extract gcc/clang/kbuild, rustc, ld, make/ninja/meson diagnostics,
 * plus kselftest/KUnit FAIL and parsed oops/panic (boot oracle).
 */
export function parseBuildOutput(text: string): ParsedBuildOutput {
  const parsed: ParsedBuildOutput = {
    errors: [],
    warnings: [],
    notes: [],
    diagnostics: [],
  };
  if (!text) {
    return parsed;
  }

  const lines = stripAnsi(text).split(/\r?\n/);
  let pendingRust: {
    kind: BuildDiagnosticKind;
    code?: string;
    message: string;
    raw: string;
  } | null = null;
  let lastRust: BuildDiagnostic | null = null;

  const flushRust = (fallbackRaw: string) => {
    if (!pendingRust) {
      return;
    }
    const diagnostic: BuildDiagnostic = {
      kind: pendingRust.kind,
      code: pendingRust.code,
      message: pendingRust.message,
      raw: pendingRust.raw || fallbackRaw,
    };
    push(parsed, diagnostic);
    lastRust = diagnostic;
    pendingRust = null;
  };

  const attachClippyCode = (line: string) => {
    const match = line.match(CLIPPY_LINT_RE);
    if (!match) {
      return false;
    }
    const code = `clippy::${match[1]}`;
    if (pendingRust && !pendingRust.code) {
      pendingRust.code = code;
      return true;
    }
    if (lastRust && !lastRust.code) {
      lastRust.code = code;
      return true;
    }
    return false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const jsonDiagnostics = parseCargoJsonLine(line);
    if (jsonDiagnostics) {
      flushRust(line);
      for (const diagnostic of jsonDiagnostics) {
        push(parsed, diagnostic);
        if (diagnostic.code || diagnostic.file) {
          lastRust = diagnostic;
        }
      }
      continue;
    }

    const rustc = line.match(RUSTC_ERROR_RE);
    if (rustc && !line.includes(": error:") && !line.includes(": warning:")) {
      flushRust(line);
      pendingRust = {
        kind: classifyPrefix(rustc[1]),
        code: rustc[2],
        message: rustc[3].trim(),
        raw: line,
      };
      if (CARGO_COULD_NOT_COMPILE_RE.test(line)) {
        flushRust(line);
      }
      continue;
    }

    const rustArrow = line.match(RUSTC_ARROW_RE);
    if (rustArrow && pendingRust) {
      const diagnostic: BuildDiagnostic = {
        file: rustArrow[1].trim(),
        line: Number(rustArrow[2]),
        column: Number(rustArrow[3]),
        kind: pendingRust.kind,
        code: pendingRust.code,
        message: pendingRust.message,
        raw: `${pendingRust.raw}\n${line}`,
      };
      push(parsed, diagnostic);
      lastRust = diagnostic;
      pendingRust = null;
      continue;
    }

    if (attachClippyCode(line)) {
      continue;
    }

    const help = line.match(RUSTC_HELP_RE);
    if (help) {
      push(parsed, {
        kind: "note",
        message: help[1].trim(),
        raw: line,
      });
      continue;
    }

    const gcc = parseGccLine(line.trim());
    if (gcc) {
      flushRust(line);
      push(parsed, gcc);
      continue;
    }

    const ld = parseLdLine(line.trim());
    if (ld) {
      flushRust(line);
      push(parsed, ld);
      continue;
    }

    const make = parseMakeLine(line.trim());
    if (make) {
      flushRust(line);
      push(parsed, make);
      continue;
    }

    const testFail = parseTestFailLine(line);
    if (testFail) {
      flushRust(line);
      push(parsed, testFail);
    }
  }

  flushRust("");

  const oops = parseOops(text);
  if (oops) {
    const frame = oops.frames.find((item) => item.file) ?? oops.frames[0];
    push(parsed, {
      file: frame?.file,
      line: frame?.line,
      kind: "error",
      code: oops.kind,
      message: oops.rip ? `${oops.title}; RIP ${oops.rip}` : oops.title,
      raw: oops.rawExcerpt,
    });
  }

  return parsed;
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/**
 * Stable fingerprint of the *errors* in a build log (not CC spam).
 * Empty / clean logs share one signature so "make succeeded" is distinct
 * from "make failed with implicit declaration".
 */
export function diagnosticSignature(text: string): string {
  const parsed = parseBuildOutput(text);
  const parts = parsed.errors.map((item) => {
    const loc = [item.file ?? "", item.line ?? "", item.kind, item.code ?? ""]
      .join(":");
    return `${loc}:${normalizeMessage(item.message)}`;
  });
  if (parts.length === 0) {
    return "ok";
  }
  return parts.join("|");
}

/**
 * Compact model-facing summary: counts + file:line errors, not the CC tail.
 * When the input is the original log, prepend a structured oops/panic block.
 */
export function formatBuildDiagnostics(
  input: string | ParsedBuildOutput,
): string {
  const text = typeof input === "string" ? input : "";
  const parsed = typeof input === "string" ? parseBuildOutput(input) : input;
  const oops = text ? parseOops(text) : undefined;
  const { errors, warnings } = parsed;
  if (errors.length === 0 && warnings.length === 0) {
    return "Build diagnostics: clean (no compiler/linker/runtime errors parsed).";
  }
  const header = `Build diagnostics: ${errors.length} error(s), ${warnings.length} warning(s).`;
  const oopsBlock = oops ? formatOops(oops) : "";
  const lines = parsed.diagnostics
    .filter((item) => item.kind !== "note")
    .slice(0, 40)
    .map((item) => {
      const loc = item.file
        ? item.line
          ? item.column
            ? `${item.file}:${item.line}:${item.column}`
            : `${item.file}:${item.line}`
          : item.file
        : item.kind;
      const main = `${loc}: ${item.kind}: ${item.message}`;
      if (!item.suggestedReplacement) {
        return main;
      }
      return `${main}\n  Suggested fix: apply with builtin_edit_file → \`${item.suggestedReplacement}\``;
    });
  const reminder = formatRustcRemedyReminder(parsed.diagnostics);
  return [oopsBlock, header, ...lines, reminder].filter(Boolean).join("\n");
}
