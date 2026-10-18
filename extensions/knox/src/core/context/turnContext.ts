/**
 * Bounded per-turn editor state (P1.3): active file, open editors, git
 * porcelain, and diagnostics. Volatile — injected after the stable system
 * prefix so it does not break the prompt cache.
 */

import type { IDE, Problem } from "..";
import { redactSecrets } from "../util/redactSecrets";
import { getCleanUriPath } from "../util/uri";

export const TURN_CONTEXT_MARKER = "Turn Context";

const OPEN_EDITOR_CAP = 12;
const GIT_LINE_CAP = 40;
const DIAGNOSTIC_CAP = 8;

let injected = "";

export function setTurnContextInject(text: string): void {
  injected = text.trim();
}

export function formatTurnContextInject(): string {
  return injected;
}

export function resetTurnContextForTests(): void {
  injected = "";
}

export function shortPath(uriOrPath: string): string {
  const raw = uriOrPath.trim();
  if (!raw) {
    return "";
  }
  try {
    const clean = raw.includes("://") ? getCleanUriPath(raw) : raw.replace(/\\/g, "/");
    const parts = clean.split("/").filter(Boolean);
    if (parts.length <= 3) {
      return decodeURIComponent(clean);
    }
    return decodeURIComponent(parts.slice(-3).join("/"));
  } catch {
    const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.slice(-3).join("/") || raw;
  }
}

function capLines(text: string, max: number): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length <= max) {
    return lines.join("\n");
  }
  return `${lines.slice(0, max).join("\n")}\n… (${lines.length - max} more)`;
}

export function buildTurnContext(input: {
  activePath?: string;
  cursorLine?: number;
  openPaths?: string[];
  gitPorcelain?: string;
  problems?: Problem[];
}): string {
  const lines: string[] = [`## ${TURN_CONTEXT_MARKER}`];
  if (input.activePath) {
    const loc =
      typeof input.cursorLine === "number" && input.cursorLine > 0
        ? `${shortPath(input.activePath)}:${input.cursorLine}`
        : shortPath(input.activePath);
    lines.push(`Active: ${loc}`);
  }
  const open = [...new Set(input.openPaths ?? [])]
    .filter((path) => path && path !== input.activePath)
    .slice(0, OPEN_EDITOR_CAP)
    .map(shortPath)
    .filter(Boolean);
  if (open.length) {
    lines.push(`Open: ${open.join(", ")}`);
  }
  const git = (input.gitPorcelain ?? "").trim();
  if (git) {
    lines.push("Git:", capLines(git, GIT_LINE_CAP));
  }
  const problems = input.problems ?? [];
  if (problems.length) {
    const errors = problems.filter(
      (problem) => !problem.severity || problem.severity === "error",
    ).length;
    const warnings = problems.filter(
      (problem) => problem.severity === "warning",
    ).length;
    lines.push(
      `Diagnostics: ${errors} error(s), ${warnings} warning(s) on open files.`,
    );
    for (const problem of problems.slice(0, DIAGNOSTIC_CAP)) {
      const line = (problem.range?.start?.line ?? 0) + 1;
      const tag = problem.severity && problem.severity !== "error"
        ? `${problem.severity} `
        : "";
      lines.push(
        `- ${shortPath(problem.filepath)}:${line}: ${tag}${problem.message.split("\n")[0]}`,
      );
    }
    if (problems.length > DIAGNOSTIC_CAP) {
      lines.push(`… (${problems.length - DIAGNOSTIC_CAP} more)`);
    }
  }
  if (lines.length === 1) {
    return "";
  }
  return redactSecrets(lines.join("\n"));
}

export async function loadTurnContext(ide: IDE): Promise<string> {
  let activePath: string | undefined;
  let cursorLine: number | undefined;
  try {
    const current = await ide.getCurrentFile();
    if (current && !current.isUntitled) {
      activePath = current.path;
      cursorLine = current.cursorLine;
    }
  } catch {
    // no active editor
  }

  let openPaths: string[] = [];
  try {
    openPaths = (await ide.getOpenFiles()).filter(Boolean);
  } catch {
    openPaths = [];
  }

  let gitPorcelain = "";
  try {
    gitPorcelain = (await ide.getGitStatusPorcelain?.()) ?? "";
  } catch {
    gitPorcelain = "";
  }

  const problemUris = [
    ...new Set([activePath, ...openPaths.slice(0, OPEN_EDITOR_CAP)].filter(Boolean)),
  ] as string[];
  const problems: Problem[] = [];
  for (const uri of problemUris) {
    try {
      problems.push(...(await ide.getProblems(uri)));
    } catch {
      // diagnostics are optional
    }
  }

  return buildTurnContext({
    activePath,
    cursorLine,
    openPaths,
    gitPorcelain,
    problems,
  });
}
