import { IContextProvider } from "core";
import { FromWebviewProtocol } from "core/protocol";
import { Message } from "core/protocol/messenger";

import { VsCodeExtension } from "../extension/VsCodeExtension";

export type KnoxGuiMessage = {
  messageType: string;
  messageId: string;
  data: unknown;
};

export class VsCodeKnoxApi {
  constructor(private readonly vscodeExtension: VsCodeExtension) {}

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.vscodeExtension.registerCustomContextProvider(contextProvider);
  }

  async nativeRequest(messageType: string, data: unknown, messageId: string): Promise<unknown> {
    const protocol = await this.vscodeExtension.webviewProtocolPromise;
    return protocol.invoke(
      messageType as keyof FromWebviewProtocol,
      data as FromWebviewProtocol[keyof FromWebviewProtocol][0],
      messageId,
    );
  }

  async nativePost(messageType: string, data: unknown, messageId: string): Promise<void> {
    const protocol = await this.vscodeExtension.webviewProtocolPromise;
    const msg: Message = { messageType, data, messageId };
    await protocol.handleNativeIncoming(msg);
  }

  setNativePushHandler(handler: (message: KnoxGuiMessage) => unknown): void {
    void this.vscodeExtension.webviewProtocolPromise.then((protocol) => {
      protocol.setNativeSink((msg) =>
        handler({
          messageType: msg.messageType,
          messageId: msg.messageId,
          data: msg.data,
        }),
      );
    });
  }

  nativeRespond(messageType: string, data: unknown, messageId: string): void {
    void this.vscodeExtension.webviewProtocolPromise.then((protocol) => {
      protocol.receiveNativeResponse({ messageType, data, messageId });
    });
  }
}
