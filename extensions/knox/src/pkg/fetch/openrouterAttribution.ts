/**
 * OpenRouter app attribution. Must go on every request to openrouter.ai
 * (chat, retries, tool follow-ups). Missing them shows App as Unknown.
 *
 * @see https://openrouter.ai/docs/api_reference/overview
 * @see https://openrouter.ai/docs/app-attribution
 */

export const OPENROUTER_APP_NAME = "KnoxCoder";

/** Public repo URL used as `HTTP-Referer` (OpenRouter's app id). */
export const OPENROUTER_APP_URL = "https://github.com/knoxchat/knoxcoder";

const OPENROUTER_HOST = "openrouter.ai";

/**
 * Documented names only. Do not send `Referer` — Fetch / node-fetch treat it
 * as a forbidden header, which is why OpenRouter asks for `HTTP-Referer`.
 */
export function openRouterAttributionHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": OPENROUTER_APP_URL,
    "X-OpenRouter-Title": OPENROUTER_APP_NAME,
    "X-Title": OPENROUTER_APP_NAME,
  };
}

export function isOpenRouterApiUrl(url: URL | string): boolean {
  try {
    const hostname = (typeof url === "string" ? new URL(url) : url).hostname;
    return hostname === OPENROUTER_HOST || hostname.endsWith(`.${OPENROUTER_HOST}`);
  } catch {
    return false;
  }
}

const ATTRIBUTION_HEADER_NAMES = new Set([
  "http-referer",
  "referer",
  "x-openrouter-title",
  "x-title",
]);

/**
 * Put the documented attribution headers on every OpenRouter request.
 * Drops lowercase / `Referer` variants the OpenAI SDK `Headers` object
 * produces so follow-up turns do not show App as Unknown.
 */
export function applyOpenRouterAttributionHeaders(
  url: URL | string,
  headers: Record<string, string>,
): Record<string, string> {
  if (!isOpenRouterApiUrl(url)) {
    return headers;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!ATTRIBUTION_HEADER_NAMES.has(key.toLowerCase())) {
      next[key] = value;
    }
  }
  return {
    ...next,
    ...openRouterAttributionHeaders(),
  };
}
