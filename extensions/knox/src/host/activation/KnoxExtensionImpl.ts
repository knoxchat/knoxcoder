import * as vscode from "vscode";

import {
  getAgentModeManager,
} from "../agent";

import { KnoxApiImpl } from "./api";
import { assertKnoxApiVersion } from "./knoxPublicApi";

import type { VsCodeExtension } from "../extension/VsCodeExtension";
import type { API, ContextItem, CustomContextProvider, KnoxExtension, ToolCall } from "../../api/knox";

/**
 * Published `vscode.knox` exports (KN-364). Git analog: `GitExtensionImpl`.
 * `getAPI(1)` returns {@link API} from `src/api/knox.d.ts`.
 */
export class KnoxExtensionImpl implements KnoxExtension {
  readonly enabled = true;

  private readonly _onDidChangeEnablement = new vscode.EventEmitter<boolean>();
  readonly onDidChangeEnablement = this._onDidChangeEnablement.event;

  private readonly _onDidChangeAgentMode = new vscode.EventEmitter<boolean>();

  private readonly api: API;

  constructor(vscodeExtension: VsCodeExtension) {
    const manager = getAgentModeManager();
    if (manager) {
      manager.onActiveChanged((active) => {
        this._onDidChangeAgentMode.fire(active);
      });
    }

    this.api = new KnoxApiImpl(
      vscodeExtension,
      this._onDidChangeAgentMode.event,
    );
  }

  /**
   * Original Knox public exports (`activate.ts` knoxPublicApi): extensions written
   * against `exports.registerCustomContextProvider` / `exports.agentMode` keep working
   * next to the versioned `getAPI(1)` surface.
   */
  readonly registerCustomContextProvider = (provider: CustomContextProvider): void => {
    this.api.registerCustomContextProvider(provider);
  };

  readonly agentMode = {
    isAgentModeActive: (): Thenable<boolean> => this.api.isAgentModeActive(),
    toggleAgentMode: (): Thenable<void> => this.api.toggleAgentMode(),
    executeToolCall: (toolCall: ToolCall, selectedModelTitle: string): Thenable<ContextItem[]> =>
      this.api.executeToolCall(toolCall, selectedModelTitle),
  };

  getAPI(version: number): API {
    assertKnoxApiVersion(version);
    return this.api;
  }
}
