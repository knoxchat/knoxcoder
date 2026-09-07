/**
 * Bind Core's optional native PTY to a real node-pty module.
 *
 * Prefer the editor's ABI-matched binary from `vscode.env.appRoot`
 * (`node_modules` / `node_modules.asar.unpacked`). Do not copy node-pty into
 * the extension `out/node_modules` (T5.2). Piped stdin remains the fallback.
 */
import {
  createSpawnerFromPtyModule,
  nativePtyModuleCandidates,
  setNativePtySpawner,
  type NodePtyModule,
} from "core/tools/nativePty";
import * as vscode from "vscode";

function tryLoad(id: string): NodePtyModule | null {
  try {
    // Dynamic require so esbuild does not bundle the native addon.
    const pty = require(id) as NodePtyModule;
    return typeof pty?.spawn === "function" ? pty : null;
  } catch {
    return null;
  }
}

export function installHostNativePty(
  context: vscode.ExtensionContext,
): boolean {
  for (const id of nativePtyModuleCandidates({
    appRoot: vscode.env.appRoot,
    extensionPath: context.extensionPath,
  })) {
    const pty = tryLoad(id);
    if (!pty) {
      continue;
    }
    setNativePtySpawner(createSpawnerFromPtyModule(pty));
    console.log(`[info] Native PTY loaded from ${id}`);
    return true;
  }
  console.log(
    "[info] Native PTY unavailable; builtin_pty_* will use piped stdin",
  );
  return false;
}
