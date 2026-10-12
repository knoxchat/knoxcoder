/**
 * MC-44: GitHub issue drafter. Builds a draft from findings, redacts it, and exposes a
 * "what will be shared" preview. Drafts are stored locally; nothing is sent from here.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { redactSecrets } from "../../../util/redactSecrets";
import type { Finding } from "../recipes/selfReview";

export interface IssueEvidence {
  label: string;
  /** Log excerpt, checkpoint summary, etc. */
  text: string;
  checkpointId?: string;
}

export interface IssueDraftInput {
  findings: Finding[];
  evidence: IssueEvidence[];
  suspectedFiles: string[];
  /** Absolute workspace root, rewritten to `<repo>`. */
  workspaceRoot?: string;
  homeDir?: string;
  title?: string;
  repro?: string[];
  now?: Date;
}

export interface IssueDraft {
  id: string;
  title: string;
  body: string;
  suspectedFiles: string[];
  createdAt: string;
}

const MAX_EVIDENCE_CHARS = 1200;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Secrets first, then workspace root -> `<repo>`, then any home directory -> `~`. */
export function scrubForSharing(text: string, workspaceRoot?: string, homeDir: string = os.homedir()): string {
  let out = redactSecrets(text);
  const roots = [workspaceRoot, homeDir].filter((r): r is string => !!r && r.length > 1);
  for (const r of roots) {
    const variants = new Set([r, r.replace(/\\/g, "/"), r.replace(/\//g, "\\")]);
    const repl = r === workspaceRoot ? "<repo>" : "~";
    for (const v of variants) out = out.replace(new RegExp(escapeRe(v), "gi"), repl);
  }
  return out
    .replace(/\/(?:Users|home)\/[^/\s"'`]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/g, "~");
}

function stableId(title: string, body: string): string {
  let h = 7;
  for (const ch of `${title}\n${body}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function buildIssueDraft(input: IssueDraftInput): IssueDraft {
  const clean = (t: string) => scrubForSharing(t, input.workspaceRoot, input.homeDir);
  const top = input.findings[0];
  const title = clean(input.title ?? (top ? `Repeated ${top.kind.replace("_", " ")}: ${top.signature}` : "Issue report")).slice(0, 120);

  const body: string[] = ["## Summary", ""];
  if (input.findings.length === 0) body.push("_No repeated findings recorded._");
  for (const f of input.findings) body.push(`- ${clean(f.signature)} (${f.kind}, seen ${f.count}x)`);

  body.push("", "## Steps to reproduce", "");
  const repro = input.repro?.length ? input.repro : ["_Not recorded. Please fill in before submitting._"];
  repro.forEach((r, i) => body.push(`${i + 1}. ${clean(r)}`));

  body.push("", "## Evidence", "");
  if (input.evidence.length === 0) body.push("_None attached._");
  for (const e of input.evidence) {
    const cp = e.checkpointId ? ` (checkpoint ${e.checkpointId.slice(0, 12)})` : "";
    body.push(`**${clean(e.label)}**${cp}`, "", "```", clean(e.text).slice(0, MAX_EVIDENCE_CHARS), "```", "");
  }

  body.push("## Suspected files", "");
  const files = [...new Set(input.suspectedFiles.map((f) => clean(f)))];
  if (files.length === 0) body.push("_Unknown._");
  for (const f of files) body.push(`- \`${f}\``);

  const text = body.join("\n");
  return {
    id: stableId(title, text),
    title,
    body: text,
    suspectedFiles: files,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Exactly what would leave the machine if the user submits. */
export function previewShare(draft: IssueDraft): string {
  return [
    "This will be shared (review before approving):",
    "",
    `Title: ${draft.title}`,
    `Size: ${draft.body.length} characters, ${draft.suspectedFiles.length} file path(s)`,
    "",
    draft.body,
  ].join("\n");
}

export function saveIssueDraft(draft: IssueDraft, draftsDir: string): string {
  fs.mkdirSync(draftsDir, { recursive: true });
  const file = path.join(draftsDir, `issue-${draft.id}.md`);
  fs.writeFileSync(file, `# ${draft.title}\n\n${draft.body}\n`);
  return file;
}
