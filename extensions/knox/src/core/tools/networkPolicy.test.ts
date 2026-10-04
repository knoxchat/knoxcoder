import { afterEach, describe, expect, it } from "vitest";

import {
  fetchUrlDeniedMessage,
  isHostAllowed,
  resolveNetworkPolicy,
} from "./networkPolicy";

const savedMode = process.env.KNOX_NETWORK_MODE;
const savedList = process.env.KNOX_NETWORK_ALLOWLIST;

afterEach(() => {
  if (savedMode === undefined) {
    delete process.env.KNOX_NETWORK_MODE;
  } else {
    process.env.KNOX_NETWORK_MODE = savedMode;
  }
  if (savedList === undefined) {
    delete process.env.KNOX_NETWORK_ALLOWLIST;
  } else {
    process.env.KNOX_NETWORK_ALLOWLIST = savedList;
  }
});

describe("network policy", () => {
  it("allows every host in allow mode", () => {
    const policy = resolveNetworkPolicy({ mode: "allow" });
    expect(policy.mode).toBe("allow");
    expect(isHostAllowed("example.com", policy)).toBe(true);
  });

  it("denies every host in deny mode", () => {
    const policy = resolveNetworkPolicy({ mode: "deny" });
    expect(isHostAllowed("example.com", policy)).toBe(false);
    expect(fetchUrlDeniedMessage(policy, "example.com")).toMatch(/Network is off/);
  });

  it("allowlist matches exact hosts and *.suffix", () => {
    const policy = resolveNetworkPolicy({
      mode: "allowlist",
      allowlist: ["api.github.com", "*.knoxstudio.ai"],
    });
    expect(isHostAllowed("api.github.com", policy)).toBe(true);
    expect(isHostAllowed("foo.knoxstudio.ai", policy)).toBe(true);
    expect(isHostAllowed("knoxstudio.ai", policy)).toBe(true);
    expect(isHostAllowed("evil.com", policy)).toBe(false);
  });

  it("env overrides settings", () => {
    process.env.KNOX_NETWORK_MODE = "deny";
    expect(resolveNetworkPolicy({ mode: "allow" }).mode).toBe("deny");
    process.env.KNOX_NETWORK_MODE = "allowlist";
    process.env.KNOX_NETWORK_ALLOWLIST = "docs.example.com, api.test";
    const policy = resolveNetworkPolicy({ mode: "allow", allowlist: ["nope.com"] });
    expect(policy.allowlist).toEqual(["docs.example.com", "api.test"]);
    expect(isHostAllowed("docs.example.com", policy)).toBe(true);
    expect(isHostAllowed("nope.com", policy)).toBe(false);
  });
});
