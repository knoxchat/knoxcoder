/**
 * CLI credential store (K-029). The headless CLI has no VS Code SecretStorage,
 * so the OAuth-minted session lives in `~/.knoxcoder/auth.json` (mode 0600).
 * There is no API-key env var or flag: the only way in is `knox login`
 * (the same KnoxChat OAuth + PKCE flow the editor uses).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { KnoxOAuthAccount } from "../protocol/knoxOAuth";

export interface StoredSession {
  apiKey: string;
  refreshToken?: string;
  account: KnoxOAuthAccount;
}

export function defaultCredentialsPath(): string {
  return path.join(os.homedir(), ".knoxcoder", "auth.json");
}

export function loadSession(file = defaultCredentialsPath()): StoredSession | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<StoredSession>;
    if (typeof parsed.apiKey === "string" && parsed.apiKey.trim() && parsed.account) {
      return parsed as StoredSession;
    }
  } catch {
    // missing or corrupt: treated as signed out
  }
  return undefined;
}

export function saveSession(
  session: StoredSession,
  file = defaultCredentialsPath(),
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function clearSession(file = defaultCredentialsPath()): void {
  fs.rmSync(file, { force: true });
}
