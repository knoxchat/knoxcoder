import { describe, expect, it, vi } from "vitest";

import {
  assertFetchableUrl,
  fetchUrlContent,
  isBlockedAddress,
} from "./fetchUrl";

const publicResolver = async () => ["93.184.216.34"];

function resp(
  body: string,
  init: { status?: number; type?: string; headers?: Record<string, string> } = {},
) {
  const status = init.status ?? 200;
  const headers = new Map<string, string>(
    Object.entries({
      "content-type": init.type ?? "text/html; charset=utf-8",
      ...(init.headers ?? {}),
    }),
  );
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true } : ((sent = true), { done: false, value: bytes }),
        cancel: async () => undefined,
      }),
    },
  };
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"])(
    "allows %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("assertFetchableUrl", () => {
  it("rejects bad schemes, credentials and local hosts", async () => {
    await expect(assertFetchableUrl("file:///etc/passwd", publicResolver, false)).rejects.toThrow(/http/);
    await expect(assertFetchableUrl("https://u:p@example.com", publicResolver, false)).rejects.toThrow(/credentials/);
    await expect(assertFetchableUrl("http://localhost:3000", publicResolver, false)).rejects.toThrow(/Blocked/);
    await expect(assertFetchableUrl("http://169.254.169.254/latest", publicResolver, false)).rejects.toThrow(/Blocked/);
    await expect(assertFetchableUrl("http://[::1]/", publicResolver, false)).rejects.toThrow(/Blocked/);
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    await expect(
      assertFetchableUrl("http://evil.example", async () => ["10.0.0.5"], false),
    ).rejects.toThrow(/private/);
  });

  it("allows private hosts only when explicitly enabled", async () => {
    await expect(assertFetchableUrl("http://localhost:3000", publicResolver, true)).resolves.toBeInstanceOf(URL);
  });
});

describe("fetchUrlContent", () => {
  const base = { resolve: publicResolver, allowPrivate: false };

  it("converts HTML to Markdown", async () => {
    const html =
      "<html><head><title>Hello Doc</title></head><body><article><h1>Hello Doc</h1><p>This is <b>bold</b> text that is long enough for readability to keep it around as content.</p><p>Second paragraph with more words so the article scoring works properly here.</p></article></body></html>";
    const fetch = vi.fn().mockResolvedValue(resp(html));
    const [item] = await fetchUrlContent("https://example.com/doc", { ...base, fetch });
    expect(item.content).toContain("**bold**");
    expect(item.description).toBe("https://example.com/doc");
  });

  it("returns JSON as-is", async () => {
    const fetch = vi.fn().mockResolvedValue(resp('{"a":1}', { type: "application/json" }));
    const [item] = await fetchUrlContent("https://example.com/a.json", { ...base, fetch });
    expect(item.content).toBe('{"a":1}');
  });

  it("follows redirects and re-validates each hop", async () => {
    const ok = vi
      .fn()
      .mockResolvedValueOnce(resp("", { status: 302, headers: { location: "/next" } }))
      .mockResolvedValueOnce(resp("done", { type: "text/plain" }));
    const [item] = await fetchUrlContent("https://example.com/a", { ...base, fetch: ok });
    expect(item.content).toBe("done");
    expect(ok).toHaveBeenCalledTimes(2);

    const bad = vi
      .fn()
      .mockResolvedValue(resp("", { status: 301, headers: { location: "http://169.254.169.254/" } }));
    await expect(fetchUrlContent("https://example.com/a", { ...base, fetch: bad })).rejects.toThrow(/Blocked/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("stops redirect loops", async () => {
    const fetch = vi.fn().mockImplementation(async () => resp("", { status: 302, headers: { location: "/loop" } }));
    await expect(fetchUrlContent("https://example.com/", { ...base, fetch })).rejects.toThrow(/Too many redirects/);
  });

  it("truncates oversized pages", async () => {
    const fetch = vi.fn().mockResolvedValue(resp("x".repeat(5000), { type: "text/plain" }));
    const [item] = await fetchUrlContent("https://example.com/big", { ...base, fetch, maxBytes: 1000 });
    expect(item.content).toContain("Output truncated");
    expect(item.content.length).toBeLessThan(1200);
  });

  it("rejects binary content and HTTP errors", async () => {
    await expect(
      fetchUrlContent("https://example.com/i.png", { ...base, fetch: vi.fn().mockResolvedValue(resp("x", { type: "image/png" })) }),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      fetchUrlContent("https://example.com/x", { ...base, fetch: vi.fn().mockResolvedValue(resp("no", { status: 404 })) }),
    ).rejects.toThrow(/404/);
  });

  it("never fetches a blocked host", async () => {
    const fetch = vi.fn();
    await expect(fetchUrlContent("http://127.0.0.1:8080", { ...base, fetch })).rejects.toThrow(/Blocked/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("times out", async () => {
    const fetch = vi.fn().mockImplementation(
      (_u: string, init: any) =>
        new Promise((_r, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    await expect(
      fetchUrlContent("https://example.com/slow", { ...base, fetch, timeoutMs: 20 }),
    ).rejects.toThrow(/Timed out/);
  });
});
