/**
 * Rust quality gate (`builtin_build action=gate` / `gate_init`).
 *
 * One command that runs every cargo oracle (fmt → check → clippy → test, plus
 * doc/audit/deny in strict) for every crate in the workspace. Projects get
 * `scripts/pre-commit.sh` (bundled with the rust skill) so the same gate works
 * for the agent, humans and the git hook. When a project has no script we
 * fall back to an inline `cargo` chain so the gate is always available.
 */

import fs from "node:fs";
import path from "node:path";

import { getBundledSkillsPath } from "../../skills/skillManager";
import { CARGO_JSON_MESSAGE_FORMAT } from "./verifyCommand";

export const RUST_GATE_SCRIPT = "scripts/pre-commit.sh";
export const RUST_GATE_MARKER = "Rust gate";

export type RustGateMode = "quick" | "full" | "strict";

export interface RustGateResult {
  status: "pass" | "fail" | "skip" | "unknown";
  /** Text after the status on the `knox-gate:` line (mode=…, failed=…). */
  detail: string;
  failedSteps: string[];
}

const GATE_RESULT_RE = /^knox-gate:\s+(PASS|FAIL|SKIP)\b(.*)$/m;

/** Flags the agent must never pass through (git hooks are the user's call). */
const GATE_FORBIDDEN_FLAGS_RE =
  /(?:^|\s)--(install-hook|uninstall-hook|from-hook)\b/i;

export function resolveGateMode(raw: unknown): RustGateMode {
  const mode = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (mode === "quick" || mode === "strict" || mode === "full") {
    return mode;
  }
  return "full";
}

export function gateRefusedReason(text: string): string | undefined {
  const hit = text.match(GATE_FORBIDDEN_FLAGS_RE);
  if (!hit) {
    return undefined;
  }
  return `builtin_build action=gate will not pass --${hit[1]}. Installing or removing git hooks is the user's decision — tell them to run \`${RUST_GATE_SCRIPT} --install-hook\` themselves.`;
}

/** Only allow plain `--flag` tokens through to the script. */
function safeGateExtraArgs(extra: string): string {
  return extra
    .split(/\s+/)
    .filter((token) => /^--[a-z][a-z0-9-]*(?:=[\w./-]+)?$/i.test(token))
    .join(" ");
}

/** `bash scripts/pre-commit.sh [--quick|--strict] [--fix] [--offline] …`. */
export function composeGateScriptCommand(opts: {
  mode?: RustGateMode;
  fix?: boolean;
  offline?: boolean;
  keepGoing?: boolean;
  extraArgs?: string;
}): string {
  const flags: string[] = [];
  if (opts.mode === "quick") {
    flags.push("--quick");
  } else if (opts.mode === "strict") {
    flags.push("--strict");
  }
  if (opts.fix) {
    flags.push("--fix");
  }
  if (opts.offline) {
    flags.push("--offline");
  }
  if (opts.keepGoing) {
    flags.push("--keep-going");
  }
  const extra = safeGateExtraArgs(opts.extraArgs ?? "");
  return ["bash", RUST_GATE_SCRIPT, ...flags, extra].filter(Boolean).join(" ");
}

/**
 * Inline gate for projects without `scripts/pre-commit.sh`. `&&` chains stop
 * at the first red step, matching the script's default (no --keep-going).
 */
export function composeFallbackGateCommand(opts: {
  mode?: RustGateMode;
  fix?: boolean;
  offline?: boolean;
}): string {
  const mode = opts.mode ?? "full";
  const offline = opts.offline ? " --offline" : "";
  const steps = [
    opts.fix ? "cargo fmt --all" : "",
    "cargo fmt --all -- --check",
    `cargo check --workspace --all-targets${offline} ${CARGO_JSON_MESSAGE_FORMAT}`,
    mode === "strict"
      ? `cargo clippy --workspace --all-targets${offline} ${CARGO_JSON_MESSAGE_FORMAT} -- -D warnings -D clippy::dbg_macro -W clippy::undocumented_unsafe_blocks -W clippy::todo -W clippy::unimplemented`
      : `cargo clippy --workspace --all-targets${offline} ${CARGO_JSON_MESSAGE_FORMAT} -- -D warnings -D clippy::dbg_macro`,
    mode === "quick" ? "" : `cargo test --workspace${offline}`,
    mode === "strict"
      ? `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps${offline}`
      : "",
  ].filter(Boolean);
  return steps.join(" && ");
}

/** Does an existing `scripts/pre-commit.sh` look like a cargo gate (ours or KnoxOS-style)? */
export function looksLikeCargoGateScript(text: string): boolean {
  return /\bcargo\b/.test(text) && /--quick|--strict|Rust gate|pre-commit/i.test(text);
}

export function parseGateResult(log: string): RustGateResult {
  const hit = log.match(GATE_RESULT_RE);
  if (!hit) {
    return { status: "unknown", detail: "", failedSteps: [] };
  }
  const detail = hit[2].trim();
  const failed = detail.match(/\bfailed=(\S+)/)?.[1];
  return {
    status: hit[1].toLowerCase() as "pass" | "fail" | "skip",
    detail,
    failedSteps: failed ? failed.split(",").filter(Boolean) : [],
  };
}

export function gateRed(log: string): boolean {
  const result = parseGateResult(log);
  if (result.status === "fail") {
    return true;
  }
  if (result.status === "unknown") {
    return /\bExit:\s*[1-9]\d*\b/.test(log);
  }
  return false;
}

/** Model-facing verdict appended after the raw gate log. */
export function formatGateVerdict(
  log: string,
  opts: { usedScript: boolean; mode: RustGateMode },
): { description: string; content: string } {
  const result = parseGateResult(log);
  const lines: string[] = [];
  if (result.status === "pass") {
    lines.push(
      `${RUST_GATE_MARKER} PASSED (${opts.mode}).`,
      "Compiler-green ≠ correct: name what the tests do not cover, and run `builtin_build action=miri` if you touched `unsafe`.",
    );
    return { description: "pass", content: lines.join(" ") };
  }
  if (result.status === "skip") {
    return {
      description: "skipped",
      content: `${RUST_GATE_MARKER} skipped (${result.detail || "nothing to gate"}).`,
    };
  }
  if (gateRed(log)) {
    lines.push(
      `${RUST_GATE_MARKER} FAILED (${opts.mode})${
        result.failedSteps.length ? `: ${result.failedSteps.join(", ")}` : ""
      }.`,
      "Fix the first failing step (fmt → check → clippy → test), then re-run the gate. Do not claim done.",
      "Do not edit or delete tests to make them pass; do not add #[allow] without an inline reason; on E0xxx call builtin_build explain.",
    );
    return { description: "fail", content: lines.join(" ") };
  }
  // The inline fallback prints no result line; its `&&` chain exits 0 only
  // when every step (fmt, check, clippy, test) was green.
  if (!opts.usedScript && /\bExit:\s*0\b/.test(log)) {
    return {
      description: "pass",
      content: `${RUST_GATE_MARKER} PASSED (${opts.mode}, inline chain). Compiler-green ≠ correct: name what the tests do not cover, and run \`builtin_build action=miri\` if you touched \`unsafe\`.`,
    };
  }
  return {
    description: "unknown",
    content: `${RUST_GATE_MARKER}: no result line found. Read the output above; do not assume it passed.`,
  };
}

export function bundledGateScriptPath(): string {
  return path.join(getBundledSkillsPath(), "rust", "scripts", "pre-commit.sh");
}

/** Contents of the bundled gate script, or undefined when the bundle lacks it. */
export function readBundledGateScript(): string | undefined {
  try {
    return fs.readFileSync(bundledGateScriptPath(), "utf8");
  } catch {
    return undefined;
  }
}
