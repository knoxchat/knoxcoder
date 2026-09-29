/**
 * Rust verify stages + workspace package targeting (RL-41–45, RL-47).
 *
 * Inner oracle stays `cargo check`. After it is green, fmt + clippy run.
 * Tests / miri stay outer (explicit action or an unsafe reminder).
 */

const CARGO_JSON_MESSAGE_FORMAT =
  "--message-format=json-diagnostic-rendered-ansi";

export const MIRI_GATE_MARKER = "This edit touched `unsafe`";
export const MIRI_MISSING_MARKER = "install miri";

/** `-p foo` when targeting one member; otherwise `--workspace`. Never both. */
export function cargoWorkspaceOrPackage(packageName?: string): string {
  const name = packageName?.trim();
  return name ? `-p ${name}` : "--workspace";
}

/** Nested crate path (`crates/foo/src/lib.rs` or `foo/src/lib.rs`) → `foo`. */
export function cargoPackageForEditedPath(filePath: string): string | undefined {
  const posix = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const fromSrc = posix.match(/^(?:[\w.-]+\/)*([\w.-]+)\/src\//);
  if (fromSrc?.[1]) {
    return fromSrc[1];
  }
  const fromToml = posix.match(/^(?:[\w.-]+\/)*([\w.-]+)\/Cargo\.toml$/i);
  return fromToml?.[1];
}

export function looksLikeLibPath(filePath?: string): boolean {
  if (!filePath) {
    return false;
  }
  return /(?:^|\/)lib\.rs$/i.test(filePath.replace(/\\/g, "/"));
}

export function resolveRustIsLib(opts: {
  filePath?: string;
  cargoToml?: string;
  libRsExists?: boolean;
}): boolean {
  if (looksLikeLibPath(opts.filePath) || opts.libRsExists) {
    return true;
  }
  return looksLikeLibManifest(opts.cargoToml ?? "");
}

export function isCargoCheckCommand(command: string): boolean {
  return /(?:^|[\s;|&])cargo(?:\s+\+\S+)?\s+check\b/i.test(command);
}

export function cargoOracleRed(log: string): boolean {
  if (/\bExit:\s*[1-9]\d*\b/.test(log)) {
    return true;
  }
  if (/error\[E\d{4}\]|error:\s+could not compile/i.test(log)) {
    return true;
  }
  if (/^test\s+\S+\s+\.\.\.\s+FAILED\b/m.test(log)) {
    return true;
  }
  if (/\bclippy::/.test(log) && /\berror:/i.test(log)) {
    return true;
  }
  if (/^Diff in /m.test(log) || /\b rustfmt \b/.test(log) && /\bDiff\b/.test(log)) {
    return true;
  }
  return false;
}

export function rustFmtCheckCommand(): string {
  return "cargo fmt --check";
}

export function rustClippyCommand(opts?: {
  packageName?: string;
  libDenyUnwrap?: boolean;
}): string {
  const deny = opts?.libDenyUnwrap
    ? "-- -D warnings -D clippy::unwrap_used -D clippy::expect_used -D clippy::await_holding_lock"
    : "-- -D warnings";
  return [
    "cargo clippy",
    cargoWorkspaceOrPackage(opts?.packageName),
    "--all-targets",
    CARGO_JSON_MESSAGE_FORMAT,
    deny,
  ]
    .filter(Boolean)
    .join(" ");
}

export function rustTestCommand(opts?: {
  packageName?: string;
  docTests?: boolean;
}): string {
  const doc = opts?.docTests ? "--doc" : "";
  return [
    "cargo test",
    cargoWorkspaceOrPackage(opts?.packageName),
    doc,
  ]
    .filter(Boolean)
    .join(" ");
}

export function rustMiriCommand(packageName?: string): string {
  const scope = packageName?.trim()
    ? cargoWorkspaceOrPackage(packageName)
    : "";
  return ["cargo +nightly miri test", scope].filter(Boolean).join(" ");
}

/** After a green cargo check: fmt, then clippy. Not test/miri. */
export function rustOuterVerifyCommands(opts?: {
  filePath?: string;
  isLib?: boolean;
}): string[] {
  const packageName = opts?.filePath
    ? cargoPackageForEditedPath(opts.filePath)
    : undefined;
  return [
    rustFmtCheckCommand(),
    rustClippyCommand({
      packageName,
      libDenyUnwrap: opts?.isLib,
    }),
  ];
}

export function miriGateItem(filePath?: string): {
  name: string;
  description: string;
  content: string;
} {
  const where = filePath ? ` (${filePath})` : "";
  return {
    name: "Miri gate",
    description: "unsafe touched",
    content: [
      `${MIRI_GATE_MARKER}${where}.`,
      "Run `builtin_build action=miri` (`cargo +nightly miri test`) before claiming soundness.",
      `If miri is missing: rustup +nightly component add miri (${MIRI_MISSING_MARKER}). Never invent UB-free claims.`,
    ].join(" "),
  };
}

export function looksLikeLibManifest(cargoToml: string): boolean {
  return /^\s*\[lib\]\s*$/m.test(cargoToml) || /^\s*path\s*=\s*"src\/lib\.rs"/m.test(
    cargoToml,
  );
}
