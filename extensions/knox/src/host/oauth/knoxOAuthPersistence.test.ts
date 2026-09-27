import * as assert from "node:assert";

import type { KnoxOAuthAccount } from "core/protocol/knoxOAuth";
import { storage } from "core/auth/knoxOAuth";

import {
  clearKnoxOAuthPersisted,
  KNOX_OAUTH_CANCEL_MESSAGE,
  KNOX_OAUTH_SECRET_KEYS,
  KNOX_OAUTH_SIGN_OUT_MESSAGE,
  KNOX_OAUTH_START_MESSAGE,
  KNOX_OAUTH_STATUS_MESSAGE,
  KNOX_OAUTH_UPDATE_MESSAGE,
  persistKnoxOAuthSession,
  restoreKnoxOAuthPersisted,
  type KnoxOAuthAccountStore,
  type KnoxOAuthSecretStore,
} from "./knoxOAuthPersistence";

function memorySecrets(): KnoxOAuthSecretStore & { map: Map<string, string> } {
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

function memoryAccounts(): KnoxOAuthAccountStore & {
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

const ACCOUNT: KnoxOAuthAccount = {
  userId: 9,
  username: "knox",
  tokenId: 42,
  connectedAt: 1_700_000_000,
};

suite("KN-360 KnoxChat OAuth SecretStorage persist/restore", () => {
  test("protocol message ids stay the webview catalog names", () => {
    assert.strictEqual(KNOX_OAUTH_STATUS_MESSAGE, "knoxchat/oauth/status");
    assert.strictEqual(KNOX_OAUTH_START_MESSAGE, "knoxchat/oauth/start");
    assert.strictEqual(KNOX_OAUTH_CANCEL_MESSAGE, "knoxchat/oauth/cancel");
    assert.strictEqual(KNOX_OAUTH_SIGN_OUT_MESSAGE, "knoxchat/oauth/signOut");
    assert.strictEqual(KNOX_OAUTH_UPDATE_MESSAGE, "knoxchat/oauth/update");
    assert.strictEqual(KNOX_OAUTH_SECRET_KEYS.apiKey, "knoxchat_oauth_api_key");
    assert.strictEqual(
      KNOX_OAUTH_SECRET_KEYS.refreshToken,
      "knoxchat_oauth_refresh",
    );
    assert.strictEqual(KNOX_OAUTH_SECRET_KEYS.account, "knoxchat.oauth.account");
  });

  test("persist writes the minted key to secrets and account to globalState", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistKnoxOAuthSession(
      secrets,
      accounts,
      ACCOUNT,
      "sk-oauth",
      "rt-oauth",
    );
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), "sk-oauth");
    assert.strictEqual(
      await secrets.get(storage.REFRESH_TOKEN_ITEM),
      "rt-oauth",
    );
    assert.deepStrictEqual(accounts.get(storage.ACCOUNT_STATE_KEY), ACCOUNT);
    assert.ok(!JSON.stringify([...secrets.map.values()]).includes("client_secret"));
  });

  test("restore round-trips after a simulated reload", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistKnoxOAuthSession(secrets, accounts, ACCOUNT, "sk-oauth", "rt");
    const restored = await restoreKnoxOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(restored, {
      kind: "session",
      account: ACCOUNT,
      apiKey: "sk-oauth",
    });
  });

  test("partial persist is cleared instead of restoring a half session", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await secrets.store(storage.API_KEY_ITEM, "sk-orphan");
    const restored = await restoreKnoxOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(restored, { kind: "empty" });
    assert.strictEqual(await secrets.get(storage.API_KEY_ITEM), undefined);
  });

  test("clear drops secrets and account metadata", async () => {
    const secrets = memorySecrets();
    const accounts = memoryAccounts();
    await persistKnoxOAuthSession(secrets, accounts, ACCOUNT, "sk-oauth", "rt");
    await clearKnoxOAuthPersisted(secrets, accounts);
    assert.deepStrictEqual(await restoreKnoxOAuthPersisted(secrets, accounts), {
      kind: "empty",
    });
    assert.strictEqual(accounts.get(storage.ACCOUNT_STATE_KEY), undefined);
    assert.strictEqual(await secrets.get(storage.REFRESH_TOKEN_ITEM), undefined);
  });
});
