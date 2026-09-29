/**
 * Defaults for new Cargo crates created by the Knox vscode extension
 * (create-new-file templates + rust-profile policy). Existing crates still
 * follow rust-toolchain.toml / package.edition.
 */

export const RUST_DEFAULT_EDITION = "2024";
export const RUST_DEFAULT_VERSION = "1.98.1";

/** Cargo package name from a path such as `snake/Cargo.toml`. */
export function cargoPackageNameFromPath(filepath: string): string {
  const posix = filepath.replace(/\\/g, "/");
  const parts = posix.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] ?? "";
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const raw = parent && parent !== "." ? parent : "app";
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "");
  return slug || "app";
}

export function isCargoTomlPath(filePath: string): boolean {
  return /(^|[/\\])Cargo\.toml$/i.test(filePath);
}

export function isRustToolchainPath(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  return /^rust-toolchain(?:\.toml)?$/i.test(base);
}

function upsertQuotedTomlKey(
  contents: string,
  key: string,
  value: string,
): string {
  const existing = new RegExp(`^(\\s*${key}\\s*=\\s*["'])[^"']*(["'])`, "m");
  if (existing.test(contents)) {
    return contents.replace(existing, `$1${value}$2`);
  }
  const line = `${key} = "${value}"`;
  const anchors = [
    /^\s*edition\s*=\s*["'].*$/m,
    /^\s*version\s*=\s*["'].*$/m,
    /^\s*name\s*=\s*["'].*$/m,
    /^\s*\[package\]\s*$/m,
    /^\s*\[workspace\.package\]\s*$/m,
  ];
  for (const anchor of anchors) {
    if (anchor.test(contents)) {
      return contents.replace(anchor, (matched) => `${matched}\n${line}`);
    }
  }
  if (contents.trim()) {
    return `[package]\n${line}\n${contents}`;
  }
  return `[package]\nname = "app"\nversion = "0.1.0"\n${line}\n`;
}

/** Force Knox new-crate defaults on a Cargo.toml body (LLM still emits 2021). */
export function applyNewRustCrateManifestDefaults(contents: string): string {
  let next = upsertQuotedTomlKey(contents, "edition", RUST_DEFAULT_EDITION);
  next = upsertQuotedTomlKey(next, "rust-version", RUST_DEFAULT_VERSION);
  return next;
}

export function applyNewRustToolchainDefaults(contents: string): string {
  const channel = new RegExp(`^(\\s*channel\\s*=\\s*["'])[^"']*(["'])`, "m");
  if (channel.test(contents)) {
    return contents.replace(channel, `$1${RUST_DEFAULT_VERSION}$2`);
  }
  const header = /^\s*\[toolchain\]\s*$/m;
  if (header.test(contents)) {
    return contents.replace(
      header,
      `[toolchain]\nchannel = "${RUST_DEFAULT_VERSION}"`,
    );
  }
  const body = contents.trim();
  return body
    ? `[toolchain]\nchannel = "${RUST_DEFAULT_VERSION}"\n${body}\n`
    : `[toolchain]\nchannel = "${RUST_DEFAULT_VERSION}"\n`;
}

/** Rewrite a new Cargo.toml / rust-toolchain.toml; leave other files alone. */
export function applyNewRustProjectFileDefaults(
  filePath: string,
  contents: string,
): string {
  if (isCargoTomlPath(filePath)) {
    return applyNewRustCrateManifestDefaults(contents);
  }
  if (isRustToolchainPath(filePath)) {
    return applyNewRustToolchainDefaults(contents);
  }
  return contents;
}

/**
 * Align Rust pins inside an edit snippet with what Knox actually wrote to disk.
 *
 * New crates are silently normalized to edition 2024 / rust-version 1.98.1, so
 * a model that remembers writing `edition = "2021"` will send that text as
 * `old_string` and miss. Used only as a fallback after an exact match fails.
 */
export function alignRustPinsInSnippet(
  filePath: string,
  snippet: string,
): string {
  if (isCargoTomlPath(filePath)) {
    return snippet
      .replace(
        /(\bedition\s*=\s*["'])[^"'\r\n]*(["'])/g,
        `$1${RUST_DEFAULT_EDITION}$2`,
      )
      .replace(
        /(\brust-version\s*=\s*["'])[^"'\r\n]*(["'])/g,
        `$1${RUST_DEFAULT_VERSION}$2`,
      );
  }
  if (isRustToolchainPath(filePath)) {
    return snippet.replace(
      /(\bchannel\s*=\s*["'])[^"'\r\n]*(["'])/g,
      `$1${RUST_DEFAULT_VERSION}$2`,
    );
  }
  return snippet;
}

/**
 * Tell the model when a new Cargo.toml / rust-toolchain.toml differed from what
 * it sent, so its next edit uses the real on-disk text. Empty when unchanged.
 */
export function describeRustDefaultsRewrite(
  filePath: string,
  requested: string,
  written: string,
): string {
  if (requested === written) {
    return "";
  }
  if (!isCargoTomlPath(filePath) && !isRustToolchainPath(filePath)) {
    return "";
  }
  const pins = written
    .split(/\r?\n/)
    .filter((line) => /^\s*(edition|rust-version|channel)\s*=/.test(line))
    .map((line) => line.trim())
    .join(", ");
  return (
    `Knox normalized new Rust project pins in "${filePath}" ` +
    `(${pins || `edition ${RUST_DEFAULT_EDITION}, rust-version ${RUST_DEFAULT_VERSION}`}). ` +
    "The file on disk differs from the text you sent: read it before editing " +
    "and use its exact lines as old_string."
  );
}

/**
 * `cargo new` / `cargo init` still emit edition 2021 on older cargo. Pin 2024.
 */
export function rewriteCargoNewCommand(command: string): string {
  if (!/\bcargo(?:\s+\+\S+)?\s+(new|init)\b/i.test(command)) {
    return command;
  }
  if (/\s--edition(?:\s|=)/.test(command)) {
    return command.replace(
      /--edition(?:\s+|=)(?:"[^"]+"|'[^']+'|\S+)/g,
      `--edition ${RUST_DEFAULT_EDITION}`,
    );
  }
  return command.replace(
    /\bcargo(?:\s+\+\S+)?\s+(new|init)\b/i,
    (matched) => `${matched} --edition ${RUST_DEFAULT_EDITION}`,
  );
}

export function formatNewRustCratePolicy(): string {
  return (
    `New crate: edition ${RUST_DEFAULT_EDITION}, rust-version ${RUST_DEFAULT_VERSION}, ` +
    `rust-toolchain.toml channel ${RUST_DEFAULT_VERSION}. ` +
    `Never write edition = "2021" on a new Cargo.toml. ` +
    "Existing crates: MSRV / edition from rust-toolchain.toml or package.edition — never newer syntax."
  );
}
