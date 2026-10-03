/**
 * Minimal OpenAI-compatible chat client for the live eval (K-010).
 *
 * Not the product LLM stack on purpose: the live eval must be reproducible
 * (temperature 0, one request per round, no routing) and has to run from a
 * plain vitest process. It speaks the `ILLM.streamChat` shape the loop needs
 * and tallies provider usage so the report can show tokens.
 */

import OpenAI from "openai";

import type { ChatMessage, PromptLog, Tool, ToolExtras } from "..";

export interface LiveLlmConfig {
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

export interface LiveLlm {
  llm: ToolExtras["llm"];
  usage: { promptTokens: number; completionTokens: number; requests: number };
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

export function toOpenAiMessages(
  messages: ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: textOf(m.content) });
    } else if (m.role === "user") {
      out.push({ role: "user", content: textOf(m.content) });
    } else if (m.role === "tool") {
      out.push({
        role: "tool",
        content: textOf(m.content),
        tool_call_id: m.toolCallId,
      });
    } else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).filter((c) => c.function?.name);
      out.push({
        role: "assistant",
        content: textOf(m.content) || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c, i) => ({
                id: c.id ?? `call_${i}`,
                type: "function" as const,
                function: {
                  name: c.function!.name!,
                  arguments: c.function!.arguments ?? "{}",
                },
              })),
            }
          : {}),
      });
    }
  }
  return out;
}

export function createLiveLlm(config: LiveLlmConfig): LiveLlm {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
  const usage = { promptTokens: 0, completionTokens: 0, requests: 0 };

  const llm = {
    model: config.model,
    title: config.model,
    streamChat: async function* (
      messages: ChatMessage[],
      signal: AbortSignal,
      options?: { tools?: Tool[] },
    ): AsyncGenerator<ChatMessage, PromptLog> {
      const tools = options?.tools?.length ? options.tools : undefined;
      const res = await client.chat.completions.create(
        {
          model: config.model,
          temperature: config.temperature ?? 0,
          messages: toOpenAiMessages(messages),
          ...(tools
            ? {
                tools: tools.map((t) => ({
                  type: "function" as const,
                  function: {
                    name: t.function.name,
                    description: t.function.description,
                    parameters: t.function.parameters as Record<
                      string,
                      unknown
                    >,
                  },
                })),
              }
            : {}),
        },
        { signal },
      );
      const choice = res.choices[0]?.message;
      const promptTokens = res.usage?.prompt_tokens ?? 0;
      const completionTokens = res.usage?.completion_tokens ?? 0;
      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
      usage.requests += 1;

      const toolCalls = (choice?.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c, index) => ({
          id: c.id,
          type: "function" as const,
          index,
          function: { name: c.function.name, arguments: c.function.arguments },
        }));
      yield {
        role: "assistant",
        content: choice?.content ?? "",
        ...(toolCalls.length && tools ? { toolCalls } : {}),
      };
      return {
        modelTitle: config.model,
        completionOptions: {},
        prompt: "",
        completion: choice?.content ?? "",
        usage: { promptTokens, completionTokens },
      } as PromptLog;
    },
  } as unknown as ToolExtras["llm"];

  return { llm, usage };
}
