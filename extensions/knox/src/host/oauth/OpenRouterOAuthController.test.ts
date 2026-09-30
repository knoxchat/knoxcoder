import * as assert from "node:assert";

import {
  clearOpenRouterOAuthSession,
  getOpenRouterOAuthApiKey,
  OAuthError,
} from "core/auth/openrouterOAuth";
import type { OpenRouterOAuthAccount, OpenRouterOAuthStatus } from "core/protocol/openrouterOAuth";
import { storage } from "core/auth/openrouterOAuth";

import { OpenRouterOAuthController } from "./OpenRouterOAuthController";
import {
  restoreOpenRouterOAuthPersisted,
  type OpenRouterOAuthAccountStore,
  type OpenRouterOAuthSecretStore,
} from "./openrouterOAuthPersistence";

function memorySecrets(): OpenRouterOAuthSecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.get(key);
    },
    async store(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function memoryAccounts(): OpenRouterOAuthAccountStore & {
  map: Map<string, unknown>;
} {
  const map = new Map<string, unknown>();
  return {
    map,
    get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async update(key, value) {
      if (value === undefined) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
    },
  };
}

const ACCOUNT: OpenRouterOAuthAccount = {
  label: "KnoxCoder",
  creatorUserId: "user_abc",
  keyHash: "deadbeef",
  connectedAt: 1_700_000_000,
};

function page() {
  return { lang: "en", title: "KnoxCoder", body: "close" };
}

suite("OpenRouterOAuthController", () => {
  teardown(() => {
    clearOpenRouterOAuthSession();
  });

  test("restore hydrates the in-memory session from SecretStorage", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await secrets.store(storage.API_KEY_ITEM, "sk-or-oauth");
    await accounts.update(storage.ACCOUNT_STATE_KEY, ACCOUNT);
    const updates: OpenRouterOAuthStatus[] = [];
    const controller = new OpenRouterOAuthController({
      secrets,
      accounts,
      sendUpdate: (status) => updates.push(status),
      openBrowser: async () => undefined,
      callbackPage: page,
      reloadConfig: async () => undefined,
    });
    await controller.ready;
    assert.strictEqual(getOpenRouterOAuthApiKey(), "sk-or-oauth");
    assert.strictEqual(controller.status().account?.label, "KnoxCoder");
    assert.ok(updates.some((status) => status.state === "idle" && status.account?.label === "KnoxCoder"));
  });

  test("failed login emits failed without storing a key", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    const updates: OpenRouterOAuthStatus[] = [];
    const controller = new OpenRouterOAuthController({
      secrets,
      accounts,
      sendUpdate: (status) => updates.push(status),
      openBrowser: async () => undefined,
      callbackPage: page,
      reloadConfig: async () => undefined,
      login: async () => {
        throw new OAuthError("denied");
      },
    });
    await controller.ready;
    await controller.startLogin();
    assert.ok(
      updates.some((status) => status.state === "failed" && status.error === "denied"),
    );
    assert.strictEqual(getOpenRouterOAuthApiKey(), undefined);
    assert.deepStrictEqual(await restoreOpenRouterOAuthPersisted(secrets, accounts), {
      kind: "empty",
    });
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), undefined);
  });

  test("successful login persists the key and sign-out clears it", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    const updates: OpenRouterOAuthStatus[] = [];
    let warned = false;
    let deleted: { apiKey?: string; keyHash?: string } | undefined;
    const controller = new OpenRouterOAuthController({
      secrets,
      accounts,
      sendUpdate: (status) => updates.push(status),
      openBrowser: async () => undefined,
      callbackPage: page,
      reloadConfig: async () => undefined,
      warnSignOut: () => {
        warned = true;
      },
      logout: async (opts) => {
        deleted = { apiKey: opts.apiKey, keyHash: opts.keyHash };
        return true;
      },
      login: async () => ({
        account: ACCOUNT,
        apiKey: "sk-or-oauth",
      }),
    });
    await controller.ready;
    await controller.startLogin();
    assert.ok(updates.some((status) => status.state === "success"));
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), "sk-or-oauth");
    assert.deepStrictEqual(accounts.get(storage.ACCOUNT_STATE_KEY), ACCOUNT);
    await controller.signOut();
    assert.strictEqual(getOpenRouterOAuthApiKey(), undefined);
    assert.deepStrictEqual(await restoreOpenRouterOAuthPersisted(secrets, accounts), {
      kind: "empty",
    });
    assert.deepStrictEqual(deleted, { apiKey: "sk-or-oauth", keyHash: ACCOUNT.keyHash });
    assert.strictEqual(warned, false);
  });

  test("sign-out warns only when remote key delete fails", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    let warnedAccount: OpenRouterOAuthAccount | undefined;
    const controller = new OpenRouterOAuthController({
      secrets,
      accounts,
      sendUpdate: () => undefined,
      openBrowser: async () => undefined,
      callbackPage: page,
      reloadConfig: async () => undefined,
      warnSignOut: (account) => {
        warnedAccount = account;
      },
      logout: async () => false,
      login: async () => ({
        account: ACCOUNT,
        apiKey: "sk-or-oauth",
      }),
    });
    await controller.ready;
    await controller.startLogin();
    await controller.signOut();
    assert.deepStrictEqual(warnedAccount, ACCOUNT);
  });

  test("a second login deletes the previous minted key", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    const deleted: Array<{ apiKey?: string; keyHash?: string }> = [];
    let loginCount = 0;
    const controller = new OpenRouterOAuthController({
      secrets,
      accounts,
      sendUpdate: () => undefined,
      openBrowser: async () => undefined,
      callbackPage: page,
      reloadConfig: async () => undefined,
      logout: async (opts) => {
        deleted.push({ apiKey: opts.apiKey, keyHash: opts.keyHash });
        return true;
      },
      login: async () => {
        loginCount += 1;
        if (loginCount === 1) {
          return { account: ACCOUNT, apiKey: "sk-or-first" };
        }
        return {
          account: { ...ACCOUNT, keyHash: "cafebabe" },
          apiKey: "sk-or-second",
        };
      },
    });
    await controller.ready;
    await controller.startLogin();
    await controller.startLogin();
    await Promise.resolve();
    assert.deepStrictEqual(deleted, [
      { apiKey: "sk-or-first", keyHash: ACCOUNT.keyHash },
    ]);
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), "sk-or-second");
  });
});
