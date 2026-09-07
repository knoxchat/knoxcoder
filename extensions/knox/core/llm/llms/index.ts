import {
  BaseCompletionOptions,
  IdeSettings,
  ILLM,
  LLMOptions,
  ModelDescription,
} from "../..";
import { t } from "../../i18n/index.js";
import { renderTemplatedString } from "../../promptFiles/v1/renderTemplatedString";
import { BaseLLM } from "../index";

import Anthropic from "./Anthropic";
import KnoxChat from "./KnoxChat";
import MockLLM from "./Mock";
import OpenAI from "./OpenAI";

export const LLMClasses = [
  Anthropic,
  OpenAI,
  KnoxChat,
  MockLLM,
];

export async function llmFromDescription(
  desc: ModelDescription,
  readFile: (filepath: string) => Promise<string>,
  uniqueId: string,
  ideSettings: IdeSettings,
  writeLog: (log: string) => Promise<void>,
  completionOptions?: BaseCompletionOptions,
  systemMessage?: string,
): Promise<BaseLLM | undefined> {
  const cls = LLMClasses.find((llm) => llm.providerName === desc.provider);

  if (!cls) {
    return undefined;
  }

  const finalCompletionOptions = {
    ...completionOptions,
    ...desc.completionOptions,
  };

  systemMessage = desc.systemMessage ?? systemMessage;
  if (systemMessage !== undefined) {
    systemMessage = await renderTemplatedString(systemMessage, readFile, {});
  }

  let options: LLMOptions = {
    ...desc,
    completionOptions: {
      ...finalCompletionOptions,
      model: (desc.model || cls.defaultOptions?.model) ?? "anthropic/claude-sonnet-4.6",
      maxTokens:
        finalCompletionOptions.maxTokens ??
        cls.defaultOptions?.completionOptions?.maxTokens,
    },
    systemMessage,
    writeLog,
    uniqueId,
  };

  return new cls(options);
}

export function llmFromProviderAndOptions(
  providerName: string,
  llmOptions: LLMOptions,
): ILLM {
  const cls = LLMClasses.find((llm) => llm.providerName === providerName);

  if (!cls) {
    throw new Error(t("unknownLlmProvider", { provider: providerName }));
  }

  return new cls(llmOptions);
}
