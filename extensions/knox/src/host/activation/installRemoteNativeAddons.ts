/**
 * KN-365: refuse vscode-web; warn when sqlite3 / ripgrep are missing on this
 * host (the remote copy when connected over SSH).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { t } from "../i18n";

import {
  decideKnoxRemoteActivation,
  isKnoxWebHost,
  probeKnoxNativeAddons,
} from "./remoteNativeAddons";

export function installRemoteNativeAddons(
  context: vscode.ExtensionContext,
): boolean {
  if (isKnoxWebHost(vscode.env.uiKind, vscode.UIKind.Web)) {
    void vscode.window.showErrorMessage(t("ext.desktopOnly"));
    return false;
  }

  const addons = probeKnoxNativeAddons({
    extensionPath: context.extensionPath,
    platform: process.platform,
    exists: fs.existsSync,
    join: path.join,
  });
  const decision = decideKnoxRemoteActivation({
    uiKind: vscode.env.uiKind,
    webUiKind: vscode.UIKind.Web,
    remoteName: vscode.env.remoteName,
    addons,
  });

  const remote = vscode.env.remoteName || "local";
  for (const addon of addons) {
    const where = addon.found ? addon.path : "missing";
    console.log(
      `[info] Knox native ${addon.name} (${addon.required ? "required" : "optional"}) on ${remote}: ${where}`,
    );
  }

  if (decision.kind === "abort-web") {
    void vscode.window.showErrorMessage(t("ext.desktopOnly"));
    return false;
  }
  if (decision.kind === "missing-required") {
    void vscode.window.showWarningMessage(
      t("ext.remoteNativeMissing", { addons: decision.missing.join(", ") }),
    );
  }
  return true;
}
