/**
 * Keep Cargo's `target/` build directory out of git, always.
 *
 * Applies to new AND existing Rust projects: whenever the Agent harness runs a
 * cargo command (or creates a crate) we make sure the workspace root's
 * `.gitignore` covers `target`. Only ever appends a single `/target/` line; an
 * existing rule that already covers `target` (here or in a parent `.gitignore`
 * inside the workspace) is left untouched.
 */

import fs from "node:fs";
import path from "node:path";

export const CARGO_TARGET_IGNORE_LINE = "/target/";

/**
 * True when the shell command invokes cargo (optionally `cargo +toolchain`) or
 * the Rust gate script, which runs cargo for every crate it discovers.
 */
export function shellInvokesCargo(command: string): boolean {
  return (
    /(?:^|[\s;|&(])cargo(?:\s|$)/i.test(command) ||
    /(?:^|[\s;|&(])(?:bash\s+|sh\s+|\.\/)?(?:[\w./-]*\/)?scripts\/pre-commit\.sh(?:\s|$)/i.test(
      command,
    )
  );
}

/** Posix-style path of `dir` relative to `base` ("" when equal). */
function relPosix(base: string, dir: string): string {
  return path.relative(base, dir).split(path.sep).join("/");
}

/**
 * Does a `.gitignore` body ignore `<rel>/target`, where `rel` is the path of
 * the Cargo root relative to the directory holding that `.gitignore`?
 * Last matching rule wins, so a later `!target` re-includes it.
 */
export function gitignoreCoversCargoTarget(
  contents: string,
  rel: string = "",
): boolean {
  const anchoredPrefix = rel ? `/${rel}/` : "/";
  const relPrefix = rel ? `${rel}/` : "";
  let covered = false;
  for (const raw of contents.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const negated = line.startsWith("!");
    if (negated) {
      line = line.slice(1);
    }
    // `target`, `target/`, `target/*`, `target/**` are equivalent for our purpose.
    const body = line.replace(/\/(?:\*{1,2})?$/, "");
    const matches =
      body === "target" ||
      body === "**/target" ||
      body === `${anchoredPrefix}target` ||
      body === `${relPrefix}target`;
    if (matches) {
      covered = !negated;
    }
  }
  return covered;
}

/**
 * Pure helper: return the new `.gitignore` body, or `undefined` when `target`
 * is already ignored. `existing` is `undefined` for a missing file.
 */
export function withCargoTargetIgnored(
  existing: string | undefined,
): string | undefined {
  if (existing === undefined) {
    return `${CARGO_TARGET_IGNORE_LINE}\n`;
  }
  if (gitignoreCoversCargoTarget(existing)) {
    return undefined;
  }
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const sep = existing.length === 0 || /\r?\n$/.test(existing) ? "" : eol;
  return `${existing}${sep}${CARGO_TARGET_IGNORE_LINE}${eol}`;
}

function isInside(root: string, dir: string): boolean {
  return dir === root || dir.startsWith(root + path.sep);
}

function readManifest(dir: string): string | undefined {
  try {
    return fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Directory that owns `target/` for the crate containing `startDir`: the
 * enclosing `[workspace]` root when there is one, else the nearest Cargo.toml.
 * Never leaves `workspaceRoot`.
 */
export function findCargoTargetRoot(
  startDir: string,
  workspaceRoot: string,
): string | undefined {
  const root = path.resolve(workspaceRoot);
  let dir = path.resolve(startDir);
  if (!isInside(root, dir)) {
    return undefined;
  }
  let nearest: string | undefined;
  for (;;) {
    const manifest = readManifest(dir);
    if (manifest !== undefined) {
      if (/^\s*\[workspace\]/m.test(manifest)) {
        return dir;
      }
      nearest ??= dir;
    }
    const parent = path.dirname(dir);
    if (dir === root || parent === dir) {
      return nearest;
    }
    dir = parent;
  }
}

/** A `.gitignore` between `cargoRoot` and `workspaceRoot` already covers target. */
function coveredByAncestor(cargoRoot: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot);
  let dir = cargoRoot;
  for (;;) {
    try {
      const body = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
      if (gitignoreCoversCargoTarget(body, relPosix(dir, cargoRoot))) {
        return true;
      }
    } catch {
      // no .gitignore here
    }
    const parent = path.dirname(dir);
    if (dir === root || parent === dir) {
      return false;
    }
    dir = parent;
  }
}

/**
 * Ensure `target/` is git-ignored for the Cargo project containing any of
 * `startDirs`. Returns a note for the model (empty when nothing changed).
 * Best effort: filesystem errors never fail the caller.
 */
export function ensureCargoTargetIgnored(
  startDirs: Array<string | undefined>,
  workspaceRoot: string,
): string {
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const start of startDirs) {
    if (!start) {
      continue;
    }
    try {
      const cargoRoot = findCargoTargetRoot(start, workspaceRoot);
      if (!cargoRoot || seen.has(cargoRoot)) {
        continue;
      }
      seen.add(cargoRoot);
      if (coveredByAncestor(cargoRoot, workspaceRoot)) {
        continue;
      }
      const file = path.join(cargoRoot, ".gitignore");
      let existing: string | undefined;
      try {
        existing = fs.readFileSync(file, "utf8");
      } catch {
        existing = undefined;
      }
      const next = withCargoTargetIgnored(existing);
      if (next === undefined) {
        continue;
      }
      fs.writeFileSync(file, next, "utf8");
      changed.push(file);
    } catch {
      // best effort
    }
  }
  if (!changed.length) {
    return "";
  }
  return (
    `Knox added "${CARGO_TARGET_IGNORE_LINE}" to ${changed.map((f) => `"${f}"`).join(", ")} ` +
    "so Cargo's target/ build directory stays out of git. Never commit or `git add` target/."
  );
}
