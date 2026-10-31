import type { ResolvedAgentProfile } from "../config/agentProfile";
import { resolveKnoxChatApiKey } from "../auth/knoxOAuth/session";
import { resolveOpenRouterApiKey } from "../auth/openrouterOAuth/session";
import { isOpenRouterApiUrl } from "../../pkg/fetch/openrouterAttribution";
import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
  OPENROUTER_JEV_BASE_URL,
  OPENROUTER_JEV_MODEL,
} from "./questions";
import type { JevProvider, JevRuntime, JevYamlConfig } from "./types";

export interface JevKeySource {
  providerName?: string;
  provider?: string;
  apiKey?: string;
  apiBase?: string;
}

export interface JevFallback {
  apiKey: string;
  provider?: JevProvider;
}

function clampTimeout(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(30_000, Math.max(50, Math.floor(raw)));
  }
  return JEV_DEFAULT_TIMEOUT_MS;
}

export function looksLikeOpenRouterApiKey(key: string | undefined): boolean {
  return (key ?? "").trim().toLowerCase().startsWith("sk-or-");
}

function isKnoxStudioApiUrl(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    return (
      hostname === "api.knoxstudio.ai" ||
      hostname === "knoxstudio.ai" ||
      hostname.endsWith(".knoxstudio.ai")
    );
  } catch {
    return false;
  }
}

/**
 * Origin for `POST {base}/v1/systemone`.
 * KnoxChat `apiBase` is `https://api.knoxstudio.ai/v1/` — strip `/v1` so we do not
 * request `/v1/v1/systemone`. OpenRouter System One lives at
 * `https://openrouter.ai/api/v1/systemone`, so keep `/api`.
 */
export function normalizeJevBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return JEV_DEFAULT_BASE_URL;
  }
  if (isOpenRouterApiUrl(trimmed) || isOpenRouterApiUrl(`${trimmed}/`)) {
    return OPENROUTER_JEV_BASE_URL;
  }
  return trimmed.replace(/\/(?:api\/)?v1$/i, "");
}

export function isOpenRouterJevOrigin(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return false;
  }
  const normalized = normalizeJevBaseUrl(raw);
  return normalized === OPENROUTER_JEV_BASE_URL || isOpenRouterApiUrl(normalized);
}

export function jevOriginForProvider(provider: JevProvider): string {
  return provider === "openrouter"
    ? OPENROUTER_JEV_BASE_URL
    : normalizeJevBaseUrl(JEV_DEFAULT_BASE_URL);
}

export function defaultJevModel(provider: JevProvider): string {
  return provider === "openrouter" ? OPENROUTER_JEV_MODEL : JEV_DEFAULT_MODEL;
}

/**
 * Map a configured model id onto the provider's catalog.
 * OpenRouter System One accepts bare `jev-*` ids and `typesafe/` prefixed ids.
 * @see https://openrouter.ai/docs/guides/community/typesafe-sdk
 */
export function mapJevModel(model: string, provider: JevProvider): string {
  const id = model.trim();
  if (!id) {
    return defaultJevModel(provider);
  }
  if (provider === "openrouter") {
    if (id.startsWith("typesafe/") || id.startsWith("~typesafe/")) {
      return id;
    }
    if (id === "jev-latest") {
      return "~typesafe/jev-latest";
    }
    if (/^jev-1\.14(\.|$)/.test(id)) {
      return OPENROUTER_JEV_MODEL;
    }
    if (/^jev-1\.13(\.|$)/.test(id)) {
      return "typesafe/jev-1.13";
    }
    if (id.startsWith("jev-")) {
      return OPENROUTER_JEV_MODEL;
    }
    return id;
  }
  if (id.startsWith("typesafe/")) {
    return id.slice("typesafe/".length) || JEV_DEFAULT_MODEL;
  }
  if (id.startsWith("~typesafe/")) {
    return id.slice("~typesafe/".length) || JEV_DEFAULT_MODEL;
  }
  return id;
}

/**
 * Only KnoxStudio and OpenRouter may serve Jev. `api.typesafe.ai` and other
 * hosts fall back to KnoxStudio so a leftover YAML `baseUrl` cannot leak keys.
 */
export function resolveJevRequestBaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) {
    return jevOriginForProvider("knoxchat");
  }
  const normalized = normalizeJevBaseUrl(raw);
  if (isOpenRouterJevOrigin(normalized)) {
    return OPENROUTER_JEV_BASE_URL;
  }
  if (isKnoxStudioApiUrl(normalized)) {
    return normalizeJevBaseUrl(JEV_DEFAULT_BASE_URL);
  }
  return jevOriginForProvider("knoxchat");
}

export function jevSystemOneUrl(baseUrl: string): string {
  return `${resolveJevRequestBaseUrl(baseUrl)}/v1/systemone`;
}

export function providerFromJevBaseUrl(
  raw: string | undefined,
): JevProvider | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const normalized = normalizeJevBaseUrl(raw);
  if (isOpenRouterJevOrigin(normalized)) {
    return "openrouter";
  }
  if (isKnoxStudioApiUrl(normalized)) {
    return "knoxchat";
  }
  return undefined;
}

function sourceProvider(model: JevKeySource): JevProvider | undefined {
  const provider = (model.providerName ?? model.provider ?? "").toLowerCase();
  if (provider === "openrouter") {
    return "openrouter";
  }
  if (provider === "knoxchat") {
    return "knoxchat";
  }
  if (model.apiBase && isOpenRouterApiUrl(model.apiBase)) {
    return "openrouter";
  }
  if (model.apiBase && isKnoxStudioApiUrl(model.apiBase)) {
    return "knoxchat";
  }
  return undefined;
}

function liveKeyFor(provider: JevProvider): string {
  return provider === "openrouter"
    ? (resolveOpenRouterApiKey() ?? "")
    : (resolveKnoxChatApiKey() ?? "");
}

function detectJevProvider(
  yaml?: Pick<JevYamlConfig, "apiKey" | "baseUrl"> | null,
  fallbackProvider?: JevProvider,
): JevProvider {
  if (looksLikeOpenRouterApiKey(yaml?.apiKey)) {
    return "openrouter";
  }
  // Selected chat provider beats a leftover yaml `baseUrl` (that field used
  // to be ignored). An `sk-or-` key above is the explicit OpenRouter override.
  if (fallbackProvider) {
    return fallbackProvider;
  }
  const fromBase = providerFromJevBaseUrl(yaml?.baseUrl);
  if (fromBase) {
    return fromBase;
  }
  if (resolveKnoxChatApiKey()) {
    return "knoxchat";
  }
  if (resolveOpenRouterApiKey()) {
    return "openrouter";
  }
  return "knoxchat";
}

/** Selected chat model first, then chat-role models, then the rest. */
export function knoxChatJevSourcesFromConfig(config: {
  modelsByRole?: { chat?: JevKeySource[] };
  models?: JevKeySource[];
  selectedModelByRole?: { chat?: JevKeySource | null };
}): JevKeySource[] {
  const selected = config.selectedModelByRole?.chat;
  return [
    ...(selected ? [selected] : []),
    ...(config.modelsByRole?.chat ?? []),
    ...(config.models ?? []),
  ];
}

/**
 * Pick the Jev backend from the selected chat model (knoxchat or openrouter),
 * then live OAuth sessions. Selected provider wins even when its key is still
 * empty so we do not silently bill Knox while the user is on OpenRouter.
 */
export function pickKnoxChatJevFallback(
  models: JevKeySource[] | undefined,
): JevFallback {
  let preferred: JevProvider | undefined;
  for (const model of models ?? []) {
    const provider = sourceProvider(model);
    if (!provider) {
      continue;
    }
    preferred ??= provider;
    if (provider !== preferred) {
      continue;
    }
    const apiKey = model.apiKey?.trim() || liveKeyFor(provider);
    if (apiKey) {
      return { apiKey, provider };
    }
  }
  if (preferred) {
    return { apiKey: liveKeyFor(preferred), provider: preferred };
  }
  const knox = liveKeyFor("knoxchat");
  if (knox) {
    return { apiKey: knox, provider: "knoxchat" };
  }
  const openrouter = liveKeyFor("openrouter");
  if (openrouter) {
    return { apiKey: openrouter, provider: "openrouter" };
  }
  return { apiKey: "", provider: "knoxchat" };
}

/**
 * Fill a missing `apiKey` from the selected knoxchat/openrouter model so Jev
 * uses the same key as chat. Host follows that provider.
 */
export function mergeJevConfigWithFallback(
  yaml: JevYamlConfig | undefined,
  fallback: JevFallback,
): JevYamlConfig | undefined {
  if (!yaml) {
    return undefined;
  }
  const explicitKey = yaml.apiKey?.trim() ?? "";
  const apiKey = explicitKey || fallback.apiKey || "";
  const provider = detectJevProvider(
    { ...yaml, ...(apiKey ? { apiKey } : {}) },
    fallback.provider,
  );
  return {
    ...yaml,
    ...(apiKey ? { apiKey } : {}),
    baseUrl: jevOriginForProvider(provider),
  };
}

/** Explicit `jev.apiKey`, else the matching KnoxChat or OpenRouter session key. */
export function resolveJevApiKey(
  yamlOrRuntime?: Pick<JevYamlConfig, "apiKey" | "baseUrl"> | null,
  fallbackProvider?: JevProvider,
): string {
  const trimmed = yamlOrRuntime?.apiKey?.trim();
  if (trimmed) {
    return trimmed;
  }
  return liveKeyFor(detectJevProvider(yamlOrRuntime, fallbackProvider));
}

/** Map `config.yaml` `jev:` onto a runtime record. Default: disabled. */
export function resolveJevRuntime(yaml?: JevYamlConfig | null): JevRuntime {
  const provider = detectJevProvider(yaml);
  const configured = yaml?.model?.trim();
  const model = mapJevModel(
    configured || defaultJevModel(provider),
    provider,
  );
  return {
    enabled: yaml?.enabled === true,
    model,
    timeoutMs: clampTimeout(yaml?.timeoutMs),
    failOpen: yaml?.failOpen !== false,
    apiKey: resolveJevApiKey(yaml, provider),
    baseUrl: jevOriginForProvider(provider),
    provider,
  };
}

export function jevCanCallNetwork(runtime: JevRuntime): boolean {
  return runtime.enabled && resolveJevApiKey(runtime).length > 0;
}

let activeYaml: JevYamlConfig | null | undefined;
let lastUserMessage = "";
let confirmedProfile: ResolvedAgentProfile | undefined;
const configListeners = new Set<(runtime: JevRuntime) => void>();

function emitJevConfig(runtime: JevRuntime): void {
  for (const listener of configListeners) {
    try {
      listener(runtime);
    } catch {
      // listeners must never break config load
    }
  }
}

/** Fires after each `applyJevConfig` (GUI toggle, YAML, vscode overlay). */
export function onJevConfig(listener: (runtime: JevRuntime) => void): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

/** Snapshot from the last loaded config.yaml `jev:` block. */
export function applyJevConfig(yaml?: JevYamlConfig | null): JevRuntime {
  activeYaml = yaml;
  const runtime = resolveJevRuntime(yaml);
  emitJevConfig(runtime);
  return runtime;
}

export function getActiveJevRuntime(): JevRuntime {
  return resolveJevRuntime(activeYaml);
}

export function setJevUserMessage(message: string): void {
  lastUserMessage = message.slice(0, 8_000);
}

export function getJevUserMessage(): string {
  return lastUserMessage;
}

/** Last `auto` profile Jev confirmed for this turn (undefined if unused). */
export function setJevConfirmedProfile(
  profile: ResolvedAgentProfile | undefined,
): void {
  confirmedProfile = profile;
}

export function getJevConfirmedProfile(): ResolvedAgentProfile | undefined {
  return confirmedProfile;
}
