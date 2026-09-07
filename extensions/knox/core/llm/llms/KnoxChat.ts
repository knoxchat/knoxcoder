import { LLMOptions } from "../../index.js";
import {
  findKnoxChatModelSync,
  modelSupportsParameter,
} from "../knoxChatModels.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import OpenAI from "./OpenAI.js";

/**
 * Generates a deterministic session ID for Knox MS memory persistence.
 * Uses the workspace folder name + a stable hash so the same project
 * always reconnects to the same Knox MS session/memory.
 */
function generateKnoxSessionId(): string {
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `knoxchat-vscode-${dateStr}`;
}

class KnoxChat extends OpenAI {
  static providerName = "knoxchat";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.knox.chat/v1/",
    model: "qwen/qwen3-coder",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };

  /**
   * Returns additional body properties based on /v1/models supported_parameters.
   *
   * For knox/knox-ms (and any model advertising session_id / include_reasoning /
   * verbosity), include knox_ms config for session
   * correlation. Memory stays local — retrieval uses BM25 fusion in SQLite.
   */
  protected extraBodyProperties(): Record<string, any> {
    const model = this.model || KnoxChat.defaultOptions.model || "";
    const metadata = findKnoxChatModelSync(model);
    const supported = metadata?.supported_parameters ?? this.supportedParameters;

    const wantsKnoxMs =
      model === "knox/knox-ms" ||
      modelSupportsParameter(supported, "session_id") ||
      modelSupportsParameter(supported, "memory_mode");

    if (!wantsKnoxMs) {
      return {};
    }

    const knoxMs: Record<string, unknown> = {};

    if (
      modelSupportsParameter(supported, "session_id") ||
      model === "knox/knox-ms"
    ) {
      knoxMs.session_id = generateKnoxSessionId();
    }

    if (
      modelSupportsParameter(supported, "include_reasoning") ||
      modelSupportsParameter(supported, "reasoning") ||
      model === "knox/knox-ms"
    ) {
      knoxMs.include_reasoning = true;
    }

    if (
      modelSupportsParameter(supported, "verbosity") ||
      model === "knox/knox-ms"
    ) {
      knoxMs.verbosity = "verbose";
    }

    return Object.keys(knoxMs).length > 0 ? { knox_ms: knoxMs } : {};
  }
}

export default KnoxChat;
