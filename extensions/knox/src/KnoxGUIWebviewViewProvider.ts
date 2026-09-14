import { ConfigHandler } from "core/config/ConfigHandler";
import * as vscode from "vscode";

import { VsCodeWebviewProtocol } from "./webviewProtocol";

/**
 * Owns the Core GUI protocol for the native Knox sidebar.
 *
 * The workbench `KnoxViewPane` paints the UI. This class is not a
 * `WebviewViewProvider` (T13.2); Core talks to native widgets through
 * `VsCodeWebviewProtocol` + `nativeGui` on the public `vscode.knox` API.
 */
export class KnoxGUIWebviewViewProvider {
  public static readonly viewType = "knoxchat.knoxGUIView";
  public webviewProtocol: VsCodeWebviewProtocol;
  private readonly _onDidResolve = new vscode.EventEmitter<void>();
  readonly onDidResolve = this._onDidResolve.event;

  public get isReady(): boolean {
    return true;
  }

  constructor(
    private readonly configHandlerPromise: Promise<ConfigHandler>,
    _windowId: string,
    _extensionContext: vscode.ExtensionContext,
  ) {
    this.webviewProtocol = new VsCodeWebviewProtocol(
      (async () => {
        const configHandler = await this.configHandlerPromise;
        return configHandler.reloadConfig();
      }).bind(this),
    );
    queueMicrotask(() => this._onDidResolve.fire());
  }

  sendMainUserInput(input: string) {
    void this.webviewProtocol.request("userInput", { input });
  }
}
