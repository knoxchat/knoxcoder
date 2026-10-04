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

/** `hooks:` block of the workspace `.knox/config.yaml`. */
async function loadWorkspaceYamlHooks(ide: IDE, dir: string): Promise<HooksConfig> {
  try {
    const base = dir.replace(/\/+$/, "");
    return parseHooksFromYaml(await ide.readFile(`${base}/.knox/config.yaml`));
  } catch {
    return {};
  }
}

/**
 * Runner combining, in this order: global config.yaml `hooks:`, workspace
 * `.knox/config.yaml` `hooks:`, workspace `.knox/hooks.json`. Null when no
 * hooks are configured. Re-read on every call (tiny files) so edits apply at
 * once. Every hook run is appended to the audit log (`hooks/auditLog`) and
 * echoed to `log`.
 */
export async function getWorkspaceHookRunner(
  ide: IDE,
  log: (line: string) => void = (line) => console.log(line),
  opts: { trustWorkspace?: boolean } = {},
): Promise<HookRunner | null> {
  const dirs = await ide.getWorkspaceDirs().catch(() => [] as string[]);
  const dir = dirs[0];
  // Repo-local hooks are arbitrary shell commands from the repository. VS Code
  // Workspace Trust gates the whole extension (`untrustedWorkspaces.supported:
  // false`), so they never run in an untrusted folder.
  const trusted = opts.trustWorkspace !== false;
  const localYaml = dir ? await loadWorkspaceYamlHooks(ide, dir) : {};
  const localJson = dir ? await loadHooksConfig((u) => ide.readFile(u), dir) : {};
  if (!trusted && (Object.keys(localYaml).length || Object.keys(localJson).length)) {
    log(
      "[knox hooks] ignoring repo-local hooks (.knox/config.yaml, .knox/hooks.json): workspace is not trusted.",
    );
  }
  const config = mergeHooksConfigs(
    await loadGlobalYamlHooks(),
    trusted ? localYaml : {},
    trusted ? localJson : {},
  );
  if (Object.keys(config).length === 0) {
    return null;
  }
  const cwd = !dir
    ? undefined
    : dir.startsWith("file://")
      ? fileURLToPath(dir) // not URL.pathname: that yields "/D:/..." on Windows
      : dir;
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
