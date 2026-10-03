/**
 * Team sharing (K-052): export a project's shared Knox setup as one versioned
 * JSON bundle and import it into another checkout.
 *
 * Included: `.knoxrules`, `AGENTS.md`, `.knox/AGENTS.md`, `.knox/hooks.json`,
 * `.knox/agents/*.md` and `skills/**`. Never included: `.knox/config.yaml`
 * (can hold provider settings), credentials, memory or checkpoints.
 *
 * Safety: export refuses files that contain secrets. Import only writes the
 * allowed paths, rejects anything that escapes the target directory, keeps
 * existing files unless `overwrite`, and skips `.knox/hooks.json` (it runs
 * commands) unless `allowHooks`.
 */

import fs from "node:fs";
import path from "node:path";

import { containsSecret } from "../util/redactSecrets";

export const TEAM_BUNDLE_VERSION = 1;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 200;

export interface TeamBundleFile {
  path: string;
  content: string;
}

export interface TeamBundle {
  format: "knox-team-bundle";
  version: number;
  name: string;
  createdAt: string;
  files: TeamBundleFile[];
}

const SINGLE_FILES = [
  ".knoxrules",
  "AGENTS.md",
  ".knox/AGENTS.md",
  ".knox/hooks.json",
];
const DIRS = [
  { dir: ".knox/agents", ext: /\.md$/i },
  { dir: "skills", ext: /.*/ },
];

const HOOKS_PATH = ".knox/hooks.json";

export function isAllowedBundlePath(rel: string): boolean {
  if (!rel || rel.includes("\0") || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) {
    return false;
  }
  const norm = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (norm.startsWith("../") || norm === ".." || norm.includes("/../")) {
    return false;
  }
  if (SINGLE_FILES.includes(norm)) {
    return true;
  }
  return DIRS.some(({ dir }) => norm.startsWith(`${dir}/`) && norm.length > dir.length + 1);
}

function walk(root: string, rel: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".git") walk(root, next, out);
    } else if (e.isFile()) {
      out.push(next);
    }
  }
}

export interface ExportResult {
  bundle: TeamBundle;
  /** Files left out and why (secret found, too large, too many). */
  skipped: { path: string; reason: string }[];
}

export function exportTeamBundle(dir: string, name?: string): ExportResult {
  const root = path.resolve(dir);
  const candidates = [...SINGLE_FILES];
  for (const { dir: d, ext } of DIRS) {
    const found: string[] = [];
    walk(root, d, found);
    candidates.push(...found.filter((f) => ext.test(f)));
  }
  const files: TeamBundleFile[] = [];
  const skipped: ExportResult["skipped"] = [];
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "larger than 256 KB" });
      continue;
    }
    if (files.length >= MAX_FILES) {
      skipped.push({ path: rel, reason: `more than ${MAX_FILES} files` });
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("\0")) {
      skipped.push({ path: rel, reason: "binary file" });
      continue;
    }
    if (containsSecret(content)) {
      skipped.push({ path: rel, reason: "contains what looks like a secret" });
      continue;
    }
    files.push({ path: rel, content });
  }
  return {
    bundle: {
      format: "knox-team-bundle",
      version: TEAM_BUNDLE_VERSION,
      name: name || path.basename(root),
      createdAt: new Date().toISOString(),
      files,
    },
    skipped,
  };
}

export function parseTeamBundle(text: string): TeamBundle | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "not valid JSON" };
  }
  const b = raw as Partial<TeamBundle>;
  if (b?.format !== "knox-team-bundle" || !Array.isArray(b.files)) {
    return { error: "not a Knox team bundle" };
  }
  if (typeof b.version !== "number" || b.version > TEAM_BUNDLE_VERSION) {
    return { error: `bundle version ${b.version} is newer than this Knox understands (${TEAM_BUNDLE_VERSION})` };
  }
  const files = b.files.filter(
    (f): f is TeamBundleFile =>
      !!f && typeof f.path === "string" && typeof f.content === "string",
  );
  return {
    format: "knox-team-bundle",
    version: b.version,
    name: typeof b.name === "string" ? b.name : "bundle",
    createdAt: typeof b.createdAt === "string" ? b.createdAt : "",
    files,
  };
}

export interface ImportResult {
  written: string[];
  skipped: { path: string; reason: string }[];
}

export function importTeamBundle(
  bundle: TeamBundle,
  dir: string,
  opts: { overwrite?: boolean; allowHooks?: boolean; dryRun?: boolean } = {},
): ImportResult {
  const root = path.resolve(dir);
  const written: string[] = [];
  const skipped: ImportResult["skipped"] = [];
  for (const file of bundle.files) {
    const rel = file.path.replace(/\\/g, "/");
    if (!isAllowedBundlePath(rel)) {
      skipped.push({ path: file.path, reason: "path not allowed" });
      continue;
    }
    if (rel === HOOKS_PATH && !opts.allowHooks) {
      skipped.push({ path: rel, reason: "hooks run commands; pass --allow-hooks to import" });
      continue;
    }
    if (file.content.length > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "larger than 256 KB" });
      continue;
    }
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      skipped.push({ path: rel, reason: "escapes the target directory" });
      continue;
    }
    if (fs.existsSync(abs) && !opts.overwrite) {
      skipped.push({ path: rel, reason: "exists (use --force to overwrite)" });
      continue;
    }
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.content);
    }
    written.push(rel);
  }
  return { written, skipped };
}
