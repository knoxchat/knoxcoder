/**
 * Optional OS-level sandbox for Auto-mode shell (P1-2).
 *
 * Modes:
 *   off             — no wrapper (default)
 *   workspace-write — writes limited to the workspace and temp dirs
 *   read-only       — workspace is read-only; temp dirs still writable
 *
 * Backends: macOS `sandbox-exec`, Linux `bwrap`. Windows has no wrapper;
 * the limitation is reported so the composer can show it. Missing binaries
 * fall back to unsandboxed unless `KNOX_SANDBOX_REQUIRED=1`.
 *
 * Env `KNOX_SANDBOX` overrides the VS Code / YAML setting.
 */

export const SANDBOX_MODES = ["off", "workspace-write", "read-only"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];
export type SandboxBackend = "none" | "sandbox-exec" | "bwrap" | "unsupported" | "missing";

export interface SandboxWrapResult {
  command: string;
  mode: SandboxMode;
  backend: SandboxBackend;
  sandboxed: boolean;
  warning?: string;
}

export interface SandboxWrapOptions {
  mode: SandboxMode;
  workspaceRoot: string;
  /** Deny network inside the sandbox (shared with fetch_url offline policy). */
  denyNetwork?: boolean;
  platform?: NodeJS.Platform;
  hasBinary?: (name: string) => boolean;
  tmpDirs?: string[];
  required?: boolean;
}

let settingOverlay: SandboxMode | undefined;

export function isSandboxMode(value: unknown): value is SandboxMode {
  return value === "off" || value === "workspace-write" || value === "read-only";
}

export function applySandboxSetting(raw: unknown): void {
  if (isSandboxMode(raw)) {
    settingOverlay = raw;
  }
}

export function resolveSandboxMode(raw?: unknown): SandboxMode {
  const env = process.env.KNOX_SANDBOX?.trim();
  if (isSandboxMode(env)) {
    return env;
  }
  if (isSandboxMode(raw)) {
    return raw;
  }
  if (settingOverlay) {
    return settingOverlay;
  }
  return "off";
}

export function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function defaultTmpDirs(platform: NodeJS.Platform): string[] {
  const dirs = [process.env.TMPDIR, process.env.TMP, process.env.TEMP, "/tmp"].filter(
    (d): d is string => Boolean(d),
  );
  if (platform === "darwin") {
    dirs.push("/private/tmp", "/var/folders");
  }
  return [...new Set(dirs)];
}

function binaryExists(
  name: string,
  hasBinary?: (name: string) => boolean,
): boolean {
  if (hasBinary) {
    return hasBinary(name);
  }
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function detectSandboxBackend(
  platform: NodeJS.Platform = process.platform,
  hasBinary?: (name: string) => boolean,
): SandboxBackend {
  if (platform === "darwin") {
    return binaryExists("sandbox-exec", hasBinary) ? "sandbox-exec" : "missing";
  }
  if (platform === "linux") {
    return binaryExists("bwrap", hasBinary) ? "bwrap" : "missing";
  }
  return "unsupported";
}

/** Seatbelt profile: allow default, then deny writes except workspace + temp. */
export function macosSeatbeltProfile(opts: {
  mode: Exclude<SandboxMode, "off">;
  workspaceRoot: string;
  tmpDirs: string[];
  denyNetwork: boolean;
}): string {
  const subpaths = [
    ...(opts.mode === "workspace-write" ? [opts.workspaceRoot] : []),
    ...opts.tmpDirs,
    "/dev",
  ];
  const allowWrites = subpaths
    .filter(Boolean)
    .map((p) => `(subpath ${JSON.stringify(p)})`)
    .join(" ");
  const network = opts.denyNetwork ? "(deny network*)" : "";
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write-data (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/tty"))
(allow file-write* ${allowWrites})
${network}`.trim();
}

export function bwrapArgv(opts: {
  mode: Exclude<SandboxMode, "off">;
  workspaceRoot: string;
  tmpDirs: string[];
  denyNetwork: boolean;
}): string[] {
  const args = [
    "bwrap",
    "--die-with-parent",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--ro-bind",
    "/",
    "/",
  ];
  if (opts.mode === "workspace-write") {
    args.push("--bind", opts.workspaceRoot, opts.workspaceRoot);
  }
  for (const dir of opts.tmpDirs) {
    if (dir.startsWith("/") && dir !== "/") {
      args.push("--bind", dir, dir);
    }
  }
  if (opts.denyNetwork) {
    args.push("--unshare-net");
  }
  return args;
}

export function wrapSandboxCommand(
  command: string,
  opts: SandboxWrapOptions,
): SandboxWrapResult {
  const mode = opts.mode;
  if (mode === "off") {
    return { command, mode, backend: "none", sandboxed: false };
  }
  const platform = opts.platform ?? process.platform;
  const backend = detectSandboxBackend(platform, opts.hasBinary);
  const required =
    opts.required ??
    (process.env.KNOX_SANDBOX_REQUIRED === "1" ||
      process.env.KNOX_SANDBOX_REQUIRED === "true");
  const missing = (warning: string): SandboxWrapResult => {
    if (required) {
      throw new Error(warning);
    }
    return { command, mode, backend, sandboxed: false, warning };
  };
  if (backend === "unsupported") {
    return missing(
      "knoxchat.sandbox is set but Windows has no OS sandbox; shell runs unsandboxed. See docs/security/sandbox.md.",
    );
  }
  if (backend === "missing") {
    const bin = platform === "darwin" ? "sandbox-exec" : "bwrap";
    return missing(
      `knoxchat.sandbox=${mode} but ${bin} is not installed; shell runs unsandboxed.`,
    );
  }
  const tmpDirs = opts.tmpDirs ?? defaultTmpDirs(platform);
  const denyNetwork = opts.denyNetwork === true;
  if (backend === "sandbox-exec") {
    const profile = macosSeatbeltProfile({
      mode,
      workspaceRoot: opts.workspaceRoot,
      tmpDirs,
      denyNetwork,
    });
    return {
      command: `sandbox-exec -p ${shSingleQuote(profile)} /bin/sh -c ${shSingleQuote(command)}`,
      mode,
      backend,
      sandboxed: true,
    };
  }
  const argv = bwrapArgv({
    mode,
    workspaceRoot: opts.workspaceRoot,
    tmpDirs,
    denyNetwork,
  });
  argv.push("/bin/sh", "-c", command);
  const wrapped = argv.map((a, i) => (i === 0 ? a : shSingleQuote(a))).join(" ");
  return { command: wrapped, mode, backend, sandboxed: true };
}

export function sandboxStatusLabel(mode: SandboxMode, backend: SandboxBackend): string {
  if (mode === "off") {
    return "Sandbox off";
  }
  if (backend === "unsupported" || backend === "missing") {
    return `Sandbox ${mode} (unavailable)`;
  }
  return mode === "read-only" ? "Sandbox read-only" : "Sandbox workspace";
}
