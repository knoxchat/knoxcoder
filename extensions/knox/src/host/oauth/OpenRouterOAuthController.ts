/**
 * OpenRouter PKCE login, loopback, SecretStorage tokens, native `openrouter/oauth/*`.
 *
 * vscode-free so persist/restore/failed-login can be unit tested. The host
 * messenger supplies browser open, SecretStorage, and `reloadConfig`.
 */

import {
  clearOpenRouterOAuthSession,
  getOpenRouterOAuthAccount,
  getOpenRouterOAuthApiKey,
  loginWithOpenRouter,
  logoutOpenRouter,
  OAuthError,
  setOpenRouterOAuthAccount,
  setOpenRouterOAuthApiKey,
} from "core/auth/openrouterOAuth";
import type { LoginCallbacks, LogoutOptions, MintedSession } from "core/auth/openrouterOAuth";
import type {
  OpenRouterOAuthAccount,
  OpenRouterOAuthErrorKind,
  OpenRouterOAuthLoginState,
  OpenRouterOAuthStatus,
} from "core/protocol/openrouterOAuth";

import {
  clearOpenRouterOAuthPersisted,
  persistOpenRouterOAuthSession,
  restoreOpenRouterOAuthPersisted,
  type OpenRouterOAuthAccountStore,
  type OpenRouterOAuthSecretStore,
} from "./openrouterOAuthPersistence";

export type OpenRouterOAuthControllerOptions = {
  secrets: OpenRouterOAuthSecretStore;
  accounts: OpenRouterOAuthAccountStore;
  sendUpdate: (status: OpenRouterOAuthStatus) => void;
  openBrowser: (url: string) => Promise<void>;
  callbackPage: () => LoginCallbacks["page"];
  reloadConfig: () => Promise<void>;
  /** Shown only when remote key delete fails, matching KnoxChat. */
  warnSignOut?: (account?: OpenRouterOAuthAccount) => void;
  login?: (callbacks: LoginCallbacks) => Promise<MintedSession>;
  logout?: (opts: LogoutOptions) => Promise<boolean>;
};

export class OpenRouterOAuthController {
  private loginAbort: AbortController | undefined;
  private loginGeneration = 0;
  private state: OpenRouterOAuthLoginState = "idle";
  private error: OpenRouterOAuthErrorKind | undefined;
  readonly ready: Promise<void>;

  constructor(private readonly opts: OpenRouterOAuthControllerOptions) {
    this.ready = this.restore();
  }

  dispose(): void {
    this.cancel();
  }

  status(): OpenRouterOAuthStatus {
    return {
      state: this.state,
      error: this.error,
      account: getOpenRouterOAuthAccount(),
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

    const login = this.opts.login ?? loginWithOpenRouter;
    try {
      const session = await login({
        openBrowser: this.opts.openBrowser,
        onState: (state) => {
          if (generation === this.loginGeneration) {
            this.emit(state);
          }
        },
        page: this.opts.callbackPage(),
        signal: abort.signal,
      });

      if (generation !== this.loginGeneration) {
        return;
      }

      await this.persistSession(session.account, session.apiKey);
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
    const account = getOpenRouterOAuthAccount();
    const apiKey = getOpenRouterOAuthApiKey();
    this.loginGeneration += 1;
    this.loginAbort?.abort();
    clearOpenRouterOAuthSession();
    await this.clearPersistedSecrets();
    this.error = undefined;
    this.emit("idle");
    await this.reloadConfig();
    const logout = this.opts.logout ?? logoutOpenRouter;
    const remoteOk = await logout({ apiKey, keyHash: account?.keyHash });
    if (!remoteOk) {
      this.opts.warnSignOut?.(account);
    }
  }

  private async restore(): Promise<void> {
    const generation = this.loginGeneration;
    const restored = await restoreOpenRouterOAuthPersisted(
      this.opts.secrets,
      this.opts.accounts,
    );
    if (generation !== this.loginGeneration) {
      return;
    }
    if (restored.kind === "session") {
      setOpenRouterOAuthAccount(restored.account);
      setOpenRouterOAuthApiKey(restored.apiKey);
      this.emit("idle");
      await this.reloadConfig();
      return;
    }
    clearOpenRouterOAuthSession();
    this.emit("idle");
  }

  private async persistSession(
    account: OpenRouterOAuthAccount,
    apiKey: string,
  ): Promise<void> {
    const previousKey = getOpenRouterOAuthApiKey();
    const previousHash = getOpenRouterOAuthAccount()?.keyHash;
    setOpenRouterOAuthAccount(account);
    setOpenRouterOAuthApiKey(apiKey);
    await persistOpenRouterOAuthSession(
      this.opts.secrets,
      this.opts.accounts,
      account,
      apiKey,
    );
    const trimmed = apiKey.trim();
    if (previousKey && previousKey !== trimmed) {
      // PKCE always mints a new key. Delete the previous one so re-login
      // rotates like KnoxChat's named token instead of leaving orphans.
      const logout = this.opts.logout ?? logoutOpenRouter;
      void logout({ apiKey: previousKey, keyHash: previousHash });
    }
  }

  private async clearPersistedSecrets(): Promise<void> {
    await clearOpenRouterOAuthPersisted(this.opts.secrets, this.opts.accounts);
  }

  private emit(state: OpenRouterOAuthLoginState): void {
    this.state = state;
    this.opts.sendUpdate(this.status());
  }

  private async reloadConfig(): Promise<void> {
    try {
      await this.opts.reloadConfig();
    } catch (err) {
      console.warn(
        `oauth: failed to reload config: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
