/**
 * K-027: generate a starter `AGENTS.md` from what the repo already says about
 * itself (manifests, scripts, top-level layout, codebase card). Pure; the
 * `/init` slash command does the IO.
 */

import { detectOracleCommand, type OracleProbe } from "../tools/build/oracleDetect";
import { discoverVerifyCommandFromProbe } from "./verifyDiscovery";

export interface AgentsMdInput extends OracleProbe {
  /** Root directory name. */
  projectName: string;
  /** Top-level directory names. */
  topDirs: string[];
  /** Output of `loadCodebaseCard` (kernel / QEMU / Cargo), if any. */
  codebaseCard?: string;
  /** Test files or dirs exist at the root (`tests`, `test`, `__tests__`). */
  hasTests?: boolean;
}

const SCRIPT_KEYS = ["build", "test", "lint", "typecheck", "dev", "start"];

function nodeScripts(packageJson?: string): Array<[string, string]> {
  try {
    const scripts = JSON.parse(packageJson ?? "{}").scripts as
      | Record<string, string>
      | undefined;
    if (!scripts) return [];
    return SCRIPT_KEYS.filter((k) => typeof scripts[k] === "string").map(
      (k) => [k, scripts[k]],
    );
  } catch {
    return [];
  }
}

function nodePackageName(packageJson?: string): string | undefined {
  try {
    const name = JSON.parse(packageJson ?? "{}").name;
    return typeof name === "string" && name ? name : undefined;
  } catch {
    return undefined;
  }
}

export function buildAgentsMd(input: AgentsMdInput): string {
  const name = nodePackageName(input.packageJson) ?? input.projectName;
  const lines: string[] = [`# ${name}`, ""];

  lines.push(
    "Instructions for coding agents working in this repository. Keep this file short;",
    "move long reference material into linked docs.",
    "",
  );

  const dirs = input.topDirs
    .filter((d) => d && !d.startsWith(".") && d !== "node_modules")
    .slice(0, 20);
  if (dirs.length) {
    lines.push("## Layout", "", ...dirs.map((d) => `- \`${d}/\``), "");
  }

  const commands: string[] = [];
  const scripts = nodeScripts(input.packageJson);
  for (const [key, body] of scripts) {
    commands.push(`- ${key}: \`npm run ${key}\` (${body})`);
  }
  const oracle = detectOracleCommand(input);
  if (oracle) {
    commands.push(`- check after edits: \`${oracle.command}\` (from ${oracle.reason})`);
  }
  if (input.entries.includes("Makefile")) {
    commands.push("- build: `make`");
  }
  lines.push("## Commands", "");
  lines.push(...(commands.length ? commands : ["- TODO: add build and test commands."]), "");

  const verify = discoverVerifyCommandFromProbe({
    entries: input.entries,
    packageJson: input.packageJson,
    pyproject: input.pyproject,
  });
  if (verify) {
    lines.push("## Test", "", "```", verify, "```", "");
  }

  if (input.codebaseCard?.trim()) {
    lines.push("## Project notes", "", input.codebaseCard.trim(), "");
  }

  lines.push(
    "## Working rules",
    "",
    "- Read a file before editing it. Make the smallest change that solves the task.",
    "- Run the check command above after changes and fix what it reports.",
    input.hasTests
      ? "- Add or update a test for behavior you change."
      : "- TODO: describe how tests are run, if there are any.",
    "- Do not commit secrets or edit generated files.",
    "",
  );
  return lines.join("\n");
}

/**
 * First fenced command under a Test / Verify heading (`/init` writes `## Test`).
 */
export function extractAgentsMdVerifyCommand(text: string): string | undefined {
  if (!text.trim()) {
    return undefined;
  }
  const heading =
    /^(#{1,3})\s+(test|tests|testing|verify|verification)\b[^\n]*$/gim;
  let match: RegExpExecArray | null;
  while ((match = heading.exec(text))) {
    const rest = text.slice(match.index + match[0].length);
    const fence = rest.match(/```[\w-]*\s*\n([\s\S]*?)```/);
    const command = fence?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (command) {
      return command;
    }
  }
  return undefined;
}
