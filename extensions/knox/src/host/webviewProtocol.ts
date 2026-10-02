import { FromWebviewProtocol, ToWebviewProtocol } from "core/protocol";
import { dispatchProtocolHandlers } from "core/protocol/dispatchHandlers";
import { Message } from "core/protocol/messenger";
import { summarizeProtocolMessage } from "core/protocol/summarizeMessage";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

import { t } from "./i18n";

import { IMessenger } from "../../../core/protocol/messenger";

export class VsCodeWebviewProtocol
  implements IMessenger<FromWebviewProtocol, ToWebviewProtocol>
{
  listeners = new Map<
    keyof FromWebviewProtocol,
    ((message: Message) => any)[]
  >();

  private _onErrorHandlers: ((message: Message, error: Error) => void)[] = [];
  private readonly _onDidSend = new vscode.EventEmitter<Message>();
  readonly onDidSend = this._onDidSend.event;
  private readonly _onDidReceiveNative = new vscode.EventEmitter<Message>();
  private _nativeAttached = false;

  attachNativeClient(): void {
    this._nativeAttached = true;
  }

  private hasTransport(): boolean {
    return this._nativeAttached || !!this._webview;
  }

  send(messageType: string, data: any, messageId?: string): string {
    const id = messageId ?? uuidv4();
    const msg: Message = {
      messageType,
      data,
      messageId: id,
    };
    this._onDidSend.fire(msg);
    this.webview?.postMessage(msg);
    return id;
  }

  on<T extends keyof FromWebviewProtocol>(
    messageType: T,
    handler: (
      message: Message<FromWebviewProtocol[T][0]>,
    ) => Promise<FromWebviewProtocol[T][1]> | FromWebviewProtocol[T][1],
  ): void {
    if (!this.listeners.has(messageType)) {
      this.listeners.set(messageType, []);
    }
    this.listeners.get(messageType)?.push(handler);
  }

  onError(handler: (message: Message, error: Error) => void): void {
    this._onErrorHandlers.push(handler);
  }

  /**
   * Synchronously invoke a locally registered FromWebview handler (same side
   * as `on`). Used when the extension host needs the handler result without a
   * round-trip through the webview.
   */
  invoke<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
    messageId?: string,
  ): FromWebviewProtocol[T][1] {
    const handlers = this.listeners.get(messageType) || [];
    if (handlers.length === 0) {
      return undefined as FromWebviewProtocol[T][1];
    }
    const msg: Message = {
      messageType: messageType as string,
      data,
      messageId: messageId ?? uuidv4(),
    };
    return handlers[0](msg);
  }

  _webview?: vscode.Webview;
  _webviewListener?: vscode.Disposable;

  get webview(): vscode.Webview | undefined {
    return this._webview;
  }

  set webview(webView: vscode.Webview) {
    this._webview = webView;
    this._webviewListener?.dispose();
    this._webviewListener = this._webview.onDidReceiveMessage((msg) => {
      void this.handleIncoming(msg);
    });
  }

  async receiveFromNative(msg: Message): Promise<void> {
    this._onDidReceiveNative.fire(msg);
    await this.handleIncoming(msg);
  }

  private async handleIncoming(msg: Message): Promise<void> {
      if (!("messageType" in msg) || !("messageId" in msg)) {
        throw new Error(
          `Invalid WebView protocol message: ${summarizeProtocolMessage(msg)}`,
        );
      }

      const respond = (message: any) =>
        this.send(msg.messageType, message, msg.messageId);

      const handlers =
        this.listeners.get(msg.messageType as keyof FromWebviewProtocol) || [];
      const dispatched = await dispatchProtocolHandlers(handlers, msg, respond);
      if (dispatched.kind !== "error") {
        return;
      }

      const err = dispatched.error;
      const cause = (err as Error & { cause?: { name?: string; code?: string; message?: string } }).cause;
      for (const errorHandler of this._onErrorHandlers) {
        try {
          errorHandler(msg, err);
        } catch (handlerErr) {
          console.error("webviewProtocol onError handler failed", handlerErr);
        }
      }

      // Build the user-visible message first, then send ONE error
      // response. A prior empty `{ status: "error" }` reply won the
      // webview request() race and showed "Unknown tool call error".
      let message = err.message || String(err);
      if (cause) {
        if (cause.name === "ConnectTimeoutError") {
          message = t("connection.timeout");
        } else if (cause.code === "ECONNREFUSED") {
          message = t("connection.refused");
        } else {
          message = t("connection.requestFailed", {
            name: cause.name,
            message: cause.message,
          });
        }
      }

      const quotaHit =
        message.includes("exceeded") &&
        (message.includes("quota") ||
          message.includes("rate limit") ||
          message.includes("usage"));
      if (quotaHit) {
        message += t("webview.exceededUsageHint");
      }

      respond({ done: true, error: message, status: "error" });

      const summary = summarizeProtocolMessage(msg);
      console.error(
        `Error handling webview message: ${summary}\n\n${err}`,
      );

      if (
        summary.includes("llm/streamChat") ||
        summary.includes("chatDescriber/describe")
      ) {
        return;
      }

      if (quotaHit) {
        vscode.window
          .showInformationMessage(
            message,
            t("webview.addApiKey"),
            t("webview.useLocalModel"),
          )
          .then((selection) => {
            if (selection === t("webview.addApiKey")) {
              this.request("addApiKey", undefined);
            }
          });
      }
  }

  constructor(private readonly reloadConfig: () => void) {}

  public request<T extends keyof ToWebviewProtocol>(
    messageType: T,
    data: ToWebviewProtocol[T][0],
    retry: boolean = true,
  ): Promise<ToWebviewProtocol[T][1]> {
    const messageId = uuidv4();
    return new Promise(async (resolve) => {
      if (retry) {
        let i = 0;
        while (!this.hasTransport()) {
          if (i >= 10) {
            resolve(undefined);
            return;
          } else {
            await new Promise((res) => setTimeout(res, i >= 5 ? 1000 : 500));
            i++;
          }
        }
      }

      const finish = (msg: Message<ToWebviewProtocol[T][1]>) => {
        if (msg.messageId === messageId) {
          resolve(msg.data);
          disposable?.dispose();
          nativeDisposable.dispose();
        }
      };

      const disposable = this.webview?.onDidReceiveMessage(finish);
      const nativeDisposable = this._onDidReceiveNative.event((msg) => {
        finish(msg as Message<ToWebviewProtocol[T][1]>);
      });

      this.send(messageType, data, messageId);

      if (!this.hasTransport() && !retry) {
        resolve(undefined);
      }
    });
  }
}
