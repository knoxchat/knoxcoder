/**
 * In-memory OpenRouter OAuth session. The exchanged API key lives here so LLM
 * construction can inherit it without writing secrets into config.yaml.
 *
 * `resolveProviderApiKey("openrouter")` composes `resolveOpenRouterApiKey`.
 */

import type { OpenRouterOAuthAccount } from "../../protocol/openrouterOAuth";

export type { OpenRouterOAuthAccount };

let sharedApiKey: string | undefined;
let sharedAccount: OpenRouterOAuthAccount | undefined;

export function setOpenRouterOAuthApiKey(key: string | undefined): void {
  const trimmed = key?.trim();
  sharedApiKey = trimmed ? trimmed : undefined;
}

export function getOpenRouterOAuthApiKey(): string | undefined {
  return sharedApiKey;
}

export function setOpenRouterOAuthAccount(
  account: OpenRouterOAuthAccount | undefined,
): void {
  sharedAccount = account;
}

export function getOpenRouterOAuthAccount(): OpenRouterOAuthAccount | undefined {
  return sharedAccount;
}

export function clearOpenRouterOAuthSession(): void {
  sharedApiKey = undefined;
  sharedAccount = undefined;
}

/** Prefer an explicit model key; otherwise the signed-in OpenRouter session key. */
export function resolveOpenRouterApiKey(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  return getOpenRouterOAuthApiKey();
}
