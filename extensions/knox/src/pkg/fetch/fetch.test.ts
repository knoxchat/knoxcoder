import { describe, expect, it } from "vitest";

import { flattenRequestHeaders } from "./fetch";
import {
  applyOpenRouterAttributionHeaders,
  isOpenRouterApiUrl,
  openRouterAttributionHeaders,
  OPENROUTER_APP_NAME,
  OPENROUTER_APP_URL,
} from "./openrouterAttribution";

describe("flattenRequestHeaders", () => {
  it("keeps Authorization from a Headers instance the OpenAI SDK uses", () => {
    const headers = new Headers({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
    });
    expect(flattenRequestHeaders(headers)).toMatchObject({
      authorization: "Bearer sk-or-test",
      "content-type": "application/json",
    });
  });

  it("does not drop headers when Object.entries would be empty", () => {
    const headers = new Headers({ Authorization: "Bearer sk-or-test" });
    expect(Object.entries(headers)).toEqual([]);
    expect(flattenRequestHeaders(headers).authorization).toBe(
      "Bearer sk-or-test",
    );
  });

  it("reads tuple and plain-object headers", () => {
    expect(
      flattenRequestHeaders([["Authorization", "Bearer a"]]),
    ).toEqual({ Authorization: "Bearer a" });
    expect(flattenRequestHeaders({ Authorization: "Bearer b" })).toEqual({
      Authorization: "Bearer b",
    });
  });
});

describe("OpenRouter attribution headers", () => {
  const chatUrl = "https://openrouter.ai/api/v1/chat/completions";

  it("matches the OpenRouter API example names", () => {
    expect(openRouterAttributionHeaders()).toEqual({
      "HTTP-Referer": OPENROUTER_APP_URL,
      "X-OpenRouter-Title": OPENROUTER_APP_NAME,
      "X-Title": OPENROUTER_APP_NAME,
    });
    expect(openRouterAttributionHeaders()["Referer"]).toBeUndefined();
  });

  it("detects OpenRouter API hosts", () => {
    expect(isOpenRouterApiUrl(chatUrl)).toBe(true);
    expect(isOpenRouterApiUrl("https://openrouter.ai/api/v1/models")).toBe(
      true,
    );
    expect(isOpenRouterApiUrl("https://api.knoxstudio.ai/v1/chat/completions")).toBe(
      false,
    );
  });

  it("canonicalizes SDK lowercase headers on every request including follow-ups", () => {
    const sdkHeaders = flattenRequestHeaders(
      new Headers({
        Authorization: "Bearer sk-or-test",
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_APP_URL,
        "X-OpenRouter-Title": OPENROUTER_APP_NAME,
        "X-Title": OPENROUTER_APP_NAME,
      }),
    );
    expect(sdkHeaders["http-referer"]).toBe(OPENROUTER_APP_URL);
    expect(sdkHeaders["HTTP-Referer"]).toBeUndefined();

    const first = applyOpenRouterAttributionHeaders(chatUrl, sdkHeaders);
    const second = applyOpenRouterAttributionHeaders(chatUrl, {
      ...sdkHeaders,
      authorization: "Bearer sk-or-test",
    });
    for (const headers of [first, second]) {
      expect(headers["HTTP-Referer"]).toBe(OPENROUTER_APP_URL);
      expect(headers["X-OpenRouter-Title"]).toBe(OPENROUTER_APP_NAME);
      expect(headers["X-Title"]).toBe(OPENROUTER_APP_NAME);
      expect(headers["http-referer"]).toBeUndefined();
      expect(headers["x-openrouter-title"]).toBeUndefined();
      expect(headers["Referer"]).toBeUndefined();
      expect(headers["referer"]).toBeUndefined();
      expect(headers.authorization).toBe("Bearer sk-or-test");
    }
  });

  it("does not inject OpenRouter headers onto other hosts", () => {
    const headers = applyOpenRouterAttributionHeaders(
      "https://api.openai.com/v1/chat/completions",
      { Authorization: "Bearer sk" },
    );
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-OpenRouter-Title"]).toBeUndefined();
  });
});


describe("flattenRequestHeaders", () => {
  it("keeps Authorization from a Headers instance the OpenAI SDK uses", () => {
    const headers = new Headers({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
    });
    expect(flattenRequestHeaders(headers)).toMatchObject({
      authorization: "Bearer sk-or-test",
      "content-type": "application/json",
    });
  });

  it("does not drop headers when Object.entries would be empty", () => {
    const headers = new Headers({ Authorization: "Bearer sk-or-test" });
    expect(Object.entries(headers)).toEqual([]);
    expect(flattenRequestHeaders(headers).authorization).toBe(
      "Bearer sk-or-test",
    );
  });

  it("reads tuple and plain-object headers", () => {
    expect(
      flattenRequestHeaders([["Authorization", "Bearer a"]]),
    ).toEqual({ Authorization: "Bearer a" });
    expect(flattenRequestHeaders({ Authorization: "Bearer b" })).toEqual({
      Authorization: "Bearer b",
    });
  });
});
