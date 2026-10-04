/**
 * Shared network policy for `builtin_fetch_url` and the shell sandbox (P1-2).
 *
 * Modes:
 *   allow     — current behaviour (public hosts; private IPs still blocked)
 *   deny      — no network from fetch_url; sandbox gets --unshare-net / deny network*
 *   allowlist — fetch_url only to matching hostnames; sandbox still denies all
 *               (shell allowlists are not reliable without a userspace proxy)
 *
 * Env wins: `KNOX_NETWORK_MODE`, `KNOX_NETWORK_ALLOWLIST` (comma-separated hosts).
 */

export const NETWORK_MODES = ["allow", "deny", "allowlist"] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

export interface NetworkPolicy {
  mode: NetworkMode;
  allowlist: string[];
}

let settingMode: NetworkMode | undefined;
let settingAllowlist: string[] | undefined;

export function isNetworkMode(value: unknown): value is NetworkMode {
  return value === "allow" || value === "deny" || value === "allowlist";
}

function parseAllowlist(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((h): h is string => typeof h === "string")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export function applyNetworkSettings(raw: {
  mode?: unknown;
  allowlist?: unknown;
}): void {
  if (isNetworkMode(raw.mode)) {
    settingMode = raw.mode;
  }
  if (raw.allowlist !== undefined) {
    settingAllowlist = parseAllowlist(raw.allowlist);
  }
}

export function resolveNetworkPolicy(raw?: {
  mode?: unknown;
  allowlist?: unknown;
}): NetworkPolicy {
  const envMode = process.env.KNOX_NETWORK_MODE?.trim();
  const mode = isNetworkMode(envMode)
    ? envMode
    : isNetworkMode(raw?.mode)
      ? raw!.mode
      : settingMode ?? "allow";
  const envList = process.env.KNOX_NETWORK_ALLOWLIST;
  const allowlist =
    envList !== undefined
      ? parseAllowlist(envList)
      : raw?.allowlist !== undefined
        ? parseAllowlist(raw.allowlist)
        : settingAllowlist ?? [];
  return { mode, allowlist };
}

/** True when the hostname is allowed by the current policy. */
export function isHostAllowed(hostname: string, policy: NetworkPolicy): boolean {
  if (policy.mode === "allow") {
    return true;
  }
  if (policy.mode === "deny") {
    return false;
  }
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) {
    return false;
  }
  return policy.allowlist.some((pattern) => hostMatches(host, pattern));
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.replace(/^\*\./, ".");
  if (pattern.startsWith("*.")) {
    return host === pattern.slice(2) || host.endsWith(p);
  }
  return host === pattern;
}

export function denyNetworkInSandbox(policy: NetworkPolicy): boolean {
  return policy.mode === "deny" || policy.mode === "allowlist";
}

export function fetchUrlDeniedMessage(policy: NetworkPolicy, host: string): string {
  if (policy.mode === "deny") {
    return `Network is off (knoxchat.networkMode=deny). Blocked fetch of ${host}.`;
  }
  return `Host ${host} is not on knoxchat.networkAllowlist.`;
}
