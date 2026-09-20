import type { ResolvedAgentProfile } from "../config/agentProfile";
import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
} from "./questions";
import type { JevRuntime, JevYamlConfig } from "./types";

function clampTimeout(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(10_000, Math.max(50, Math.floor(raw)));
  }
  return JEV_DEFAULT_TIMEOUT_MS;
}

/** Map `config.yaml` `jev:` onto a runtime record. Default: disabled. */
export function resolveJevRuntime(yaml?: JevYamlConfig | null): JevRuntime {
  const apiKey = yaml?.apiKey?.trim() ?? "";
  const baseUrl = yaml?.baseUrl?.trim() || JEV_DEFAULT_BASE_URL;
  const model = yaml?.model?.trim() || JEV_DEFAULT_MODEL;
  return {
    enabled: yaml?.enabled === true,
    model,
    timeoutMs: clampTimeout(yaml?.timeoutMs),
    failOpen: yaml?.failOpen !== false,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

export function jevCanCallNetwork(runtime: JevRuntime): boolean {
  return runtime.enabled && runtime.apiKey.length > 0;
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
  return activeRuntime ?? resolveJevRuntime();
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
