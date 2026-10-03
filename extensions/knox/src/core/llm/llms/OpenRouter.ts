import { LLMOptions } from "../../index.js";
import { attributionHeaders, API_BASE } from "../../auth/openrouterOAuth/constants.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import type { ChatCompletionCreateParams } from "openai/resources/index";
import { applyCacheBreakpoints, supportsExplicitCacheControl } from "../promptCache.js";
import OpenAI from "./OpenAI.js";

class OpenRouter extends OpenAI {
  static providerName = "openrouter";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: `${API_BASE}/`,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };

  constructor(options: LLMOptions) {
    super({
      ...options,
      requestOptions: {
        ...options.requestOptions,
        headers: {
          ...attributionHeaders(),
          ...options.requestOptions?.headers,
        },
      },
    });
  }

  /**
   * OpenRouter is OpenAI-compatible. Do not inject Knox MS `session_id` /
   * `knox_ms` — that is KnoxChat-only.
   */
  protected extraBodyProperties(): Record<string, any> {
    return {};
  }

  /** K-030: explicit cache breakpoints for Anthropic/Gemini routed via OpenRouter. */
  protected modifyChatBody(body: ChatCompletionCreateParams): ChatCompletionCreateParams {
    const finalized = super.modifyChatBody(body);
    if (!supportsExplicitCacheControl(finalized.model)) {
      return finalized;
    }
    return {
      ...finalized,
      messages: applyCacheBreakpoints(finalized.messages as any[]) as any,
    };
  }

  protected _getHeaders() {
    return {
      ...super._getHeaders(),
      ...attributionHeaders(),
    };
  }
}

export default OpenRouter;
