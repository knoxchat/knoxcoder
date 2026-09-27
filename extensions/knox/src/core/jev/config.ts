import type { ResolvedAgentProfile } from "../config/agentProfile";
import { resolveKnoxChatApiKey } from "../auth/knoxOAuth/session";
import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
} from "./questions";
import type { JevRuntime, JevYamlConfig } from "./types";

export interface JevKeySource {
  providerName?: string;
  provider?: string;
  apiKey?: string;
  apiBase?: string;
}

function clampTimeout(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(30_000, Math.max(50, Math.floor(raw)));
  }
  return JEV_DEFAULT_TIMEOUT_MS;
}

/**
 * Origin for `POST {base}/v1/systemone`.
 * KnoxChat `apiBase` is `https://api.knoxstudio.ai/v1/` — strip `/v1` so we do not
 * request `/v1/v1/systemone`.
 */
export function normalizeJevBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:api\/)?v1$/i, "");
}

function knoxChatOrigin(): string {
  return normalizeJevBaseUrl(JEV_DEFAULT_BASE_URL);
}

function isKnoxChatSource(model: JevKeySource): boolean {
  const provider = (model.providerName ?? model.provider ?? "").toLowerCase();
  return provider === "knoxchat";
}

/** First knoxchat model that already has an API key. Host is always api.knoxstudio.ai. */
export function pickKnoxChatJevFallback(
  models: JevKeySource[] | undefined,
): { apiKey: string } {
  for (const model of models ?? []) {
    if (!isKnoxChatSource(model)) {
      continue;
    }
    const apiKey = model.apiKey?.trim() ?? "";
    if (apiKey) {
      return { apiKey };
    }
  }
  return { apiKey: resolveKnoxChatApiKey() ?? "" };
}

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
 * Fill a missing `apiKey` from a knoxchat model so Jev uses the same Knox key
 * as chat. Host is always `https://api.knoxstudio.ai`.
 */
export function mergeJevConfigWithFallback(
  yaml: JevYamlConfig | undefined,
  fallback: { apiKey: string },
): JevYamlConfig | undefined {
  if (!yaml) {
    return undefined;
  }
  const explicitKey = yaml.apiKey?.trim() ?? "";
  const apiKey = explicitKey || fallback.apiKey || "";
  return {
    ...yaml,
    ...(apiKey ? { apiKey } : {}),
    baseUrl: knoxChatOrigin(),
  };
}

/** Explicit `jev.apiKey`, else the signed-in KnoxChat OAuth session key. */
export function resolveJevApiKey(
  yamlOrRuntime?: Pick<JevYamlConfig, "apiKey"> | null,
): string {
  return resolveKnoxChatApiKey(yamlOrRuntime?.apiKey) ?? "";
}

/** Map `config.yaml` `jev:` onto a runtime record. Default: disabled. */
export function resolveJevRuntime(yaml?: JevYamlConfig | null): JevRuntime {
  const model = yaml?.model?.trim() || JEV_DEFAULT_MODEL;
  return {
    enabled: yaml?.enabled === true,
    model,
    timeoutMs: clampTimeout(yaml?.timeoutMs),
    failOpen: yaml?.failOpen !== false,
    apiKey: resolveJevApiKey(yaml),
    baseUrl: knoxChatOrigin(),
  };
}

export function jevCanCallNetwork(runtime: JevRuntime): boolean {
  return runtime.enabled && resolveJevApiKey(runtime).length > 0;
}

let activeRuntime: JevRuntime | undefined;
let lastUserMessage = "";
let confirmedProfile: ResolvedAgentProfile | undefined;

/** Snapshot from the last loaded config.yaml `jev:` block. */
export function applyJevConfig(yaml?: JevYamlConfig | null): JevRuntime {
  activeRuntime = resolveJevRuntime(yaml);
  return activeRuntime;
}

export function getActiveJevRuntime(): JevRuntime {
  const base = activeRuntime ?? resolveJevRuntime();
  const apiKey = resolveJevApiKey(base);
  return apiKey === base.apiKey ? base : { ...base, apiKey };
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
