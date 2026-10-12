/**
 * MC-45: optional `gh` hand-off. Default off; every submission needs an explicit `confirmed: true`
 * for that call. The runner is injected so tests never spawn `gh`.
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import type { IssueDraft } from "./issueDraft";

export type GhRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface GhSubmitOptions {
  /** Master switch (`knoxchat.selfImprove.enabled` and the user opting in to gh). Default off. */
  enabled: boolean;
  /** Must be true for this one submission. */
  confirmed: boolean;
  kind?: "issue" | "pr";
  /** `owner/name`. Omitted: gh uses the current repo. */
  repo?: string;
  /** PR only: head branch that already exists on the remote. */
  head?: string;
  runner?: GhRunner;
}

export type GhSubmitResult =
  | { ok: true; url: string }
  | { ok: false; reason: "disabled" | "not_confirmed" | "gh_missing" | "gh_failed" | "invalid"; message: string };

export const defaultGhRunner: GhRunner = (args) =>
  new Promise((resolve) => {
    execFile("gh", args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as any).code as number) : 127) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (err ? err.message : "")) });
    });
  });

export async function isGhAvailable(runner: GhRunner = defaultGhRunner): Promise<boolean> {
  return (await runner(["--version"])).code === 0;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;

export async function submitWithGh(draft: IssueDraft, opts: GhSubmitOptions): Promise<GhSubmitResult> {
  if (!opts.enabled) return { ok: false, reason: "disabled", message: "gh hand-off is off" };
  if (opts.confirmed !== true) return { ok: false, reason: "not_confirmed", message: "user confirmation required for each submission" };
  if (opts.repo && !REPO_RE.test(opts.repo)) return { ok: false, reason: "invalid", message: "invalid repo name" };
  const kind = opts.kind ?? "issue";
  if (kind === "pr" && (!opts.head || !BRANCH_RE.test(opts.head) || opts.head.startsWith("-"))) {
    return { ok: false, reason: "invalid", message: "a valid head branch is required for a PR" };
  }

  const runner = opts.runner ?? defaultGhRunner;
  if (!(await isGhAvailable(runner))) return { ok: false, reason: "gh_missing", message: "`gh` is not installed or not on PATH" };

  // Body goes through a file so no draft text is ever parsed as a flag or shell input.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-gh-"));
  const bodyFile = path.join(dir, "body.md");
  fs.writeFileSync(bodyFile, draft.body);
  try {
    const args = kind === "pr" ? ["pr", "create", "--title", draft.title, "--body-file", bodyFile, "--head", opts.head!] : ["issue", "create", "--title", draft.title, "--body-file", bodyFile];
    if (opts.repo) args.push("--repo", opts.repo);
    const res = await runner(args);
    if (res.code !== 0) return { ok: false, reason: "gh_failed", message: res.stderr.trim().slice(0, 300) || `gh exited ${res.code}` };
    return { ok: true, url: res.stdout.trim().split("\n").pop() ?? "" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
