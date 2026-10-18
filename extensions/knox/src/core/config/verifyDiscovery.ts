/**
 * Default-profile verifyCommand discovery (P1.2).
 *
 * Resolution order (first hit wins):
 * 1. Caller already has knoxchat.verifyCommand / YAML agentVerifyCommand
 * 2. AGENTS.md / .knoxcoder/AGENTS.md fenced command under a Test/Verify heading
 * 3. Kind-specific default (npm test, cargo test, go test, …)
 * 4. Empty → LSP diagnostics only
 */

import type { IDE } from "..";
import { extractAgentsMdVerifyCommand } from "./agentsMd";
import {
  detectWorkspaceKind,
  RUST_VERIFY_COMMAND,
  SYSTEMS_VERIFY_COMMAND,
  type WorkspaceKind,
} from "./agentProfile";
import { joinPathsToUri } from "../util/uri";
import { detectOracleCommand } from "../tools/build/oracleDetect";

export type NodePackageManager = "pnpm" | "yarn" | "bun" | "npm";

export function nodePackageManager(entries: Iterable<string>): NodePackageManager {
  const names = new Set([...entries].map((name) => name.replace(/\/+$/, "")));
  if (names.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (names.has("yarn.lock")) {
    return "yarn";
  }
  if (names.has("bun.lock") || names.has("bun.lockb")) {
    return "bun";
  }
  return "npm";
}

export function nodeRunCommand(
  manager: NodePackageManager,
  script: string,
  silent = true,
): string {
  const quiet = silent && script === "test";
  if (manager === "yarn") {
    return quiet ? `yarn ${script} --silent` : `yarn ${script}`;
  }
  if (manager === "pnpm") {
    return quiet ? `pnpm ${script} --silent` : `pnpm ${script}`;
  }
  if (manager === "bun") {
    return quiet ? `bun run ${script} --silent` : `bun run ${script}`;
  }
  const npmBare = script === "test" || script === "start";
  const cmd = npmBare ? `npm ${script}` : `npm run ${script}`;
  return quiet ? `${cmd} --silent` : cmd;
}

function parseScripts(packageJson?: string): Record<string, string> {
  try {
    const scripts = JSON.parse(packageJson ?? "{}").scripts as
      | Record<string, string>
      | undefined;
    return scripts && typeof scripts === "object" ? scripts : {};
  } catch {
    return {};
  }
}

export function kindDefaultVerifyCommand(input: {
  kind: WorkspaceKind;
  entries: string[];
  packageJson?: string;
  pyproject?: string;
}): string {
  const { kind, entries } = input;
  if (!kind) {
    return detectOracleCommand({
      entries,
      packageJson: input.packageJson,
      pyproject: input.pyproject,
    })?.command ?? "";
  }
  if (kind === "kernel" || kind === "qemu") {
    return kind === "qemu" ? "ninja -C build" : SYSTEMS_VERIFY_COMMAND;
  }
  if (kind === "cargo") {
    return RUST_VERIFY_COMMAND;
  }
  if (kind === "go") {
    return "go test ./...";
  }
  if (kind === "cmake") {
    return "cmake --build build";
  }
  if (kind === "python") {
    const py = input.pyproject ?? "";
    if (
      entries.includes("pytest.ini") ||
      /\[tool\.pytest\b/.test(py) ||
      entries.includes("tests") ||
      entries.includes("test")
    ) {
      return "python -m pytest -q";
    }
    if (/\[tool\.ruff\b/.test(py) || entries.includes("ruff.toml")) {
      return "ruff check .";
    }
    return "python -m compileall -q .";
  }
  if (kind === "node" || kind === "editor") {
    if (kind === "editor") {
      // gulp compile-extension:knox is too heavy as a post-edit oracle.
      return "";
    }
    const scripts = parseScripts(input.packageJson);
    const manager = nodePackageManager(entries);
    if (typeof scripts.test === "string") {
      return nodeRunCommand(manager, "test");
    }
    return (
      detectOracleCommand({
        entries,
        packageJson: input.packageJson,
        pyproject: input.pyproject,
      })?.command ?? ""
    );
  }
  return "";
}

export function discoverVerifyCommandFromProbe(input: {
  kind?: WorkspaceKind;
  entries: string[];
  packageJson?: string;
  pyproject?: string;
  agentsMd?: string;
}): string {
  const fromAgents = extractAgentsMdVerifyCommand(input.agentsMd ?? "");
  if (fromAgents) {
    return fromAgents;
  }
  const kind = input.kind ?? detectWorkspaceKind(input.entries);
  return kindDefaultVerifyCommand({
    kind,
    entries: input.entries,
    packageJson: input.packageJson,
    pyproject: input.pyproject,
  });
}

async function readIfExists(ide: IDE, root: string, name: string): Promise<string> {
  try {
    const uri = joinPathsToUri(root, name);
    if (await ide.fileExists(uri)) {
      return await ide.readFile(uri);
    }
  } catch {
    // missing is fine
  }
  return "";
}

/** Discover a verify command from the workspace (AGENTS.md, then kind default). */
export async function discoverVerifyCommand(ide: IDE): Promise<string> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root || typeof ide.listDir !== "function") {
    return "";
  }
  let entries: string[] = [];
  try {
    entries = (await ide.listDir(root)).map(([name]) => name);
  } catch {
    return "";
  }
  const kind = detectWorkspaceKind(entries);
  const [packageJson, pyproject, agentsRoot, agentsDot] = await Promise.all([
    readIfExists(ide, root, "package.json"),
    readIfExists(ide, root, "pyproject.toml"),
    readIfExists(ide, root, "AGENTS.md"),
    readIfExists(ide, root, ".knoxcoder/AGENTS.md"),
  ]);
  return discoverVerifyCommandFromProbe({
    kind,
    entries,
    packageJson,
    pyproject,
    agentsMd: agentsDot || agentsRoot,
  });
}
