import { RequestOptions } from "./types.js";
import { fetchwithRequestOptions } from "../fetch/index.js";
import fetch from "node-fetch";
import {
  ChatCompletionChunk,
  ChatCompletion,
  CompletionUsage,
  Model,
} from "openai/resources/index";

export function chatChunk(options: {
  content: string | null | undefined;
  model: string;
  finish_reason?: ChatCompletionChunk.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
}): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: {
          content: options.content,
          role: "assistant",
        },
        finish_reason: options.finish_reason ?? "stop",
        index: 0,
        logprobs: null,
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion.chunk",
  };
}

export function chatChunkFromDelta(options: {
  delta: ChatCompletionChunk.Choice["delta"];
  model: string;
  finish_reason?: ChatCompletionChunk.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
}): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: options.delta,
        finish_reason: options.finish_reason ?? "stop",
        index: 0,
        logprobs: null,
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion.chunk",
  };
}

export function chatCompletion(options: {
  content: string | null | undefined;
  model: string;
  finish_reason?: ChatCompletion.Choice["finish_reason"];
  id?: string | null;
  usage?: CompletionUsage;
  index?: number | null;
}): ChatCompletion {
  return {
    choices: [
      {
        finish_reason: options.finish_reason ?? "stop",
        index: options.index ?? 0,
        logprobs: null,
        message: {
          content: options.content ?? null,
          role: "assistant",
          refusal: null,
        },
      },
    ],
    usage: options.usage,
    created: Date.now(),
    id: options.id ?? "",
    model: options.model,
    object: "chat.completion",
  };
}



export function model(options: {
  id: string;
  owned_by?: string;
  created?: number;
}): Model {
  return {
    id: options.id,
    object: "model",
    created: options.created ?? Date.now(),
    owned_by: options.owned_by ?? "organization-owner",
  };
}

/** Convert a Completions-API prompt field to a single string. */
export function promptToString(prompt: unknown): string {
  if (prompt == null) {
    return "";
  }
  if (typeof prompt === "string") {
    return prompt;
  }
  if (Array.isArray(prompt)) {
    return prompt
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join("");
  }
  return String(prompt);
}

export function maybeCustomFetch(requestOptions: RequestOptions | undefined) {
  return requestOptions
    ? (url: any, init: any) =>
        fetchwithRequestOptions(url, init, requestOptions)
    : undefined;
}

export function customFetch(requestOptions: RequestOptions | undefined) {
  return maybeCustomFetch(requestOptions) ?? fetch;
}
