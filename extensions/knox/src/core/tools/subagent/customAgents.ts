/**
 * User-defined subagent types (K-025).
 *
 * Workspace: `.knoxcoder/agents/*.md`
 * Global: `~/.knoxcoder/agents/*.md` (`KNOX_GLOBAL_DIR` overrides the root).
 * First definition of a name wins (workspace, then global).
 *
 * Do not read `.knox/agents` or `~/.knox` — those belong to the marketplace
 * Knox extension (`knoxchat.knoxchat`), not KnoxCoder.
 *
 * ---
 * name: reviewer
 * description: Reviews diffs for risk
 * tools: [builtin_read_file, builtin_grep_search]   # optional allowlist
 * readonly: true                                    # optional; default false
 * model: my-fast-model                              # optional model title hint
 * ---
 * System prompt body...
 */

import os from "os";
import path from "path";

import * as YAML from "yaml";

import type { IDE } from "../..";
import { KNOX_GLOBAL_DIR_NAME } from "../../util/globalDirName";
import { localPathOrUriToPath, localPathToUri } from "../../util/pathToUri";

export interface CustomAgentDef {
  name: string;
  description: string;
  prompt: string;
  /** Tool-name allowlist. Undefined = everything the base profile allows. */
  tools?: string[];
  readonly: boolean;
  /** Preferred model title (hint; callers may ignore if unresolved). */
  model?: string;
  source: string;
}

export const WORKSPACE_CUSTOM_AGENTS_DIR = ".knoxcoder/agents";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;

export function globalCustomAgentsDir(): string {
  const root = (
    process.env.KNOX_GLOBAL_DIR ?? path.join(os.homedir(), KNOX_GLOBAL_DIR_NAME)
  ).replace(/[\\/]+$/, "");
  return path.join(root, "agents");
}

export function parseCustomAgent(
  text: string,
  source: string,
): CustomAgentDef | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let meta: Record<string, unknown> = {};
  let body = text;
  if (match) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === "object") {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    body = match[2];
  }
  const fallbackName = source
    .replace(/^.*[\\/]/, "")
    .replace(/\.md$/i, "");
  const name = typeof meta.name === "string" ? meta.name.trim() : fallbackName;
  if (!NAME_RE.test(name)) {
    return null;
  }
  const prompt = body.trim();
  if (!prompt) {
    return null;
  }
  let tools: string[] | undefined;
  if (Array.isArray(meta.tools)) {
    tools = meta.tools.filter((t): t is string => typeof t === "string");
  } else if (typeof meta.tools === "string") {
    tools = meta.tools
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return {
    name,
    description:
      typeof meta.description === "string" ? meta.description.trim() : "",
    prompt,
    tools: tools && tools.length ? tools : undefined,
    readonly: meta.readonly === true,
    model: typeof meta.model === "string" ? meta.model.trim() : undefined,
    source,
  };
}

async function loadFromAgentsDir(
  ide: IDE,
  dirPath: string,
  out: CustomAgentDef[],
  seen: Set<string>,
): Promise<void> {
  const agentsDir = localPathToUri(dirPath);
  let entries: [string, number][];
  try {
    entries = await ide.listDir(agentsDir);
  } catch {
    return;
  }
  for (const [file] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!file.toLowerCase().endsWith(".md")) {
      continue;
    }
    const source = `${agentsDir}/${file}`;
    try {
      const text = await ide.readFile(source);
      const def = parseCustomAgent(text, source);
      if (def && !seen.has(def.name)) {
        seen.add(def.name);
        out.push(def);
      }
    } catch {
      // unreadable file: skip
    }
  }
}

export async function loadCustomAgents(ide: IDE): Promise<CustomAgentDef[]> {
  const out: CustomAgentDef[] = [];
  const seen = new Set<string>();
  try {
    const dirs = await ide.getWorkspaceDirs();
    for (const dir of dirs) {
      const root = localPathOrUriToPath(dir).replace(/[\\/]+$/, "");
      await loadFromAgentsDir(
        ide,
        path.join(root, WORKSPACE_CUSTOM_AGENTS_DIR),
        out,
        seen,
      );
    }
  } catch {
    // unreadable workspace: still try global
  }
  await loadFromAgentsDir(ide, globalCustomAgentsDir(), out, seen);
  return out;
}

export async function findCustomAgent(
  ide: IDE,
  name: string,
): Promise<CustomAgentDef | undefined> {
  return (await loadCustomAgents(ide)).find((a) => a.name === name);
}
