import { KnoxConfig } from "core";
import * as vscode from "vscode";

import { VerticalDiffCodeLens } from "../../diff/vertical/manager";

import * as providers from "./providers";
import {
  getQuickActionsConfig,
  quickActionsEnabledStatus,
  subscribeToVSCodeQuickActionsSettings,
} from "./providers/QuickActionsCodeLensProvider";

const { registerCodeLensProvider } = vscode.languages;

export let verticalPerLineCodeLensProvider: vscode.Disposable | undefined =
  undefined;
let suggestionsCodeLensDisposable: vscode.Disposable | undefined = undefined;
let quickActionsCodeLensDisposable: vscode.Disposable | undefined = undefined;
let quickActionsSettingsDisposable: vscode.Disposable | undefined = undefined;
let lastQuickActionsConfig: KnoxConfig | undefined;

/**
 * Registers the Quick Actions CodeLens provider if Quick Actions are enabled
 * via `knoxchat.enableQuickActions`. Custom actions come from config.yaml
 * `experimental.quickActions`.
 */
function registerQuickActionsProvider(
  config: KnoxConfig,
  context: vscode.ExtensionContext,
) {
  if (quickActionsCodeLensDisposable) {
    quickActionsCodeLensDisposable.dispose();
    quickActionsCodeLensDisposable = undefined;
  }

  if (quickActionsEnabledStatus()) {
    const quickActionsConfig = getQuickActionsConfig(config);

    quickActionsCodeLensDisposable = registerCodeLensProvider(
      "*",
      new providers.QuickActionsCodeLensProvider(quickActionsConfig),
    );

    context.subscriptions.push(quickActionsCodeLensDisposable);
  }
}

/**
 * Registers all CodeLens providers for the Knox extension.
 *
 * This function disposes of any existing CodeLens providers and registers new ones for:
 * - Vertical per-line diffs
 * - Suggestions
 * - Quick Actions (`knoxchat.enableQuickActions`)
 *
 * It also sets up a one-shot subscription to VS Code Quick Actions settings changes.
 */
export function registerAllCodeLensProviders(
  context: vscode.ExtensionContext,
  editorToVerticalDiffCodeLens: Map<string, VerticalDiffCodeLens[]>,
  config: KnoxConfig | undefined,
) {
  if (verticalPerLineCodeLensProvider) {
    verticalPerLineCodeLensProvider.dispose();
  }

  if (suggestionsCodeLensDisposable) {
    suggestionsCodeLensDisposable.dispose();
  }

  const verticalDiffCodeLens = new providers.VerticalPerLineCodeLensProvider(
    editorToVerticalDiffCodeLens,
  );

  verticalPerLineCodeLensProvider = registerCodeLensProvider(
    "*",
    verticalDiffCodeLens,
  );

  suggestionsCodeLensDisposable = registerCodeLensProvider(
    "*",
    new providers.SuggestionsCodeLensProvider(),
  );

  if (config) {
    lastQuickActionsConfig = config;
    registerQuickActionsProvider(config, context);

    if (!quickActionsSettingsDisposable) {
      quickActionsSettingsDisposable = subscribeToVSCodeQuickActionsSettings(
        () => {
          if (lastQuickActionsConfig) {
            registerQuickActionsProvider(lastQuickActionsConfig, context);
          }
        },
      );
      context.subscriptions.push(quickActionsSettingsDisposable);
    }
  }

  context.subscriptions.push(verticalPerLineCodeLensProvider);
  context.subscriptions.push(suggestionsCodeLensDisposable);

  return { verticalDiffCodeLens };
}
