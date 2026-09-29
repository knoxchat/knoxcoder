/**
 * Build-verify oracle (HL-07 / RL-03): resolve make/ninja/cargo commands,
 * refuse clean/publish, circuit-break identical compiler error signatures.
 */

import type { ContextItem, IDE } from "../..";
import {
  detectWorkspaceKind,
  RUST_VERIFY_COMMAND,
} from "../../config/agentProfile";
import { joinPathsToUri } from "../../util/uri";
import {
  diagnosticSignature,
  formatBuildDiagnostics,
  parseBuildOutput,
} from "./parseDiagnostics";
import { shouldVerifyTool } from "../postEditVerification";
import {
  cargoOracleRed,
  cargoPackageForEditedPath,
  isCargoCheckCommand,
  looksLikeLibManifest,
  miriGateItem,
  rustOuterVerifyCommands,
} from "./rustVerify";

export type AgentVerifyMode = "diagnostics" | "command" | "off";

export const DEFAULT_VERIFY_MAX_ITERATIONS = 8;

export const CARGO_CHECK_COMMAND = RUST_VERIFY_COMMAND;
export const CARGO_CLIPPY_COMMAND =
  "cargo clippy --workspace --all-targets -- -D warnings";
export const CARGO_FMT_COMMAND = "cargo fmt --check";
export const CARGO_TEST_COMMAND = "cargo test --workspace";
export const CARGO_JSON_MESSAGE_FORMAT =
  "--message-format=json-diagnostic-rendered-ansi";

const MAKE_CLEAN_RE = /\b(mrproper|distclean|clean)\b/i;
const CARGO_DESTRUCTIVE_RE =
  /(?:^|[\s;|&])cargo(?:\s+\+\S+)?\s+(clean|publish|login|yank)\b/i;
const CARGO_TOOLCHAIN_RE = /(?:^|[\s;|&])cargo(?:\s+\+\S+)?\s+/i;
const CARGO_LONG_SUBCOMMAND_RE =
  /(?:^|[\s;|&])cargo(?:\s+\+\S+)?\s+(?:check|build|test|clippy|nextest|bench|doc|miri)\b/i;

const MANIFESTS: Array<{ file: string; command: string }> = [
  { file: "Makefile", command: "make" },
  { file: "GNUmakefile", command: "make" },
  { file: "makefile", command: "make" },
  { file: "build.ninja", command: "ninja" },
  { file: "compile_commands.json", command: "make" },
  { file: "Cargo.toml", command: CARGO_CHECK_COMMAND },
];

export function isCargoCommand(command: string): boolean {
  return CARGO_TOOLCHAIN_RE.test(command);
}

export function isCargoCompileCommand(command: string): boolean {
  return CARGO_LONG_SUBCOMMAND_RE.test(command);
}

/** Append cargo JSON diagnostics unless the user already set --message-format. */
export function ensureCargoJsonMessageFormat(command: string): string {
  if (!isCargoCompileCommand(command) || /--message-format\b/i.test(command)) {
    return command;
  }
  return `${command} ${CARGO_JSON_MESSAGE_FORMAT}`;
}

export function resolveVerifyMode(
  mode: unknown,
  command?: string,
): AgentVerifyMode {
  if (mode === "off" || mode === "command" || mode === "diagnostics") {
    if (mode === "diagnostics" && command?.trim()) {
      return "command";
    }
    return mode;
  }
  return command?.trim() ? "command" : "diagnostics";
}

export function resolveVerifyMaxIterations(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(Math.floor(raw), 20);
  }
  return DEFAULT_VERIFY_MAX_ITERATIONS;
}

function extraArgsFrom(args: Record<string, unknown>): string {
  if (typeof args.extraArgs === "string" && args.extraArgs.trim()) {
    return args.extraArgs.trim();
  }
  if (typeof args.extra_args === "string" && args.extra_args.trim()) {
    return args.extra_args.trim();
  }
  return "";
}

function jobsFlagFrom(args: Record<string, unknown>): string {
  const jobsRaw = args.jobs;
  const jobs =
    typeof jobsRaw === "number" && Number.isFinite(jobsRaw) && jobsRaw > 0
      ? Math.min(Math.floor(jobsRaw), 256)
      : 0;
  return jobs > 0 ? `-j${jobs}` : "";
}

/** Compose clippy / fmt / test oracles. `doc` is handled as a rustdoc lookup. */
export function composeCargoActionCommand(
  action: string,
  args: Record<string, unknown> = {},
): string | undefined {
  const kind = action.trim().toLowerCase();
  const jobsFlag = jobsFlagFrom(args);
  const target =
    typeof args.target === "string" && args.target.trim()
      ? cargoPackageArgs(args.target.trim())
      : "";
  const extra = extraArgsFrom(args);
  if (kind === "clippy") {
    const deny =
      args.lib === true
        ? "-- -D warnings -D clippy::unwrap_used -D clippy::expect_used -D clippy::await_holding_lock"
        : "-- -D warnings";
    return [
      "cargo clippy",
      target || "--workspace",
      "--all-targets",
      jobsFlag,
      extra,
      CARGO_JSON_MESSAGE_FORMAT,
      deny,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "fmt") {
    return ["cargo fmt --check", extra].filter(Boolean).join(" ");
  }
  if (kind === "test") {
    const doc =
      args.docTests === true && !/\b--doc\b/.test(extra) ? "--doc" : "";
    return ["cargo test", target || "--workspace", jobsFlag, extra, doc]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "fix") {
    return ["cargo fix --allow-dirty", target, extra].filter(Boolean).join(" ");
  }
  if (kind === "expand") {
    return ["cargo expand", target, extra].filter(Boolean).join(" ");
  }
  if (kind === "miri") {
    return ["cargo +nightly miri test", target, extra].filter(Boolean).join(" ");
  }
  if (kind === "deny") {
    return ["cargo deny check", extra].filter(Boolean).join(" ");
  }
  if (kind === "audit") {
    return ["cargo audit", extra].filter(Boolean).join(" ");
  }
  if (kind === "tree") {
    return ["cargo tree", extra].filter(Boolean).join(" ");
  }
  return undefined;
}

/** `-p <name>` for a crate package; otherwise pass the token through. */
export function cargoPackageArgs(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[\w.-]+$/.test(trimmed)) {
    return `-p ${trimmed}`;
  }
  return trimmed;
}

/** Refuse make clean / cargo clean|publish|login|yank on builtin_build. */
export function destructiveBuildReason(blob: string): string | undefined {
  const cargo = blob.match(CARGO_DESTRUCTIVE_RE);
  if (cargo) {
    return `builtin_build will not run cargo ${cargo[1]}. Use the terminal tool only if the user explicitly asked. Never cargo publish / login / yank from this tool.`;
  }
  if (MAKE_CLEAN_RE.test(blob)) {
    return "builtin_build will not run make clean / mrproper / distclean. Use the terminal tool only if the user explicitly asked to clean.";
  }
  if (/\bcargo(?:\s+\+\S+)?\s+fix\b/i.test(blob) && /--broken-code\b/i.test(blob)) {
    return "builtin_build will not run cargo fix --broken-code (infinite rustfix loops). Apply rustc Suggested fix: stanzas with builtin_edit_file instead.";
  }
  return undefined;
}

export function composeBuildCommand(
  args: Record<string, unknown>,
  detected = "make",
): string {
  if (typeof args.command === "string" && args.command.trim()) {
    return ensureCargoJsonMessageFormat(args.command.trim());
  }
  const jobsFlag = jobsFlagFrom(args);
  const target =
    typeof args.target === "string" && args.target.trim()
      ? args.target.trim()
      : "";
  const extra = extraArgsFrom(args);
  if (isCargoCommand(detected)) {
    const fromPath =
      target.includes("/") || /\.rs$/i.test(target)
        ? cargoPackageForEditedPath(target)
        : undefined;
    const pkg = fromPath ? cargoPackageArgs(fromPath) : cargoPackageArgs(target);
    return ensureCargoJsonMessageFormat(
      [detected, jobsFlag, pkg, extra].filter(Boolean).join(" "),
    );
  }
  const env =
    args.env && typeof args.env === "object" && !Array.isArray(args.env)
      ? (args.env as Record<string, unknown>)
      : {};
  const envPrefix = ["ARCH", "CROSS_COMPILE"]
    .map((key) => {
      const value = env[key];
      return typeof value === "string" && value.trim()
        ? `${key}=${value.trim()}`
        : "";
    })
    .filter(Boolean)
    .join(" ");
  return [envPrefix, detected, jobsFlag, target, extra]
    .filter(Boolean)
    .join(" ");
}

export async function detectBuildCommand(ide: IDE): Promise<string | undefined> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root) {
    return undefined;
  }
  if (typeof ide.listDir === "function") {
    try {
      const entries = await ide.listDir(root);
      const kind = detectWorkspaceKind(entries.map(([name]) => name));
      if (kind === "cargo") {
        return CARGO_CHECK_COMMAND;
      }
    } catch {
      // Fall through to fileExists scan.
    }
  }
  for (const manifest of MANIFESTS) {
    try {
      if (await ide.fileExists(joinPathsToUri(root, manifest.file))) {
        return manifest.command;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

export function attachBuildDiagnostics(items: ContextItem[]): ContextItem[] {
  const log = items.map((item) => item.content ?? "").join("\n");
  const parsed = parseBuildOutput(log);
  return [
    ...items,
    {
      name: "Build diagnostics",
      description:
        parsed.errors.length === 0
          ? "clean"
          : `${parsed.errors.length} error(s)`,
      content: formatBuildDiagnostics(log),
    },
  ];
}

export class BuildErrorCircuit {
  private last = "";
  private count = 0;

  constructor(private readonly maxRepeats: number) {}

  get repeats(): number {
    return this.count;
  }

  wouldSkip(): boolean {
    return this.count >= this.maxRepeats && this.last !== "ok" && this.last !== "";
  }

  observe(signature: string): { tripped: boolean; count: number } {
    if (signature === "ok") {
      this.last = "ok";
      this.count = 0;
      return { tripped: false, count: 0 };
    }
    if (signature === this.last) {
      this.count += 1;
    } else {
      this.last = signature;
      this.count = 1;
    }
    return {
      tripped: this.count >= this.maxRepeats,
      count: this.count,
    };
  }
}

const circuits = new Map<string, BuildErrorCircuit>();

export function circuitFor(
  key: string,
  maxIterations = DEFAULT_VERIFY_MAX_ITERATIONS,
): BuildErrorCircuit {
  const existing = circuits.get(key);
  if (existing) {
    return existing;
  }
  const created = new BuildErrorCircuit(maxIterations);
  circuits.set(key, created);
  return created;
}

export function resetBuildVerifyCircuits(): void {
  circuits.clear();
}

function circuitSkipItem(command: string, count: number): ContextItem {
  return {
    name: "Build verification",
    description: "circuit breaker",
    content: `Skipped auto-build (${command}): identical compiler error signature ${count} time(s). Stop retrying the same patch; inspect the last diagnostics.`,
  };
}

export interface PostEditBuildVerifyOptions {
  toolName: string;
  command: string;
  maxIterations?: number;
  circuitKey?: string;
  run: (command: string) => Promise<ContextItem[]>;
  /** Edited path — used for `-p <member>` (RL-47) and miri reminder. */
  filePath?: string;
  /** When true, this edit introduced/changed `unsafe`. */
  unsafeTouched?: boolean;
  /** `[lib]` crate — clippy also denies unwrap/expect. */
  isLib?: boolean;
  cargoToml?: string;
  /** After a green cargo check, also run fmt + clippy. Default true. */
  staged?: boolean;
}

/**
 * After a mutating edit, run verifyCommand and return parsed diagnostics.
 * No nested LLM fix loop — the agent sees errors on the same tool result.
 */
export async function runPostEditBuildVerify(
  options: PostEditBuildVerifyOptions,
): Promise<ContextItem[]> {
  if (!shouldVerifyTool(options.toolName)) {
    return [];
  }
  const command = ensureCargoJsonMessageFormat(options.command.trim());
  if (!command) {
    return [];
  }
  const forbidden = destructiveBuildReason(command);
  if (forbidden) {
    return [
      {
        name: "Build verification",
        description: "refused",
        content: forbidden,
      },
    ];
  }
  const max = resolveVerifyMaxIterations(options.maxIterations);
  const circuit = circuitFor(options.circuitKey ?? command, max);
  if (circuit.wouldSkip()) {
    return [circuitSkipItem(command, circuit.repeats)];
  }
  const raw = await options.run(command);
  const withDiag = attachBuildDiagnostics(raw);
  const log = withDiag.map((item) => item.content ?? "").join("\n");
  const sig = diagnosticSignature(log);
  const { tripped, count } = circuit.observe(sig);
  if (tripped) {
    withDiag.push(circuitSkipItem(command, count));
  }
  const checkGreen =
    isCargoCheckCommand(command) && !cargoOracleRed(log) && sig === "ok";
  const staged = options.staged !== false;
  if (checkGreen && staged) {
    const isLib =
      options.isLib ?? looksLikeLibManifest(options.cargoToml ?? "");
    for (const extra of rustOuterVerifyCommands({
      filePath: options.filePath,
      isLib,
    })) {
      const extraRaw = await options.run(extra);
      const extraItems = attachBuildDiagnostics(extraRaw);
      withDiag.push(...extraItems);
      const extraLog = extraItems.map((item) => item.content ?? "").join("\n");
      if (cargoOracleRed(extraLog) || diagnosticSignature(extraLog) !== "ok") {
        break;
      }
    }
  }
  if (options.unsafeTouched) {
    withDiag.push(miriGateItem(options.filePath));
  }
  return withDiag;
}
