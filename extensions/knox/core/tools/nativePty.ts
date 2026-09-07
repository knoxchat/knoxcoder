/**
 * Optional native PTY (node-pty). Falls back to piped stdin when the
 * native module is missing or fails to spawn (VS Code historically had
 * rebuild issues). Injectable for tests.
 *
 * Load order: injected spawner (VS Code host / tests) → product node-pty
 * from appRoot → `node-pty` on NODE_PATH. Extension-local copies are not
 * packaged; leftover VSIX paths are last-ditch only.
 */
import { createRequire } from "node:module";
import path from "node:path";

export interface NativePtyProcess {
  pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose?: () => void } | void;
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): { dispose?: () => void } | void;
}

export interface NativePtySpawnOpts {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export type NativePtySpawner = (
  opts: NativePtySpawnOpts,
) => NativePtyProcess | null;

export interface NodePtyModule {
  spawn: (
    file: string,
    args: string[] | string,
    options: Record<string, unknown>,
  ) => NativePtyProcess;
}

let injected: NativePtySpawner | null | undefined;
const extraModulePaths: string[] = [];
let cachedLoader: NativePtySpawner | null | undefined;

export function setNativePtySpawner(
  spawner: NativePtySpawner | null | undefined,
): void {
  injected = spawner;
}

/** Extra absolute module paths (tests). Extension-local VSIX copies are not packaged. */
export function addNativePtyModulePath(modulePath: string): void {
  extraModulePaths.push(modulePath);
  cachedLoader = undefined;
}

export function resetNativePtyLoader(): void {
  injected = undefined;
  extraModulePaths.length = 0;
  cachedLoader = undefined;
}

export function nativePtyModuleCandidates(opts: {
  appRoot?: string;
  extensionPath?: string;
}): string[] {
  const out: string[] = [];
  if (opts.appRoot) {
    out.push(path.join(opts.appRoot, "node_modules.asar.unpacked", "node-pty"));
    out.push(path.join(opts.appRoot, "node_modules.asar", "node-pty"));
    out.push(path.join(opts.appRoot, "node_modules", "node-pty"));
  }
  out.push(...extraModulePaths);
  out.push("node-pty");
  // Not packaged (T5.2). Last-ditch lookup for a leftover marketplace VSIX.
  if (opts.extensionPath) {
    out.push(path.join(opts.extensionPath, "out", "node_modules", "node-pty"));
    out.push(path.join(opts.extensionPath, "node_modules", "node-pty"));
  }
  return out;
}

function defaultShell(): { file: string; args: (command: string) => string[] } {
  if (process.platform === "win32") {
    const file = process.env.ComSpec || "cmd.exe";
    return { file, args: (command) => ["/d", "/s", "/c", command] };
  }
  const file = process.env.SHELL || "/bin/sh";
  return { file, args: (command) => ["-lc", command] };
}

export function createSpawnerFromPtyModule(
  pty: NodePtyModule,
): NativePtySpawner {
  return (opts) => {
    const shell = defaultShell();
    return pty.spawn(shell.file, shell.args(opts.command), {
      name: "xterm-256color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: {
        ...opts.env,
        TERM: opts.env.TERM || "xterm-256color",
      },
    });
  };
}

function tryRequireNodePty(id: string): NativePtySpawner | null {
  try {
    // CJS (VS Code tsc / extension bundle). Do not use import.meta — vscode
    // compiles core with module: commonjs, which rejects import.meta.
    let filename: string | undefined;
    try {
      if (typeof __filename === "string" && __filename.length > 0) {
        filename = __filename;
      }
    } catch {
      // ESM runtimes may not define __filename
    }
    const require = createRequire(
      filename ?? path.join(process.cwd(), "package.json"),
    );
    const pty = require(id) as NodePtyModule;
    if (typeof pty?.spawn !== "function") {
      return null;
    }
    return createSpawnerFromPtyModule(pty);
  } catch {
    return null;
  }
}

function loadNodePty(): NativePtySpawner | null {
  for (const id of nativePtyModuleCandidates({})) {
    const loaded = tryRequireNodePty(id);
    if (loaded) {
      return loaded;
    }
  }
  return null;
}

export function resolveNativePtySpawner(): NativePtySpawner | null {
  if (injected !== undefined) {
    return injected;
  }
  if (cachedLoader === undefined) {
    cachedLoader = loadNodePty();
  }
  return cachedLoader;
}

export function nativePtyAvailable(): boolean {
  return resolveNativePtySpawner() != null;
}

export function spawnNativePty(
  opts: NativePtySpawnOpts,
): NativePtyProcess | null {
  const spawner = resolveNativePtySpawner();
  if (!spawner) {
    return null;
  }
  try {
    return spawner(opts);
  } catch {
    return null;
  }
}

/** Test helper: echo PTY that treats isTTY probes as native. */
export function createEchoNativePtySpawner(): NativePtySpawner {
  return (opts) => {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(event: { exitCode: number }) => void> = [];
    let closed = false;
    const emit = (text: string) => {
      for (const listener of dataListeners) {
        listener(text);
      }
    };
    const exit = (code: number) => {
      if (closed) {
        return;
      }
      closed = true;
      for (const listener of exitListeners) {
        listener({ exitCode: code });
      }
    };
    queueMicrotask(() => {
      if (/isTTY|TTY/.test(opts.command) && !/echo /.test(opts.command)) {
        emit("TTY\n");
        exit(0);
      }
    });
    return {
      pid: process.pid || 4242,
      write(data: string) {
        if (closed) {
          return;
        }
        if (data.includes("\x03")) {
          exit(130);
          return;
        }
        if (data.includes("\x04")) {
          exit(0);
          return;
        }
        emit(data);
      },
      kill() {
        exit(1);
      },
      onData(listener) {
        dataListeners.push(listener);
      },
      onExit(listener) {
        exitListeners.push(listener);
      },
    };
  };
}
