/**
 * MC-42: turn a verified, repeatedly-replayed recipe into a `SKILL.md` proposal.
 * Pure: returns text and a target name. The caller shows it to the user and writes it only on approval.
 * Only metadata and paths are emitted (never file bytes); text is passed through `redactSecrets`.
 */

import { parseFrontmatter } from "../../../skills/frontmatter";
import { isSensitiveSecretFile, redactSecrets } from "../../../util/redactSecrets";
import { isSafeRelPath } from "./preconditions";
import { replayableCommandProblem } from "./replayer";
import type { Recipe, RecipePrecondition, RecipeSlot } from "./types";

/** Replays (all ok) required before "Promote to skill" is offered. */
export const SKILL_PROMOTION_MIN_OK = 3;

export interface SkillProposal {
  name: string;
  description: string;
  content: string;
}

export function isSkillEligible(recipe: Recipe, minOk = SKILL_PROMOTION_MIN_OK): boolean {
  return (
    recipe.status === "verified" &&
    recipe.stats.ok >= minOk &&
    recipe.stats.reverted === 0 &&
    recipe.stats.failedVerify === 0
  );
}

export function skillNameFor(recipe: Recipe): string {
  const base = recipe.title || recipe.intentFingerprint || "recipe";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || `recipe-${recipe.id.slice(0, 8)}`;
}

function oneLine(s: string, max: number): string {
  const t = redactSecrets(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Returns undefined when the recipe is not eligible. */
export function buildSkillFromRecipe(recipe: Recipe, minOk = SKILL_PROMOTION_MIN_OK): SkillProposal | undefined {
  if (!isSkillEligible(recipe, minOk)) return undefined;
  const name = skillNameFor(recipe);
  const title = oneLine(recipe.title || recipe.intentText || name, 80);
  const description = oneLine(`Repeat the verified workflow: ${recipe.intentText || recipe.title || name}`, 200);

  const lines: string[] = [];
  lines.push("---", `name: ${name}`, `description: ${JSON.stringify(description)}`, "---", "", `# ${title}`, "");
  lines.push(
    `Verified ${recipe.stats.ok} time(s) with no reverts` +
      (recipe.oracle ? ` (oracle: ${recipe.oracle.kind}${recipe.oracle.command ? ` \`${oneLine(recipe.oracle.command, 80)}\`` : ""}).` : "."),
    "",
  );
  if (recipe.slots.length) {
    lines.push("## Inputs", "");
    for (const s of recipe.slots) lines.push(`- \`${s.name}\` (${s.kind})`);
    lines.push("");
  }
  if (recipe.preconditions.length) {
    lines.push("## Preconditions", "");
    for (const p of recipe.preconditions) lines.push(`- ${oneLine(`${p.kind}: ${p.value}`, 120)}`);
    lines.push("");
  }
  lines.push("## Steps", "");
  recipe.steps.forEach((st, i) => {
    if (st.kind === "command") lines.push(`${i + 1}. Run \`${oneLine(st.command ?? "", 120)}\``);
    else if (st.kind === "delete_file") lines.push(`${i + 1}. Delete \`${oneLine(st.path ?? "", 120)}\``);
    else lines.push(`${i + 1}. Create or update \`${oneLine(st.path ?? "", 120)}\``);
  });
  lines.push("", "## Verify", "", recipe.oracle?.command ? `Run \`${oneLine(recipe.oracle.command, 120)}\` and confirm it passes.` : "Confirm the project builds and tests pass.", "");
  return { name, description, content: lines.join("\n") };
}

const SLOT_KINDS = new Set<RecipeSlot["kind"]>(["identifier", "path", "package", "text"]);

export interface ParsedSkillRecipe {
  name: string;
  title: string;
  description: string;
  intentText: string;
  filePaths: string[];
  deletePaths: string[];
  commands: string[];
  verifyCommand?: string;
  slots: RecipeSlot[];
  preconditions: RecipePrecondition[];
}

/**
 * P6.4: parse a user-written SKILL.md (files + verify command) into a candidate
 * recipe sketch. No blobs yet — the host pins current-file hashes. Never
 * auto-replay: imported skills start as `candidate`.
 */
export function parseSkillToCandidate(raw: string): ParsedSkillRecipe | { ok: false; reason: string } {
  const text = redactSecrets(raw.replace(/\r\n/g, "\n"));
  const fm = parseFrontmatter(text);
  const body = fm?.content ?? (text.startsWith("---") ? "" : text);
  const name = (fm?.data.name ?? "").trim() || "imported-skill";
  const description = (fm?.data.description ?? "").trim();
  if (!body.trim() && !description) return { ok: false, reason: "skill has no body" };

  const filePaths: string[] = [];
  const deletePaths: string[] = [];
  const commands: string[] = [];
  const slots: RecipeSlot[] = [];
  const preconditions: RecipePrecondition[] = [];
  let verifyCommand: string | undefined;

  const addPath = (p: string, dest: string[]) => {
    const path = p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!path || dest.includes(path)) return;
    if (!isSafeRelPath(path) || isSensitiveSecretFile(path)) return;
    dest.push(path);
  };
  const addCommand = (cmd: string, dest: string[]) => {
    const command = cmd.trim();
    if (!command || dest.includes(command) || replayableCommandProblem(command)) return;
    dest.push(command);
  };

  const stepsBlock = section(body, "Steps");
  const verifyBlock = section(body, "Verify");
  const inputsBlock = section(body, "Inputs");
  const preBlock = section(body, "Preconditions");

  for (const line of (inputsBlock ?? "").split("\n")) {
    const m = line.match(/`([^`]+)`\s*\((\w+)\)/);
    if (!m) continue;
    const kind = m[2].toLowerCase();
    if (!SLOT_KINDS.has(kind as RecipeSlot["kind"])) continue;
    if (slots.some((s) => s.name === m[1])) continue;
    slots.push({ name: m[1], kind: kind as RecipeSlot["kind"] });
  }
  for (const line of (preBlock ?? "").split("\n")) {
    const m = line.match(/[-*]\s*(\w+)\s*:\s*(.+)$/);
    if (!m) continue;
    const value = m[2].replace(/^`|`$/g, "").trim();
    if (!value) continue;
    preconditions.push({ kind: m[1], value });
  }
  for (const line of (stepsBlock ?? body).split("\n")) {
    const run = line.match(/Run\s+`([^`]+)`/i);
    if (run) {
      addCommand(run[1], commands);
      continue;
    }
    const del = line.match(/Delete\s+`([^`]+)`/i);
    if (del) {
      addPath(del[1], deletePaths);
      continue;
    }
    const write = line.match(/Create or update\s+`([^`]+)`/i) || line.match(/update\s+`([^`]+)`/i);
    if (write) addPath(write[1], filePaths);
  }
  const verifyRun = (verifyBlock ?? "").match(/Run\s+`([^`]+)`/i);
  if (verifyRun) {
    const cmd = verifyRun[1].trim();
    if (!replayableCommandProblem(cmd)) verifyCommand = cmd;
  }

  if (!filePaths.length && !deletePaths.length && !commands.length && !verifyCommand) {
    return { ok: false, reason: "skill describes no files or verify command" };
  }
  const title = oneLine(description || name.replace(/-/g, " "), 80);
  return {
    name,
    title,
    description: oneLine(description || title, 200),
    intentText: description || title,
    filePaths,
    deletePaths,
    commands,
    verifyCommand,
    slots,
    preconditions,
  };
}

function section(body: string, heading: string): string | undefined {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const start = body.search(re);
  if (start < 0) return undefined;
  const after = body.slice(start).split(/\n/).slice(1);
  const lines: string[] = [];
  for (const line of after) {
    if (/^##\s+/.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n");
}
