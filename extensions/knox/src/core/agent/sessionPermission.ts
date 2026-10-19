/**
 * K-090: new-session permission default.
 *
 * Auto (YOLO) stays the product default for known projects and allowlisted
 * remotes. A folder with no Knox sessions and a git remote that is not on
 * the user allowlist starts in Ask. Saved modes and
 * `knoxchat.permissionDefault` still win.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { KNOX_GLOBAL_DIR_NAME } from "../util/globalDirName";

import type { IDE, IdeSettings } from "../index.js";

type PermissionMode = "default" | "acceptEdits" | "fullAuto";

export type PermissionDefaultSetting = "auto" | "ask" | "edits";
export type PermissionDefaultReason =
  | "saved"
  | "setting"
  | "known_project"
  | "trusted_remote"
  | "fresh_clone"
  | "default";

export interface SessionPermissionResolution {
  mode: PermissionMode;
  reason: PermissionDefaultReason;
}

function knoxGlobalRoot(): string {
  return (
    process.env.KNOX_GLOBAL_DIR ??
    path.join(os.homedir(), KNOX_GLOBAL_DIR_NAME)
  );
}

function stripFileUri(raw: string): string {
  if (raw.startsWith("file://")) {
    try {
      return decodeURIComponent(
        raw.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1"),
      );
    } catch {
      return raw.replace(/^file:\/\//, "");
    }
  }
  return raw;
}

function normalizeWorkspace(p: string): string {
  return stripFileUri(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function permissionModeFromSetting(
  setting: PermissionDefaultSetting,
): PermissionMode {
  if (setting === "ask") {
    return "default";
  }
  if (setting === "edits") {
    return "acceptEdits";
  }
  return "fullAuto";
}

export function resolveDefaultPermissionMode(opts: {
  savedMode?: PermissionMode | null;
  setting?: PermissionDefaultSetting | null;
  hasKnoxProjectState: boolean;
  gitRemoteAllowlisted: boolean;
}): SessionPermissionResolution {
  if (opts.savedMode) {
    return { mode: opts.savedMode, reason: "saved" };
  }
  if (opts.setting === "auto" || opts.setting === "ask" || opts.setting === "edits") {
    return {
      mode: permissionModeFromSetting(opts.setting),
      reason: "setting",
    };
  }
  if (opts.hasKnoxProjectState) {
    return { mode: "fullAuto", reason: "known_project" };
  }
  if (opts.gitRemoteAllowlisted) {
    return { mode: "fullAuto", reason: "trusted_remote" };
  }
  return { mode: "default", reason: "fresh_clone" };
}

/** Read-only: do not create ~/.knoxcoder. */
export function workspaceHasKnoxSessions(workspaceDir: string): boolean {
  const wanted = normalizeWorkspace(workspaceDir);
  if (!wanted) {
    return false;
  }
  const listPath = path.join(knoxGlobalRoot(), "sessions", "sessions.json");
  if (!fs.existsSync(listPath)) {
    return false;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(listPath, "utf8"));
    if (!Array.isArray(raw)) {
      return false;
    }
    return raw.some((row) => {
      if (!row || typeof row !== "object") {
        return false;
      }
      const dir =
        (row as { workspaceDirectory?: unknown }).workspaceDirectory ??
        (row as { workspace_directory?: unknown }).workspace_directory;
      return typeof dir === "string" && normalizeWorkspace(dir) === wanted;
    });
  } catch {
    return false;
  }
}

function gitConfigPath(workspaceDir: string): string | undefined {
  let dir = path.resolve(stripFileUri(workspaceDir));
  for (let i = 0; i < 8; i++) {
    const gitPath = path.join(dir, ".git");
    try {
      const st = fs.lstatSync(gitPath);
      if (st.isDirectory()) {
        const cfg = path.join(gitPath, "config");
        return fs.existsSync(cfg) ? cfg : undefined;
      }
      if (st.isFile()) {
        const text = fs.readFileSync(gitPath, "utf8");
        const match = text.match(/gitdir:\s*(.+)/i);
        if (match) {
          let gitdir = match[1].trim();
          if (!path.isAbsolute(gitdir)) {
            gitdir = path.resolve(dir, gitdir);
          }
          const cfg = path.join(gitdir, "config");
          if (fs.existsSync(cfg)) {
            return cfg;
          }
          const commondir = path.join(gitdir, "commondir");
          if (fs.existsSync(commondir)) {
            const common = fs.readFileSync(commondir, "utf8").trim();
            const commonRoot = path.isAbsolute(common)
              ? common
              : path.resolve(gitdir, common);
            const commonCfg = path.join(commonRoot, "config");
            if (fs.existsSync(commonCfg)) {
              return commonCfg;
            }
          }
        }
      }
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

export function readGitRemoteUrls(workspaceDir: string): string[] {
  const cfg = gitConfigPath(workspaceDir);
  if (!cfg) {
    return [];
  }
  try {
    const text = fs.readFileSync(cfg, "utf8");
    const urls: string[] = [];
    for (const match of text.matchAll(/^\s*url\s*=\s*(.+)$/gim)) {
      const url = match[1].trim();
      if (url) {
        urls.push(url);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export function gitRemoteIsTrusted(
  remotes: string[],
  allowlist: string[] | undefined,
): boolean {
  if (!remotes.length || !allowlist?.length) {
    return false;
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/\.git$/, "")
      .replace(/:/g, "/");
  return remotes.some((remote) => {
    const r = norm(remote);
    return allowlist.some((entry) => {
      const al = norm(entry).trim();
      return al.length > 0 && r.includes(al);
    });
  });
}

export function resolveWorkspacePermissionMode(
  workspaceDir: string | undefined,
  opts?: {
    savedMode?: PermissionMode | null;
    setting?: PermissionDefaultSetting | null;
    trustedGitRemotes?: string[];
    hasKnoxProjectState?: boolean;
  },
): SessionPermissionResolution {
  if (!workspaceDir?.trim()) {
    if (opts?.savedMode) {
      return { mode: opts.savedMode, reason: "saved" };
    }
    if (opts?.setting) {
      return {
        mode: permissionModeFromSetting(opts.setting),
        reason: "setting",
      };
    }
    return { mode: "fullAuto", reason: "default" };
  }
  const hasKnoxProjectState =
    opts?.hasKnoxProjectState ?? workspaceHasKnoxSessions(workspaceDir);
  const remotes = readGitRemoteUrls(workspaceDir);
  return resolveDefaultPermissionMode({
    savedMode: opts?.savedMode,
    setting: opts?.setting,
    hasKnoxProjectState,
    gitRemoteAllowlisted: gitRemoteIsTrusted(remotes, opts?.trustedGitRemotes),
  });
}

export async function attachSessionPermission(
  serialized: {
    config?: {
      experimental?: {
        sessionPermission?: SessionPermissionResolution;
        permissionDefault?: PermissionDefaultSetting;
        trustedGitRemotes?: string[];
      };
    };
  },
  ide: Pick<IDE, "getWorkspaceDirs" | "getIdeSettings">,
): Promise<void> {
  if (!serialized.config) {
    return;
  }
  const dirs = await ide.getWorkspaceDirs().catch(() => []);
  const settings: IdeSettings = await ide.getIdeSettings().catch(() => ({}));
  const dir = dirs[0] ? stripFileUri(dirs[0]) : undefined;
  const sessionPermission = resolveWorkspacePermissionMode(dir, {
    setting: settings.permissionDefault,
    trustedGitRemotes: settings.trustedGitRemotes,
  });
  serialized.config.experimental = {
    ...serialized.config.experimental,
    sessionPermission,
    permissionDefault: settings.permissionDefault,
    trustedGitRemotes: settings.trustedGitRemotes,
  };
}
