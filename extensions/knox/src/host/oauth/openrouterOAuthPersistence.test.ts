import * as assert from "node:assert";

import type { OpenRouterOAuthAccount } from "core/protocol/openrouterOAuth";
import { storage } from "core/auth/openrouterOAuth";

import {
  clearOpenRouterOAuthPersisted,
  OPENROUTER_OAUTH_CANCEL_MESSAGE,
  OPENROUTER_OAUTH_SECRET_KEYS,
  OPENROUTER_OAUTH_SIGN_OUT_MESSAGE,
  OPENROUTER_OAUTH_START_MESSAGE,
  OPENROUTER_OAUTH_STATUS_MESSAGE,
  OPENROUTER_OAUTH_UPDATE_MESSAGE,
  persistOpenRouterOAuthSession,
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
  connectedAt: 1_700_000_000,
};

suite("OpenRouter OAuth SecretStorage persist/restore", () => {
  test("protocol message ids stay the webview catalog names", () => {
    assert.strictEqual(OPENROUTER_OAUTH_STATUS_MESSAGE, "openrouter/oauth/status");
    assert.strictEqual(OPENROUTER_OAUTH_START_MESSAGE, "openrouter/oauth/start");
    assert.strictEqual(OPENROUTER_OAUTH_CANCEL_MESSAGE, "openrouter/oauth/cancel");
    assert.strictEqual(OPENROUTER_OAUTH_SIGN_OUT_MESSAGE, "openrouter/oauth/signOut");
    assert.strictEqual(OPENROUTER_OAUTH_UPDATE_MESSAGE, "openrouter/oauth/update");
    assert.strictEqual(OPENROUTER_OAUTH_SECRET_KEYS.apiKey, "openrouter_oauth_api_key");
    assert.strictEqual(
      OPENROUTER_OAUTH_SECRET_KEYS.account,
      "openrouter.oauth.account",
    );
  });

  test("persist writes the key to secrets and account to globalState", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistOpenRouterOAuthSession(secrets, accounts, ACCOUNT, "sk-or-oauth");
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), "sk-or-oauth");
    assert.deepStrictEqual(accounts.get(storage.ACCOUNT_STATE_KEY), ACCOUNT);
    assert.ok(!JSON.stringify([...secrets.map.values()]).includes("client_secret"));
    assert.ok(!(storage as { REFRESH_TOKEN_ITEM?: string }).REFRESH_TOKEN_ITEM);
  });

  test("restore round-trips after a simulated reload", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistOpenRouterOAuthSession(secrets, accounts, ACCOUNT, "sk-or-oauth");
    const restored = await restoreOpenRouterOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(restored, {
      kind: "session",
      account: ACCOUNT,
      apiKey: "sk-or-oauth",
    });
  });

  test("partial persist is cleared instead of restoring a half session", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await secrets.store(storage.API_KEY_ITEM, "sk-or-orphan");
    const restored = await restoreOpenRouterOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(restored, { kind: "empty" });
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), undefined);
  });

  test("clear drops secrets and account metadata", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistOpenRouterOAuthSession(secrets, accounts, ACCOUNT, "sk-or-oauth");
    await clearOpenRouterOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(await restoreOpenRouterOAuthPersisted(secrets, accounts), {
      kind: "empty",
    });
    assert.strictEqual(accounts.get(storage.ACCOUNT_STATE_KEY), undefined);
  });
});
