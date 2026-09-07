import dotenv from "dotenv";
import { z } from "zod";
import { AnthropicApi } from "./apis/Anthropic.js";
import { BaseLlmApi } from "./apis/base.js";
import { MockApi } from "./apis/Mock.js";
import { OpenAIApi } from "./apis/OpenAI.js";
import { LLMConfig, OpenAIConfigSchema } from "./types.js";

dotenv.config();

function openAICompatible(
  apiBase: string,
  config: z.infer<typeof OpenAIConfigSchema>,
): OpenAIApi {
  return new OpenAIApi({
    ...config,
    apiBase: config.apiBase ?? apiBase,
  });
}

export function constructLlmApi(config: LLMConfig): BaseLlmApi | undefined {
  switch (config.provider) {
    case "openai":
      return new OpenAIApi(config);
    case "anthropic":
      return new AnthropicApi(config);
    case "knoxchat":
      return openAICompatible("https://api.knox.chat/v1/", config);
    case "mock":
      return new MockApi();
    default:
      return undefined;
  }
}

export {
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionCreateParams,
  type ChatCompletionCreateParamsNonStreaming,
  type ChatCompletionCreateParamsStreaming,
  type Completion,
  type CompletionCreateParams,
  type CompletionCreateParamsNonStreaming,
  type CompletionCreateParamsStreaming,
} from "openai/resources/index";

// export
export type { BaseLlmApi } from "./apis/base.js";
export type { LLMConfig } from "./types.js";
export { AnthropicApi } from "./apis/Anthropic.js";
export { promptToString } from "./util.js";
