/**
 * PKCE `S256` and CSRF `state`.
 *
 * The `code_verifier` never leaves the editor process and must not be logged.
 * `code_challenge` is `BASE64URL(SHA256(verifier))` without padding.
 */

import { createHash, randomBytes } from "node:crypto";

import { PKCE_METHOD } from "./constants";

/** RFC 7636 unreserved set for `code_verifier`: `[A-Z][a-z][0-9]-._~`. */
export const VERIFIER_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export const VERIFIER_MIN_LEN = 43;
export const VERIFIER_MAX_LEN = 128;

const VERIFIER_ENTROPY_LEN = 32;
const STATE_ENTROPY_LEN = 32;

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export type AuthorizationSecrets = {
  pkce: PkcePair;
  state: string;
};

export function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function s256Challenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function isValidVerifier(verifier: string): boolean {
  if (verifier.length < VERIFIER_MIN_LEN || verifier.length > VERIFIER_MAX_LEN) {
    return false;
  }
  for (const ch of verifier) {
    if (!VERIFIER_CHARSET.includes(ch)) {
      return false;
    }
  }
  return true;
}

export function pkceFromVerifier(verifier: string): PkcePair | undefined {
  if (!isValidVerifier(verifier)) {
    return undefined;
  }
  return {
    verifier,
    challenge: s256Challenge(verifier),
  };
}

export function generatePkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(VERIFIER_ENTROPY_LEN));
  const pair = pkceFromVerifier(verifier);
  if (!pair) {
    throw new Error("generated verifier always satisfies RFC 7636");
  }
  return pair;
}

export function generateCsrfState(): string {
  return base64Url(randomBytes(STATE_ENTROPY_LEN));
}

export function generateAuthorizationSecrets(): AuthorizationSecrets {
  return {
    pkce: generatePkcePair(),
    state: generateCsrfState(),
  };
}

export function pkceMethod(): string {
  return PKCE_METHOD;
}
