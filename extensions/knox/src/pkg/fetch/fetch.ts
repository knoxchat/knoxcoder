import { globalAgent } from "https";
import * as fs from "node:fs";
import tls from "node:tls";

import { RequestOptions } from "../openai-adapters/types.js";
import * as followRedirects from "follow-redirects";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, {
  type BodyInit as NodeFetchBodyInit,
  type RequestInit as NodeFetchRequestInit,
  Response,
} from "node-fetch";
import { applyOpenRouterAttributionHeaders } from "./openrouterAttribution.js";

const { http, https } = (followRedirects as any).default;

/**
 * The OpenAI SDK passes a `Headers` instance. `Object.entries(headers)` on
 * that is empty, which used to drop `Authorization` and produce OpenRouter
 * `401 No cookie auth credentials found`.
 */
export function flattenRequestHeaders(
  headers: RequestInit["headers"] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
        out[pair[0]] = pair[1];
      }
    }
    return out;
  }
  if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

export function fetchwithRequestOptions(
  url_: URL | string,
  init?: RequestInit,
  requestOptions?: RequestOptions,
): Promise<Response> {
  let url = url_;
  if (typeof url === "string") {
    url = new URL(url);
  }

  const TIMEOUT = 7200; // 7200 seconds = 2 hours

  let globalCerts: string[] = [];
  if (process.env.IS_BINARY) {
    if (Array.isArray(globalAgent.options.ca)) {
      globalCerts = [...globalAgent.options.ca.map((cert) => cert.toString())];
    } else if (typeof globalAgent.options.ca !== "undefined") {
      globalCerts.push(globalAgent.options.ca.toString());
    }
  }
  const ca = Array.from(new Set([...tls.rootCertificates, ...globalCerts]));
  const customCerts =
    typeof requestOptions?.caBundlePath === "string"
      ? [requestOptions?.caBundlePath]
      : requestOptions?.caBundlePath;
  if (customCerts) {
    ca.push(
      ...customCerts.map((customCert) => fs.readFileSync(customCert, "utf8")),
    );
  }

  const timeout = (requestOptions?.timeout ?? TIMEOUT) * 1000; // measured in ms

  const agentOptions: { [key: string]: any } = {
    ca,
    rejectUnauthorized: requestOptions?.verifySsl,
    timeout,
    sessionTimeout: timeout,
    keepAlive: true,
    keepAliveMsecs: timeout,
  };

  // Handle ClientCertificateOptions
  if (requestOptions?.clientCertificate) {
    agentOptions.cert = fs.readFileSync(
      requestOptions.clientCertificate.cert,
      "utf8",
    );
    agentOptions.key = fs.readFileSync(
      requestOptions.clientCertificate.key,
      "utf8",
    );
    if (requestOptions.clientCertificate.passphrase) {
      agentOptions.passphrase = requestOptions.clientCertificate.passphrase;
    }
  }

  const proxy = requestOptions?.proxy;

  // Create agent
  const protocol = url.protocol === "https:" ? https : http;
  const agent =
    proxy && !requestOptions?.noProxy?.includes(url.hostname)
      ? protocol === https
        ? new HttpsProxyAgent(proxy, agentOptions)
        : new HttpProxyAgent(proxy, agentOptions)
      : new protocol.Agent(agentOptions);

  let headers: { [key: string]: string } = flattenRequestHeaders(init?.headers);
  headers = {
    ...headers,
    ...requestOptions?.headers,
  };
  // OpenRouter titles App from HTTP-Referer / X-OpenRouter-Title on each
  // generation. The OpenAI SDK passes a Headers instance (lowercased names);
  // apply canonical documented names on every request, including follow-ups.
  headers = applyOpenRouterAttributionHeaders(url, headers);

  // Replace localhost with 127.0.0.1
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }

  // add extra body properties if provided
  let updatedBody: string | undefined = undefined;
  try {
    if (requestOptions?.extraBodyProperties && typeof init?.body === "string") {
      const parsedBody = JSON.parse(init.body);
      updatedBody = JSON.stringify({
        ...parsedBody,
        ...requestOptions.extraBodyProperties,
      });
    }
  } catch (e) {
    console.log("Unable to parse HTTP request body: ", e);
  }

  // fetch the request with the provided options
  const resp = fetch(url, {
    ...init,
    body: (updatedBody ?? init?.body) as NodeFetchBodyInit | undefined,
    headers: headers,
    agent: agent,
  } as NodeFetchRequestInit);

  return resp;
}
