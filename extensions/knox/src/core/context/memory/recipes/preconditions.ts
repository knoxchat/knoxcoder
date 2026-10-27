/**
 * Precondition checker (MC-22): before replay, confirm the workspace is in a
 * state where the recipe still makes sense. Replay is refused, with a
 * readable reason per failure, rather than guessed at.
 *
 * Pure: the host supplies a `PreconditionEnv` (fs reads, git status). The
 * checker reads only a bounded set of root manifests and the exact paths the
 * recipe names; it never walks the tree (MC-84).
 *
 * Kinds (`RecipePrecondition.kind`):
 *   file_exists   value = workspace-relative path that must exist
 *   file_absent   value = path that must not exist (a create step would clobber it)
 *   language      value = typescript | javascript | rust | python | go
 *   framework     value = react | next | vue | svelte | angular | express | cargo | ...
 *   dependency    value = package in package.json / Cargo.toml / requirements / pyproject
 *   clean_paths   value = path that must have no uncommitted changes
 */

import { detectWorkspaceKind } from "../../../config/agentProfile.js";
import type { Recipe, RecipePrecondition } from "./types.js";

export interface PreconditionEnv {
  /** Names directly under the workspace root. */
  rootEntries(): Promise<string[]>;
  /** Text of a workspace-relative file, or undefined when missing/unreadable. */
  readText(relPath: string): Promise<string | undefined>;
  exists(relPath: string): Promise<boolean>;
  /** Of `paths`, those with uncommitted changes. Return undefined when git state is unknown. */
  dirtyPaths(paths: string[]): Promise<string[] | undefined>;
}

export interface PreconditionFailure {
  precondition: RecipePrecondition;
  reason: string;
}

export interface PreconditionResult {
  ok: boolean;
  failures: PreconditionFailure[];
  /** One line for the user/log; empty when ok. */
  summary: string;
}

export function isSafeRelPath(p: string): boolean {
  if (!p || p.length > 400 || p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split("/").some((seg) => seg === "..");
}

const NPM_DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

async function npmDeps(env: PreconditionEnv): Promise<Set<string> | undefined> {
  const text = await env.readText("package.json");
  if (text === undefined) return undefined;
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    const out = new Set<string>();
    for (const f of NPM_DEP_FIELDS) {
      const deps = pkg[f];
      if (deps && typeof deps === "object") for (const k of Object.keys(deps)) out.add(k);
    }
    return out;
  } catch {
    return undefined;
  }
}

function cargoDeps(text: string): Set<string> {
  const out = new Set<string>();
  let inDeps = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      inDeps = /(^|\.)(dev-|build-)?dependencies$/.test(header[1]) || /^(workspace\.)?dependencies$/.test(header[1]);
      const sub = /dependencies\.([\w-]+)$/.exec(header[1]);
      if (sub) out.add(sub[1]);
      continue;
    }
    if (inDeps) {
      const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

function pyDeps(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/["']?([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[=<>~!\[;]|["',]|$)/gm)) out.add(m[1].toLowerCase());
  return out;
}

async function hasDependency(env: PreconditionEnv, name: string): Promise<boolean> {
  const npm = await npmDeps(env);
  if (npm?.has(name)) return true;
  const cargo = await env.readText("Cargo.toml");
  if (cargo !== undefined && cargoDeps(cargo).has(name)) return true;
  for (const f of ["requirements.txt", "pyproject.toml"]) {
    const t = await env.readText(f);
    if (t !== undefined && pyDeps(t).has(name.toLowerCase())) return true;
  }
  return false;
}

export async function detectLanguages(env: PreconditionEnv): Promise<Set<string>> {
  const entries = new Set(await env.rootEntries());
  const langs = new Set<string>();
  if (entries.has("tsconfig.json")) langs.add("typescript");
  if (entries.has("package.json")) langs.add("javascript");
  if (entries.has("Cargo.toml")) langs.add("rust");
  if (entries.has("pyproject.toml") || entries.has("requirements.txt") || entries.has("setup.py")) langs.add("python");
  if (entries.has("go.mod")) langs.add("go");
  // TypeScript projects are also JavaScript projects.
  if (langs.has("typescript")) langs.add("javascript");
  return langs;
}

/** One language tag a recipe should carry; more specific wins over javascript. */
const LANGUAGE_PRIORITY = ["rust", "python", "go", "typescript", "javascript"] as const;

async function detectFrameworks(env: PreconditionEnv): Promise<Set<string>> {
  const out = new Set<string>();
  const deps = await npmDeps(env);
  if (deps) {
    for (const f of ["react", "next", "vue", "svelte", "express", "fastify", "nest", "vite", "electron"]) {
      if (deps.has(f) || deps.has(`@${f}js/core`)) out.add(f);
    }
    if (deps.has("@angular/core")) out.add("angular");
    if (deps.has("@nestjs/core")) out.add("nest");
  }
  const kind = detectWorkspaceKind(await env.rootEntries());
  if (kind) out.add(kind);
  return out;
}

async function checkOne(env: PreconditionEnv, p: RecipePrecondition): Promise<string | undefined> {
  const value = p.value.trim();
  switch (p.kind) {
    case "file_exists":
    case "file_absent":
    case "clean_paths":
      if (!isSafeRelPath(value)) return `path "${value}" is not a safe workspace-relative path`;
  }
  switch (p.kind) {
    case "file_exists":
      return (await env.exists(value)) ? undefined : `required file ${value} does not exist`;
    case "file_absent":
      return (await env.exists(value)) ? `${value} already exists and would be overwritten` : undefined;
    case "language": {
      const langs = await detectLanguages(env);
      return langs.has(value.toLowerCase()) ? undefined : `workspace is not a ${value} project`;
    }
    case "framework": {
      const fw = await detectFrameworks(env);
      return fw.has(value.toLowerCase()) ? undefined : `framework ${value} not detected`;
    }
    case "dependency":
      return (await hasDependency(env, value)) ? undefined : `dependency ${value} is not declared`;
    case "clean_paths": {
      const dirty = await env.dirtyPaths([value]);
      if (dirty === undefined) return `could not determine git state for ${value}`;
      return dirty.length ? `${value} has uncommitted changes` : undefined;
    }
    default:
      // Unknown kinds fail closed: a newer recipe must not replay under an older checker.
      return `unknown precondition kind "${p.kind}"`;
  }
}

/**
 * MC-84: one check run reads each root manifest once and asks git about every `clean_paths`
 * entry in a single call (not one `git status` per path). Nothing here enumerates the tree.
 */
function memoizedEnv(env: PreconditionEnv, preconditions: readonly RecipePrecondition[]): PreconditionEnv {
  let root: Promise<string[]> | undefined;
  const texts = new Map<string, Promise<string | undefined>>();
  const present = new Map<string, Promise<boolean>>();
  const cleanPaths = [
    ...new Set(preconditions.filter((p) => p.kind === "clean_paths" && isSafeRelPath(p.value.trim())).map((p) => p.value.trim())),
  ];
  let dirty: Promise<string[] | undefined> | undefined;
  const once = <T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>) => m.get(k) ?? m.set(k, f()).get(k)!;
  return {
    rootEntries: () => (root ??= env.rootEntries()),
    readText: (rel) => once(texts, rel, () => env.readText(rel)),
    exists: (rel) => once(present, rel, () => env.exists(rel)),
    dirtyPaths: async (paths) => {
      if (paths.every((x) => cleanPaths.includes(x))) {
        const all = await (dirty ??= env.dirtyPaths(cleanPaths));
        return all === undefined ? undefined : paths.filter((x) => all.includes(x));
      }
      return env.dirtyPaths(paths);
    },
  };
}

export async function checkPreconditions(
  preconditions: readonly RecipePrecondition[],
  rawEnv: PreconditionEnv,
): Promise<PreconditionResult> {
  const env = memoizedEnv(rawEnv, preconditions);
  const failures: PreconditionFailure[] = [];
  for (const precondition of preconditions) {
    let reason: string | undefined;
    try {
      reason = await checkOne(env, precondition);
    } catch (err) {
      reason = `could not check ${precondition.kind} ${precondition.value}: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (reason) failures.push({ precondition, reason });
  }
  return {
    ok: failures.length === 0,
    failures,
    summary: failures.length ? `Replay refused: ${failures.map((f) => f.reason).join("; ")}` : "",
  };
}

/**
 * Language / framework checks so a recipe captured in a React/TS tree does not
 * exact-replay in a Rust crate. Does not list every dependency (too brittle).
 */
export async function deriveEnvironmentPreconditions(env: PreconditionEnv): Promise<RecipePrecondition[]> {
  const out: RecipePrecondition[] = [];
  const langs = await detectLanguages(env);
  const language = LANGUAGE_PRIORITY.find((l) => langs.has(l));
  if (language) out.push({ kind: "language", value: language });
  for (const framework of [...(await detectFrameworks(env))].sort()) {
    out.push({ kind: "framework", value: framework });
  }
  return out;
}

/**
 * Derive the checks a recipe should carry from its steps: files it modifies
 * must exist, files it creates must not, and every touched path must be clean.
 */
export function derivePreconditions(steps: Recipe["steps"]): RecipePrecondition[] {
  const out: RecipePrecondition[] = [];
  const seen = new Set<string>();
  const add = (kind: string, value: string) => {
    const k = `${kind}\0${value}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ kind, value });
    }
  };
  for (const s of steps) {
    if (!s.path || s.kind === "command") continue;
    if (s.kind === "delete_file" || s.baseBlobHash) add("file_exists", s.path);
    else add("file_absent", s.path);
    add("clean_paths", s.path);
  }
  return out;
}
