import { LLMOptions } from "../../index.js";
import { attributionHeaders, API_BASE } from "../../auth/openrouterOAuth/constants.js";
import { osModelsEditPrompt } from "../templates/edit.js";

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

  protected _getHeaders() {
    return {
      ...super._getHeaders(),
      ...attributionHeaders(),
    };
  }
}

export default OpenRouter;
