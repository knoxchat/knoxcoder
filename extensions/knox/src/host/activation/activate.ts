import * as vscode from "vscode";

import { activateAgentMode } from "../agent";
import { VsCodeExtension } from "../extension/VsCodeExtension";
import { t } from "../i18n";
import registerQuickFixProvider from "../lang-server/codeActions";
import { installHostNativePty } from "../util/installNativePty";

import { KnoxExtensionImpl } from "./KnoxExtensionImpl";
import { installRemoteNativeAddons } from "./installRemoteNativeAddons";
import setupInlineTips from "./InlineTipManager";
import {
  knoxUriHandlePlan,
  parseKnoxUri,
} from "./knoxUriHandler";
import {
  MARKETPLACE_KNOX_ID,
  MARKETPLACE_NOTICE_STATE_KEY,
  shouldShowBuiltinTakesOverNotice,
} from "./marketplaceConflict";

/** KN-356: `knox://` + `knoxcoder://vscode.knox/…` (open chat / OAuth callback). */
function registerKnoxUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        const plan = knoxUriHandlePlan(
          parseKnoxUri({
            scheme: uri.scheme,
            authority: uri.authority,
            path: uri.path,
            query: uri.query,
          }),
        );
        if (plan.kind === "command") {
          void vscode.commands.executeCommand(plan.command);
          return;
        }
        if (plan.kind === "fetch") {
          void fetch(plan.url).catch(() => undefined);
        }
      },
    }),
  );
}

function maybeNotifyMarketplaceDuplicate(context: vscode.ExtensionContext): void {
  if (
    !shouldShowBuiltinTakesOverNotice({
      thisExtensionId: context.extension.id,
      marketplacePresent: Boolean(
        vscode.extensions.getExtension(MARKETPLACE_KNOX_ID),
      ),
      alreadyShown: context.globalState.get(MARKETPLACE_NOTICE_STATE_KEY) === true,
    })
  ) {
    return;
  }
  void context.globalState.update(MARKETPLACE_NOTICE_STATE_KEY, true);
  void vscode.window
    .showInformationMessage(
      t("ext.marketplaceBuiltinNotice"),
      t("ext.uninstallMarketplaceKnox"),
    )
    .then((selection) => {
      if (selection === t("ext.uninstallMarketplaceKnox")) {
        return vscode.commands.executeCommand(
          "workbench.extensions.uninstallExtension",
          MARKETPLACE_KNOX_ID,
        );
      }
      return undefined;
    });
}

export async function activateExtension(context: vscode.ExtensionContext) {
  // K-038: phase timings, one console line. Compare against the budget in
  // core/eval/startupBudget.test.ts and `npm run measure-startup`.
  const t0 = Date.now();
  const phases: Array<[string, number]> = [];
  const lap = (name: string, from: number): number => {
    const now = Date.now();
    phases.push([name, now - from]);
    return now;
  };
  let mark = t0;
  installRemoteNativeAddons(context);
  installHostNativePty(context);
  registerQuickFixProvider(context);
  setupInlineTips(context);
  mark = lap("natives+tips", mark);

  // Agent mode before the host: toggle/context keys exist before the
  // messenger and GUI attach (Cmd/Ctrl+Shift+Alt+A still forces Agent on).
  const agentModeDisposable = activateAgentMode(context);
  context.subscriptions.push(agentModeDisposable);
  mark = lap("agentMode", mark);

  const vscodeExtension = new VsCodeExtension(context);
  mark = lap("VsCodeExtension", mark);

  registerKnoxUriHandler(context);
  maybeNotifyMarketplaceDuplicate(context);

  // Legacy alias for users who remapped the old keybinding command id
  context.subscriptions.push(
    vscode.commands.registerCommand('knox.toggleAgentModeCommand', () => {
      return vscode.commands.executeCommand('knox.toggleAgentMode');
    })
  );

  if (!context.globalState.get("hasBeenInstalled")) {
    context.globalState.update("hasBeenInstalled", true);
  }

  const knoxExtension = new KnoxExtensionImpl(vscodeExtension);
  console.log(
    `[startup] activate ${Date.now() - t0}ms (${phases
      .map(([name, ms]) => `${name} ${ms}ms`)
      .join(", ")})`,
  );

  return process.env.NODE_ENV === "test"
    ? Object.assign(knoxExtension, { extension: vscodeExtension })
    : knoxExtension;
}
