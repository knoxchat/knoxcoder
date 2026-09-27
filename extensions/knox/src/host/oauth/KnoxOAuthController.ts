import {
  applyDebugLocalhostDefaults,
  clearKnoxChatOAuthSession,
  getKnoxChatOAuthAccount,
  getKnoxChatOAuthApiKey,
  loginWithKnoxChat,
  logoutKnoxChat,
  OAuthError,
  setKnoxChatOAuthAccount,
  setKnoxChatOAuthApiKey,
  storage,
} from "core/auth/knoxOAuth";
import type {
  KnoxOAuthAccount,
  KnoxOAuthErrorKind,
  KnoxOAuthLoginState,
  KnoxOAuthStatus,
} from "core/protocol/knoxOAuth";
import { ConfigHandler } from "core/config/ConfigHandler";
import * as vscode from "vscode";

import { t } from "../i18n";
import { VsCodeIde } from "../VsCodeIde";
import { VsCodeWebviewProtocol } from "../webviewProtocol";
import {
  clearKnoxOAuthPersisted,
  KNOX_OAUTH_UPDATE_MESSAGE,
  persistKnoxOAuthSession,
  restoreKnoxOAuthPersisted,
} from "./knoxOAuthPersistence";

/** KN-360: PKCE login, loopback, SecretStorage tokens, native `knoxchat/oauth/*`. */
export class KnoxOAuthController implements vscode.Disposable {
  private loginAbort: AbortController | undefined;
  private loginGeneration = 0;
  private state: KnoxOAuthLoginState = "idle";
  private error: KnoxOAuthErrorKind | undefined;

  constructor(
    private readonly ide: VsCodeIde,
    private readonly webviewProtocol: VsCodeWebviewProtocol,
    private readonly configHandlerPromise: Promise<ConfigHandler>,
  ) {
    if (
      ide.extensionContext.extensionMode === vscode.ExtensionMode.Development &&
      ide.extensionContext.extension.id !== "vscode.knox"
    ) {
      applyDebugLocalhostDefaults();
    }
    ide.extensionContext.subscriptions.push(this);
    void this.restore();
  }

  dispose(): void {
    this.cancel();
  }

  status(): KnoxOAuthStatus {
    return {
      state: this.state,
      error: this.error,
      account: getKnoxChatOAuthAccount(),
    };
  }

  cancel(): void {
    this.loginAbort?.abort();
  }

  async startLogin(): Promise<void> {
    if (
      this.state === "opening_browser" ||
      this.state === "waiting_for_consent" ||
      this.state === "exchanging"
    ) {
      return;
    }
    this.loginAbort?.abort();
    const abort = new AbortController();
    this.loginAbort = abort;
    const generation = ++this.loginGeneration;
    this.error = undefined;
    this.emit("opening_browser");

    try {
      const session = await loginWithKnoxChat({
        openBrowser: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
        onState: (state) => {
          if (generation === this.loginGeneration) {
            this.emit(state);
          }
        },
        page: {
          lang: vscode.env.language.startsWith("zh") ? "zh-Hans" : "en",
          title: t("oauth.callbackTitle"),
          body: t("oauth.callbackClose"),
        },
        signal: abort.signal,
      });

      if (generation !== this.loginGeneration) {
        return;
      }

      await this.persistSession(
        session.account,
        session.apiKey,
        session.refreshToken,
      );
      this.emit("success");
      await this.reloadConfig();
    } catch (err) {
      if (generation !== this.loginGeneration) {
        return;
      }
      const kind = err instanceof OAuthError ? err.kind : "exchange";
      this.error = kind === "cancelled" ? undefined : kind;
      this.emit(kind === "cancelled" ? "idle" : "failed");
    }
  }

  async signOut(): Promise<void> {
    this.loginGeneration += 1;
    this.loginAbort?.abort();
    const apiKey = getKnoxChatOAuthApiKey();
    const refresh = await this.ide.secretStorage.get(storage.REFRESH_TOKEN_ITEM);
    clearKnoxChatOAuthSession();
    await this.clearPersistedSecrets();
    this.error = undefined;
    this.emit("idle");
    await this.reloadConfig();
    void logoutKnoxChat({ apiKey, refreshToken: refresh }).then((remoteOk) => {
      if (!remoteOk) {
        void vscode.window.showWarningMessage(t("oauth.signedOutLocal"));
      }
    });
  }

  private async restore(): Promise<void> {
    const restored = await restoreKnoxOAuthPersisted(
      this.ide.secretStorage,
      this.ide.extensionContext.globalState,
    );
    if (restored.kind === "session") {
      setKnoxChatOAuthAccount(restored.account);
      setKnoxChatOAuthApiKey(restored.apiKey);
      this.emit("idle");
      await this.reloadConfig();
      return;
    }
    clearKnoxChatOAuthSession();
    this.emit("idle");
  }

  private async persistSession(
    account: KnoxOAuthAccount,
    apiKey: string,
    refreshToken?: string,
  ): Promise<void> {
    setKnoxChatOAuthAccount(account);
    setKnoxChatOAuthApiKey(apiKey);
    await persistKnoxOAuthSession(
      this.ide.secretStorage,
      this.ide.extensionContext.globalState,
      account,
      apiKey,
      refreshToken,
    );
  }

  private async clearPersistedSecrets(): Promise<void> {
    await clearKnoxOAuthPersisted(
      this.ide.secretStorage,
      this.ide.extensionContext.globalState,
    );
  }

  private emit(state: KnoxOAuthLoginState): void {
    this.state = state;
    this.webviewProtocol.send(KNOX_OAUTH_UPDATE_MESSAGE, this.status());
  }

  private async reloadConfig(): Promise<void> {
    try {
      const configHandler = await this.configHandlerPromise;
      await configHandler.reloadConfig();
    } catch (err) {
      console.warn(
        `oauth: failed to reload config: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
