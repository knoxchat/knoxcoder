/**
 * In-memory KnoxChat OAuth session. The minted `sk-` key lives here so LLM
 * construction can inherit it without writing secrets into config.yaml.
 */

import type { KnoxOAuthAccount } from "../../protocol/knoxOAuth";
import { resolveOpenRouterApiKey } from "../openrouterOAuth/session";

let sharedApiKey: string | undefined;
let sharedAccount: KnoxOAuthAccount | undefined;

export function setKnoxChatOAuthApiKey(key: string | undefined): void {
  const trimmed = key?.trim();
  sharedApiKey = trimmed ? trimmed : undefined;
}

export function getKnoxChatOAuthApiKey(): string | undefined {
  return sharedApiKey;
}

export function setKnoxChatOAuthAccount(
  account: KnoxOAuthAccount | undefined,
): void {
  sharedAccount = account;
}

export function getKnoxChatOAuthAccount(): KnoxOAuthAccount | undefined {
  return sharedAccount;
}

export function clearKnoxChatOAuthSession(): void {
  sharedApiKey = undefined;
  sharedAccount = undefined;
}

/** Prefer an explicit model key; otherwise the signed-in KnoxChat session key. */
export function resolveKnoxChatApiKey(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  return getKnoxChatOAuthApiKey();
}

/** Inject the matching OAuth session key for knoxchat / openrouter. */
export function resolveProviderApiKey(
  provider: string | undefined,
  explicit?: string,
): string | undefined {
  if (provider === "knoxchat") {
    return resolveKnoxChatApiKey(explicit);
  }
  if (provider === "openrouter") {
    return resolveOpenRouterApiKey(explicit);
  }
  const trimmed = explicit?.trim();
  return trimmed ? trimmed : undefined;
}
