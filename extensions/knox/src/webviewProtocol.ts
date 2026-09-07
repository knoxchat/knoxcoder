import { FromWebviewProtocol, ToWebviewProtocol } from "core/protocol";
import { IMessenger, Message } from "core/protocol/messenger";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

import { t } from "./i18n";

export class VsCodeWebviewProtocol
  implements IMessenger<FromWebviewProtocol, ToWebviewProtocol>
{
  listeners = new Map<
    keyof FromWebviewProtocol,
    ((message: Message) => any)[]
  >();

  private _onErrorHandlers: ((message: Message, error: Error) => void)[] = [];

  send(messageType: string, data: any, messageId?: string): string {
    const id = messageId ?? uuidv4();
    this.webview?.postMessage({
      messageType,
      data,
      messageId: id,
    });
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

    const handleMessage = async (msg: Message): Promise<void> => {
      if (!("messageType" in msg) || !("messageId" in msg)) {
        throw new Error(`Invalid WebView protocol message: ${JSON.stringify(msg)}`);
      }

      const respond = (message: any) =>
        this.send(msg.messageType, message, msg.messageId);

      const handlers =
        this.listeners.get(msg.messageType as keyof FromWebviewProtocol) || [];
      for (const handler of handlers) {
        try {
          const response = await handler(msg);
          // For generator types e.g. llm/streamChat
          if (
            response &&
            typeof response[Symbol.asyncIterator] === "function"
          ) {
            let next = await response.next();
            while (!next.done) {
              respond({
                done: false,
                content: next.value,
                status: "success",
              });
              next = await response.next();
            }
            respond({
              done: true,
              content: next.value,
              status: "success",
            });
          } else {
            respond({ done: true, content: response, status: "success" });
          }
        } catch (e: any) {
          const err = e instanceof Error ? e : new Error(String(e));
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
          let message = err.message || String(e);
          if (e?.cause) {
            if (e.cause.name === "ConnectTimeoutError") {
              message = t("connection.timeout");
            } else if (e.cause.code === "ECONNREFUSED") {
              message = t("connection.refused");
            } else {
              message = t("connection.requestFailed", {
                name: e.cause.name,
                message: e.cause.message,
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

          const stringified = JSON.stringify({ msg }, null, 2);
          console.error(
            `Error handling webview message: ${stringified}\n\n${e}`,
          );

          if (
            stringified.includes("llm/streamChat") ||
            stringified.includes("chatDescriber/describe")
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
      }
    };

    this._webviewListener = this._webview.onDidReceiveMessage(handleMessage);
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
        while (!this.webview) {
          if (i >= 10) {
            resolve(undefined);
            return;
          } else {
            await new Promise((res) => setTimeout(res, i >= 5 ? 1000 : 500));
            i++;
          }
        }
      }

      this.send(messageType, data, messageId);

      if (this.webview) {
        const disposable = this.webview.onDidReceiveMessage(
          (msg: Message<ToWebviewProtocol[T][1]>) => {
            if (msg.messageId === messageId) {
              resolve(msg.data);
              disposable?.dispose();
            }
          },
        );
      } else if (!retry) {
        resolve(undefined);
      }
    });
  }
}
