import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { IDE } from "..";
import { getKnoxGlobalPath } from "../util/paths";

import { recordHookAudit } from "./auditLog";
import {
  HookRunner,
  loadHooksConfig,
  mergeHooksConfigs,
  parseHooksFromYaml,
  stampHookCwd,
  type HooksConfig,
} from "./hooks";

/** `hooks:` block of the global config.yaml (`~/.knoxcoder/config.yaml`). Missing file gives {}. */
async function loadGlobalYamlHooks(): Promise<HooksConfig> {
  try {
    const file = path.join(getKnoxGlobalPath(), "config.yaml");
    return parseHooksFromYaml(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

/** `hooks:` block of the workspace `.knoxcoder/config.yaml`. */
async function loadWorkspaceYamlHooks(ide: IDE, dir: string): Promise<HooksConfig> {
  try {
    const base = dir.replace(/\/+$/, "");
    const uri = `${base}/.knoxcoder/config.yaml`;
    if (!(await ide.fileExists(uri))) {
      return {};
    }
    return parseHooksFromYaml(await ide.readFile(uri));
  } catch {
    return {};
  }
}

/**
 * Runner combining, in this order: global config.yaml `hooks:`, then each
 * workspace root's `.knoxcoder/config.yaml` `hooks:` and `.knoxcoder/hooks.json`
 * (primary root first). Per-hook `cwd` is the root the file was loaded from.
 * Null when no hooks are configured. Re-read on every call (tiny files) so
 * edits apply at once. Every hook run is appended to the audit log
 * (`hooks/auditLog`) and echoed to `log`.
 */
function dirToCwd(dir: string): string {
  return dir.startsWith("file://")
    ? fileURLToPath(dir) // not URL.pathname: that yields "/D:/..." on Windows
    : dir;
}

export async function getWorkspaceHookRunner(
  ide: IDE,
  log: (line: string) => void = (line) => console.log(line),
  opts: { trustWorkspace?: boolean } = {},
): Promise<HookRunner | null> {
  const dirs = await ide.getWorkspaceDirs().catch(() => [] as string[]);
  // Repo-local hooks are arbitrary shell commands from the repository. VS Code
  // Workspace Trust gates the whole extension (`untrustedWorkspaces.supported:
  // false`), so they never run in an untrusted folder.
  const trusted = opts.trustWorkspace !== false;
  const parts: HooksConfig[] = [await loadGlobalYamlHooks()];
  let sawLocal = false;
  for (const dir of dirs) {
    const localYaml = await loadWorkspaceYamlHooks(ide, dir);
    const localJson = await loadHooksConfig(async (u) => {
      if (!(await ide.fileExists(u))) {
        throw new Error("ENOENT");
      }
      return ide.readFile(u);
    }, dir);
    if (Object.keys(localYaml).length || Object.keys(localJson).length) {
      sawLocal = true;
    }
    if (trusted) {
      const cwd = dirToCwd(dir);
      parts.push(stampHookCwd(localYaml, cwd), stampHookCwd(localJson, cwd));
    }
  }
  if (!trusted && sawLocal) {
    log(
      "[knox hooks] ignoring repo-local hooks (.knoxcoder/config.yaml, .knoxcoder/hooks.json): workspace is not trusted.",
    );
  }
  const config = mergeHooksConfigs(...parts);
  if (Object.keys(config).length === 0) {
    return null;
  }
  const cwd = dirs[0] ? dirToCwd(dirs[0]) : undefined;
  return new HookRunner(config, {
    cwd,
    onAudit: (e) => {
      recordHookAudit(e);
      log(
        `[knox hooks] ${e.event} ${e.toolName ?? ""} ${e.command} -> ${e.outcome} (${e.durationMs}ms)${e.detail ? `: ${e.detail}` : ""}`,
      );
    },
  });
}
