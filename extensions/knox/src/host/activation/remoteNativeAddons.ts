/**
 * KN-365: Remote-SSH + desktop-only contract.
 *
 * Knox is a Node engine (sqlite3, ripgrep, optional node-pty). It must run as
 * a workspace extension on the remote so those addons exist next to Core, and
 * it must never ship a `browser` entry (`gulp vscode-web` skips it).
 */

export const KNOX_EXTENSION_KIND = ["ui", "workspace"] as const;

/** vscode.UIKind.Desktop — kept numeric so mocha can run without `vscode`. */
export const KNOX_UI_KIND_DESKTOP = 1;
/** vscode.UIKind.Web */
export const KNOX_UI_KIND_WEB = 2;

export const KNOX_REQUIRED_NATIVE_ADDONS = ["sqlite3", "ripgrep"] as const;
export const KNOX_OPTIONAL_NATIVE_ADDONS = ["node-pty"] as const;

export type KnoxNativeAddonName =
  | (typeof KNOX_REQUIRED_NATIVE_ADDONS)[number]
  | (typeof KNOX_OPTIONAL_NATIVE_ADDONS)[number];

export type KnoxNativeAddonProbe = {
  name: KnoxNativeAddonName;
  required: boolean;
  found: boolean;
  path?: string;
};

export type KnoxRemoteActivationDecision =
  | { kind: "ok"; remote: boolean }
  | { kind: "abort-web" }
  | {
      kind: "missing-required";
      remote: boolean;
      missing: KnoxNativeAddonName[];
    };

export function isKnoxRemoteHost(remoteName: string | undefined | null): boolean {
  return Boolean(remoteName && remoteName !== "local");
}

export function isKnoxWebHost(uiKind: number, webUiKind = KNOX_UI_KIND_WEB): boolean {
  return uiKind === webUiKind;
}

export function knoxManifestAllowsRemoteSsh(manifest: {
  main?: unknown;
  browser?: unknown;
  extensionKind?: unknown;
}): { ok: true } | { ok: false; reason: string } {
  if (manifest.browser !== undefined) {
    return { ok: false, reason: "browser field must be absent (desktop-only)" };
  }
  if (typeof manifest.main !== "string" || !manifest.main.includes("extension")) {
    return { ok: false, reason: "main must be the Node extension entry" };
  }
  const kinds = Array.isArray(manifest.extensionKind)
    ? manifest.extensionKind.filter((kind): kind is string => typeof kind === "string")
    : [];
  if (
    !KNOX_EXTENSION_KIND.every((kind) => kinds.includes(kind)) ||
    kinds.includes("web")
  ) {
    return {
      ok: false,
      reason: "extensionKind must be ui + workspace (no web)",
    };
  }
  return { ok: true };
}

export function sqlite3BindingRelPaths(): string[] {
  return [
    "dist/node_modules/sqlite3/build/Release/node_sqlite3.node",
    "out/node_modules/sqlite3/build/Release/node_sqlite3.node",
    "node_modules/sqlite3/build/Release/node_sqlite3.node",
  ];
}

export function ripgrepBinaryRelPaths(platform: NodeJS.Platform): string[] {
  const exe = platform === "win32" ? "rg.exe" : "rg";
  return [
    `dist/node_modules/@vscode/ripgrep/bin/${exe}`,
    `out/node_modules/@vscode/ripgrep/bin/${exe}`,
    `node_modules/@vscode/ripgrep/bin/${exe}`,
  ];
}

export function nodePtyModuleRelPaths(): string[] {
  return [
    "dist/node_modules/node-pty",
    "out/node_modules/node-pty",
    "node_modules/node-pty",
  ];
}

function firstExisting(
  extensionPath: string,
  relPaths: string[],
  exists: (path: string) => boolean,
  join: (left: string, right: string) => string,
): string | undefined {
  for (const rel of relPaths) {
    const full = join(extensionPath, rel);
    if (exists(full)) {
      return full;
    }
  }
  return undefined;
}

export function probeKnoxNativeAddons(opts: {
  extensionPath: string;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  join?: (left: string, right: string) => string;
}): KnoxNativeAddonProbe[] {
  const join = opts.join ?? ((left, right) => `${left.replace(/[/\\]+$/, "")}/${right}`);
  const sqlite = firstExisting(
    opts.extensionPath,
    sqlite3BindingRelPaths(),
    opts.exists,
    join,
  );
  const ripgrep = firstExisting(
    opts.extensionPath,
    ripgrepBinaryRelPaths(opts.platform),
    opts.exists,
    join,
  );
  const pty = firstExisting(
    opts.extensionPath,
    nodePtyModuleRelPaths(),
    opts.exists,
    join,
  );
  return [
    { name: "sqlite3", required: true, found: Boolean(sqlite), path: sqlite },
    { name: "ripgrep", required: true, found: Boolean(ripgrep), path: ripgrep },
    { name: "node-pty", required: false, found: Boolean(pty), path: pty },
  ];
}

export function decideKnoxRemoteActivation(opts: {
  uiKind: number;
  webUiKind?: number;
  remoteName?: string | null;
  addons: KnoxNativeAddonProbe[];
}): KnoxRemoteActivationDecision {
  if (isKnoxWebHost(opts.uiKind, opts.webUiKind)) {
    return { kind: "abort-web" };
  }
  const remote = isKnoxRemoteHost(opts.remoteName);
  const missing = opts.addons
    .filter((addon) => addon.required && !addon.found)
    .map((addon) => addon.name);
  if (missing.length > 0) {
    return { kind: "missing-required", remote, missing };
  }
  return { kind: "ok", remote };
}
