/**
 * After `cargo new` / `cargo init` creates a NEW crate, pin it to the Knox
 * defaults (rust-version + rust-toolchain.toml channel).
 *
 * Existing projects are never touched: we only act when this very command
 * created the crate's Cargo.toml, never overwrite a rust-version that is
 * already set, and skip rust-toolchain.toml when the crate (or a parent
 * workspace up to the workspace root) already has one.
 */

import fs from "node:fs";
import path from "node:path";

import {
  applyNewRustCrateManifestDefaults,
  applyNewRustToolchainDefaults,
  RUST_DEFAULT_VERSION,
} from "./rustDefaults";

export interface CargoNewPlan {
  kind: "new" | "init";
  /** Absolute directory that will hold the new crate's Cargo.toml. */
  targetDir: string;
  /** Upper bound when looking for an inherited rust-toolchain file. */
  workspaceRoot: string;
  /** True when Cargo.toml was already there before the command ran. */
  manifestExisted: boolean;
}

/** `cargo new|init` flags that consume the following token. */
const VALUE_FLAGS = new Set([
  "--name",
  "--vcs",
  "--edition",
  "--registry",
  "--color",
  "--config",
  "-Z",
  "-C",
  "--manifest-path",
]);

function unquote(token: string): string {
  const m = token.match(/^(["'])(.*)\1$/);
  return m ? m[2] : token;
}

function tokenize(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
}

/**
 * Parse the first `cargo new|init` in a shell command (optionally preceded by
 * `cd <dir> &&`). Returns undefined when the target directory is not clear.
 */
export function parseCargoNewCommand(
  command: string,
): { kind: "new" | "init"; targetArg: string; cdArg?: string } | undefined {
  const match = /\bcargo(?:\s+\+\S+)?\s+(new|init)\b/i.exec(command);
  if (!match) {
    return undefined;
  }
  const kind = match[1].toLowerCase() as "new" | "init";
  const tail = command
    .slice(match.index + match[0].length)
    .split(/&&|\|\||[;|]/)[0];
  const tokens = tokenize(tail);
  let positional: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      if (!token.includes("=") && VALUE_FLAGS.has(token)) {
        i++;
      }
      continue;
    }
    positional = token;
    break;
  }
  if (kind === "new" && !positional) {
    return undefined;
  }

  const head = command.slice(0, match.index);
  const cd = /(?:^|&&|;)\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&\s*$/.exec(head);
  return {
    kind,
    targetArg: positional ?? ".",
    cdArg: cd ? unquote(cd[1]) : undefined,
  };
}

/** Snapshot state before the command runs. Undefined when not a cargo new/init. */
export function planCargoNewFinalize(
  command: string,
  cwd: string,
  workspaceRoot: string,
): CargoNewPlan | undefined {
  const parsed = parseCargoNewCommand(command);
  if (!parsed) {
    return undefined;
  }
  const base = parsed.cdArg ? path.resolve(cwd, parsed.cdArg) : cwd;
  const targetDir = path.resolve(base, parsed.targetArg);
  let manifestExisted = false;
  try {
    manifestExisted = fs.existsSync(path.join(targetDir, "Cargo.toml"));
  } catch {
    manifestExisted = true; // be conservative: assume it is an existing project
  }
  return { kind: parsed.kind, targetDir, workspaceRoot, manifestExisted };
}

function findInheritedToolchain(
  targetDir: string,
  workspaceRoot: string,
): string | undefined {
  const root = path.resolve(workspaceRoot);
  let dir = path.resolve(targetDir);
  const within = dir === root || dir.startsWith(root + path.sep);
  for (;;) {
    for (const name of ["rust-toolchain.toml", "rust-toolchain"]) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (!within || dir === root || parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Apply Knox pins to a crate that `cargo new|init` just created.
 * Returns a note for the model (empty when nothing was changed).
 */
export function finalizeNewCargoProject(plan: CargoNewPlan): string {
  if (plan.manifestExisted) {
    return "";
  }
  const manifestPath = path.join(plan.targetDir, "Cargo.toml");
  const notes: string[] = [];
  try {
    if (!fs.existsSync(manifestPath)) {
      return "";
    }
    const before = fs.readFileSync(manifestPath, "utf8");
    if (!/^\s*rust-version\s*=/m.test(before)) {
      const after = applyNewRustCrateManifestDefaults(before);
      if (after !== before) {
        fs.writeFileSync(manifestPath, after, "utf8");
        notes.push(`Cargo.toml: rust-version = "${RUST_DEFAULT_VERSION}"`);
      }
    }

    const inherited = findInheritedToolchain(plan.targetDir, plan.workspaceRoot);
    if (!inherited) {
      fs.writeFileSync(
        path.join(plan.targetDir, "rust-toolchain.toml"),
        applyNewRustToolchainDefaults(""),
        "utf8",
      );
      notes.push(`rust-toolchain.toml: channel = "${RUST_DEFAULT_VERSION}"`);
    }
  } catch {
    return "";
  }
  if (!notes.length) {
    return "";
  }
  return (
    `Knox pinned the new crate at "${plan.targetDir}" (${notes.join("; ")}). ` +
    "Read Cargo.toml before editing it and use its exact lines as old_string."
  );
}
