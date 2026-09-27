import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONTEXT_PROVIDER_TITLES,
  INTEGRATION_CONTEXT_PROVIDER_TITLES,
  Providers,
  contextProviderClassFromName,
  createDefaultContextProviders,
  getContextProviderCategory,
  integrationProviderReady,
  mergeContextProvidersWithDefaults,
} from "./defaultProviders";
import DiffContextProvider from "./DiffContextProvider";
import GoogleContextProvider from "./GoogleContextProvider";

describe("default context providers", () => {
  it("exposes the documented default set", () => {
    expect([...DEFAULT_CONTEXT_PROVIDER_TITLES]).toEqual([
      "file",
      "diff",
      "problems",
      "repo-map",
      "terminal",
      "memory",
    ]);

    const created = createDefaultContextProviders().map(
      (p) => p.description.title,
    );
    expect(created).toEqual([...DEFAULT_CONTEXT_PROVIDER_TITLES]);
  });

  it("quarantines key-gated providers as integrations", () => {
    for (const title of [
      "google",
      "discord",
      "greptile",
      "postgres",
      "database",
      "issue",
      "http",
      "web",
      "debugger",
    ]) {
      expect(INTEGRATION_CONTEXT_PROVIDER_TITLES.has(title)).toBe(true);
      expect(getContextProviderCategory(title)).toBe("integration");
    }
    expect(getContextProviderCategory("file")).toBe("core");
    expect(getContextProviderCategory("repo-map")).toBe("core");
  });

  it("requires keys for gated integrations", () => {
    expect(integrationProviderReady("google", {})).toEqual({
      ok: false,
      reason: "requires serperApiKey",
    });
    expect(
      integrationProviderReady("google", { serperApiKey: "x" }),
    ).toEqual({ ok: true });
    expect(integrationProviderReady("http", {})).toMatchObject({ ok: false });
    expect(integrationProviderReady("web", {})).toEqual({ ok: true });
  });

  it("merges defaults without duplicating titles", () => {
    const customDiff = new DiffContextProvider({ note: "custom" });
    const merged = mergeContextProvidersWithDefaults([customDiff]);
    const titles = merged.map((p) => p.description.title);
    expect(titles.filter((t) => t === "diff")).toHaveLength(1);
    expect(titles).toEqual(
      expect.arrayContaining([...DEFAULT_CONTEXT_PROVIDER_TITLES]),
    );
    expect(merged.find((p) => p.description.title === "diff")).toBe(customDiff);
  });

  it("registers integration classes but not dead outline/highlights", () => {
    expect(contextProviderClassFromName("google")).toBe(GoogleContextProvider);
    expect(contextProviderClassFromName("outline")).toBeUndefined();
    expect(contextProviderClassFromName("highlights")).toBeUndefined();
    expect(contextProviderClassFromName("serial")).toBeDefined();
    expect(contextProviderClassFromName("debugger")).toBeDefined();
    expect(
      Providers.some((cls) => cls.description.title === "outline"),
    ).toBe(false);
  });
});
