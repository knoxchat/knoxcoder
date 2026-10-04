/**
 * CLI credential store (K-029). The headless CLI has no VS Code SecretStorage,
 * so the OAuth-minted session lives in `~/.knoxcoder/auth.json` (mode 0600).
 * There is no API-key env var or flag: the only way in is `knox login`
 * (the same KnoxChat OAuth + PKCE flow the editor uses).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeFileAtomic } from "../util/atomicWrite";
import type { KnoxOAuthAccount } from "../protocol/knoxOAuth";

export interface StoredSession {
  apiKey: string;
  refreshToken?: string;
  account: KnoxOAuthAccount;
}

export function defaultCredentialsPath(): string {
  return path.join(os.homedir(), ".knoxcoder", "auth.json");
}

/** A credentials file readable by group/others (copied, restored from backup) is tightened to 0600. */
function healPermissions(file: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    if ((fs.statSync(file).mode & 0o077) !== 0) {
      fs.chmodSync(file, 0o600);
    }
  } catch {
    // missing file: nothing to heal
  }
}

export function loadSession(file = defaultCredentialsPath()): StoredSession | undefined {
  try {
    healPermissions(file);
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
  writeFileAtomic(file, JSON.stringify(session), 0o600);
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o600);
  }
}

export function clearSession(file = defaultCredentialsPath()): void {
  fs.rmSync(file, { force: true });
}
