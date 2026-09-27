import { KnoxConfig, QuickActionConfig } from "core";
import * as vscode from "vscode";

import {
  KNOX_WORKSPACE_KEY,
  getKnoxWorkspaceConfig,
} from "../../../util/workspaceConfig";
import {
  ENABLE_QUICK_ACTIONS_SETTING,
  quickActionCodeLensSpecs,
} from "../codeLensSpecs";

export const ENABLE_QUICK_ACTIONS_KEY = "enableQuickActions";

export function getQuickActionsConfig(config: KnoxConfig) {
  return config.experimental?.quickActions;
}

export function subscribeToVSCodeQuickActionsSettings(listener: () => void) {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(ENABLE_QUICK_ACTIONS_SETTING) ||
        e.affectsConfiguration(`${KNOX_WORKSPACE_KEY}.${ENABLE_QUICK_ACTIONS_KEY}`)) {
      listener();
    }
  });
}

export function toggleQuickActions() {
  getKnoxWorkspaceConfig().update(
    ENABLE_QUICK_ACTIONS_KEY,
    !quickActionsEnabledStatus(),
  );
}

export function quickActionsEnabledStatus() {
  return getKnoxWorkspaceConfig().get<boolean>(ENABLE_QUICK_ACTIONS_KEY) ?? false;
}

/**
 * A CodeLensProvider for Quick Actions.
 *
 * This class provides code lenses for Quick Actions, which can be either custom or default actions.
 * It supports actions for functions and classes, and can be configured with custom quick action settings.
 */
export class QuickActionsCodeLensProvider implements vscode.CodeLensProvider {
  /**
   * Defines which code elements are eligible for Quick Actions.
   *
   * Right now, we only allow functions, methods, constructors
   * and classes to keep things simple.
   */
  quickActionSymbolKinds = [
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Constructor,
  ];

  constructor(private customQuickActionsConfigs?: QuickActionConfig[]) {}

  /**
   * Get all top-level symbols and their immediate children.
   * We do not recurse through all children to avoid noise.
   */
  async getTopLevelAndChildrenSymbols(uri: vscode.Uri) {
    const topLevelSymbols = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol> | undefined
    >("vscode.executeDocumentSymbolProvider", uri);

    if (!topLevelSymbols) {
      return [];
    }

    const childrenSymbols = topLevelSymbols.flatMap(
      (symbol) => symbol.children,
    );

    const symbols = [...topLevelSymbols, ...childrenSymbols];

    return symbols.filter(
      (symbol) =>
        this.quickActionSymbolKinds.includes(symbol.kind) &&
        !symbol.range.isSingleLine,
    );
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const symbols = await this.getTopLevelAndChildrenSymbols(document.uri);

    return quickActionCodeLensSpecs(
      true,
      symbols.map(({ range }) => ({
        startLine: range.start.line,
        endLine: range.end.line,
        range,
      })),
      this.customQuickActionsConfigs,
    ).map(
      (spec) =>
        new vscode.CodeLens(
          (spec.lensRange as vscode.Range) ??
            new vscode.Range(spec.startLine, 0, spec.endLine, 0),
          spec.command as vscode.Command,
        ),
    );
  }
}
