/**
 * K-022: `builtin_fetch_url`.
 *
 * Fetches a public http(s) page and returns readable Markdown. Guards:
 *  - http/https only, no credentials in the URL
 *  - localhost, link-local, private, CGNAT and reserved ranges are blocked
 *    (literal IPs and every address a hostname resolves to)
 *  - redirects are followed manually (max 5) and each hop is re-validated
 *  - hard time limit and byte cap (the body is read as a stream when possible)
 *
 * Known limit: DNS is checked before the request, so a hostile resolver could
 * still rebind between the check and the connection. Hosts that must be
 * reachable can be allowed with `KNOX_FETCH_URL_ALLOW_PRIVATE=1`.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { ContextItem } from "../..";

import { ToolImpl } from ".";

export const FETCH_URL_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_URL_MAX_OUTPUT_CHARS = 60_000;
export const FETCH_URL_TIMEOUT_MS = 15_000;
export const FETCH_URL_MAX_REDIRECTS = 5;

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)
    ? parts
    : null;
}

/** True when the literal IP is loopback, private, link-local or otherwise not public. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) {
    ip = ip.slice(1, -1);
  }
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) {
    ip = mapped[1];
  }
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ipv4ToParts(ip);
    if (!p) {
      return true;
    }
    const [a, b] = p;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (kind === 6) {
    return (
      ip === "::" ||
      ip === "::1" ||
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb") ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      ip.startsWith("ff") ||
      ip.startsWith("64:ff9b:")
    );
  }
  return false;
}

export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

/** Throws if the URL may not be fetched. Returns the parsed URL. */
export async function assertFetchableUrl(
  raw: string,
  resolve: HostResolver = defaultResolver,
  allowPrivate = process.env.KNOX_FETCH_URL_ALLOW_PRIVATE === "1",
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https URLs can be fetched (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  if (allowPrivate) {
    return url;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Blocked host: ${host}`);
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`Blocked address: ${host}`);
    }
    return url;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error(`Blocked host (resolves to a private address): ${host}`);
  }
  return url;
}

async function readBodyCapped(
  resp: any,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(resp.headers?.get?.("content-length") ?? 0);
  const reader = resp.body?.getReader?.();
  if (!reader) {
    if (declared > maxBytes) {
      throw new Error(`Response too large (${declared} bytes, limit ${maxBytes})`);
    }
    const text: string = await resp.text();
    return text.length > maxBytes
      ? { text: text.slice(0, maxBytes), truncated: true }
      : { text, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      const keep = value.byteLength - (total - maxBytes);
      if (keep > 0) {
        chunks.push(value.subarray(0, keep));
      }
      truncated = true;
      await reader.cancel?.().catch?.(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return {
    text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"),
    truncated,
  };
}

async function htmlToMarkdown(
  html: string,
  url: URL,
): Promise<{ title: string; markdown: string }> {
  const [{ JSDOM }, { Readability }, { NodeHtmlMarkdown }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
    import("node-html-markdown"),
  ]);
  const dom = new JSDOM(html, { url: url.toString() });
  const article = new Readability(dom.window.document).parse();
  const body = article?.content || dom.window.document.body?.innerHTML || "";
  return {
    title: article?.title || url.hostname,
    markdown: NodeHtmlMarkdown.translate(body),
  };
}

export interface FetchUrlOptions {
  fetch: (url: any, init?: any) => Promise<any>;
  resolve?: HostResolver;
  allowPrivate?: boolean;
  maxBytes?: number;
  maxChars?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function fetchUrlContent(
  rawUrl: string,
  opts: FetchUrlOptions,
): Promise<ContextItem[]> {
  const maxBytes = opts.maxBytes ?? FETCH_URL_MAX_BYTES;
  const maxChars = opts.maxChars ?? FETCH_URL_MAX_OUTPUT_CHARS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? FETCH_URL_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    let url = await assertFetchableUrl(rawUrl, opts.resolve, opts.allowPrivate);
    let resp: any;
    for (let hop = 0; ; hop++) {
      resp = await opts.fetch(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "KnoxCoder/1.0 (+fetch_url)",
          Accept: "text/html,application/xhtml+xml,application/json,text/*;q=0.9,*/*;q=0.5",
        },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers?.get?.("location");
        if (!location) {
          throw new Error(`Redirect (${resp.status}) without a Location header`);
        }
        if (hop >= FETCH_URL_MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max ${FETCH_URL_MAX_REDIRECTS})`);
        }
        url = await assertFetchableUrl(
          new URL(location, url).toString(),
          opts.resolve,
          opts.allowPrivate,
        );
        continue;
      }
      break;
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText ?? ""}`.trim());
    }
    const contentType = String(resp.headers?.get?.("content-type") ?? "").toLowerCase();
    const isHtml = /html|xml/.test(contentType) || contentType === "";
    const isText = isHtml || /json|text|javascript|yaml|csv/.test(contentType);
    if (!isText) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const { text, truncated } = await readBodyCapped(resp, maxBytes);

    let title = url.hostname;
    let content = text;
    if (isHtml) {
      const converted = await htmlToMarkdown(text, url);
      title = converted.title;
      content = converted.markdown;
    }
    let clipped = truncated;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      clipped = true;
    }
    if (clipped) {
      content += "\n\n[Output truncated: page exceeded the size limit.]";
    }
    return [
      {
        name: title,
        description: url.toString(),
        content,
        uri: { type: "url", value: url.toString() },
      },
    ];
  } catch (e) {
    if (controller.signal.aborted && !opts.signal?.aborted) {
      throw new Error(`Timed out fetching ${rawUrl}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export const fetchUrlImpl: ToolImpl = async (args, extras) => {
  const url = String(args?.url ?? "").trim();
  if (!url) {
    throw new Error("url is required");
  }
  return fetchUrlContent(url, {
    fetch: extras.fetch as any,
    signal: extras.abortSignal,
  });
};
