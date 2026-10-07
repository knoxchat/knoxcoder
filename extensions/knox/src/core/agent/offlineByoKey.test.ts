/**
 * P1-6 offline / BYO-key-only: Knox must work with no Jev key, no Knox login and no
 * Knox network. A local OpenAI-compatible server stands in for Ollama / LM Studio;
 * every outbound connection that is not to it fails the test.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatMessage, Tool } from "..";
import { llmFromProviderAndOptions } from "../llm/llms/index";
import { BuiltInToolNames } from "../tools/builtIn";
import { runAgentLoop } from "./loop";

let server: http.Server;
let port = 0;
const hits: string[] = [];

function sse(res: http.ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? ""}`);
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      const hasToolResult = (parsed.messages ?? []).some((m: any) => m.role === "tool");
      const base = { id: "x", object: "chat.completion.chunk", created: 0, model: "local" };
      if (!hasToolResult && (parsed.tools ?? []).length > 0) {
        sse(res, [
          {
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: {
                        name: BuiltInToolNames.ReadFile,
                        arguments: JSON.stringify({ filepath: "a.ts" }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ]);
      } else {
        sse(res, [
          { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "all good" }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("offline / BYO key only (P1-6)", () => {
  it("runs a full tool turn against a local server with no Jev and no Knox login", async () => {
    const savedEnv = { ...process.env };
    delete process.env.KNOX_API_KEY;
    delete process.env.KNOXCHAT_API_KEY;
    delete process.env.KNOX_JEV_API_KEY;

    const outbound: string[] = [];
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? input);
      outbound.push(url);
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
        throw new Error(`blocked outbound fetch: ${url}`);
      }
      return realFetch(input, init);
    });
    const realConnect = net.Socket.prototype.connect;
    const sockets: string[] = [];
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args: any[]) {
      const opt = args[0];
      const host = typeof opt === "object" && opt ? `${opt.host ?? "localhost"}` : "";
      sockets.push(host);
      if (host && host !== "127.0.0.1" && host !== "localhost") {
        throw new Error(`blocked outbound socket: ${host}`);
      }
      return (realConnect as any).apply(this, args);
    });

    try {
      const llm = llmFromProviderAndOptions("openai", {
        model: "llama3",
        apiKey: "ollama",
        apiBase: `http://127.0.0.1:${port}/v1/`,
      });
      const tool = {
        type: "function",
        function: {
          name: BuiltInToolNames.ReadFile,
          description: "read",
          parameters: { type: "object", properties: { filepath: { type: "string" } } },
        },
        readonly: true,
      } as unknown as Tool;
      const messages: ChatMessage[] = [{ role: "user", content: "read a.ts" }];
      const executed: string[] = [];
      const result = await runAgentLoop({
        extras: { llm } as any,
        messages,
        tools: [tool],
        executeTool: async (call: any) => {
          executed.push(call?.function?.name ?? call?.name ?? "?");
          return [{ name: "a.ts", description: "ok", content: "export const a = 1;" }];
        },
      } as any);

      expect(result.stoppedReason).toBe("completed");
      expect(executed.length).toBe(1);
      expect(hits.length).toBeGreaterThanOrEqual(2);
      expect(hits.every((h) => h.includes("auth=Bearer ollama"))).toBe(true);
      expect(outbound.filter((u) => !/127\.0\.0\.1|localhost/.test(u))).toEqual([]);
      expect(sockets.filter((h) => h && h !== "127.0.0.1" && h !== "localhost")).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      vi.restoreAllMocks();
      process.env = savedEnv;
    }
  });
});
