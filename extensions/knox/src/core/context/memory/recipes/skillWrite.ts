/**
 * MC-42: write an approved skill proposal to disk. The only writer for "Promote to skill";
 * the caller has already shown the proposal to the user and got a yes.
 *
 * It never overwrites: a skill with the same name is kept as it is.
 */

import * as fs from "fs";
import * as path from "path";

import { parseFrontmatter } from "../../../skills/frontmatter.js";
import type { SkillProposal } from "./skillFromRecipe.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type SkillWriteResult =
  | { ok: true; path: string }
  | { ok: false; reason: "invalid_name" | "invalid_frontmatter" | "exists" | "write_failed"; detail?: string };

/** `skillsDir` is the folder that holds one sub-folder per skill (`<workspace>/skills` or `~/.knoxcoder/skills`). */
export function writeSkillProposal(proposal: SkillProposal, skillsDir: string): SkillWriteResult {
  if (!NAME_RE.test(proposal.name)) return { ok: false, reason: "invalid_name" };
  const fm = parseFrontmatter(proposal.content);
  if (!fm || fm.data.name !== proposal.name || !String(fm.data.description ?? "").trim()) {
    return { ok: false, reason: "invalid_frontmatter" };
  }
  const dir = path.join(skillsDir, proposal.name);
  const file = path.join(dir, "SKILL.md");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, proposal.content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, reason: "exists" };
    return { ok: false, reason: "write_failed", detail: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, path: file };
}
