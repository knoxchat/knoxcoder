import { fetchwithRequestOptions } from "knoxdev-package/fetch";

import { ChatMessage, IDE, PromptLog } from "..";
import { ConfigHandler } from "../config/ConfigHandler";
import {
  compactMessagesAsync,
  type CompactionAppliedEvent,
} from "../compaction/index.js";
import { pinCompactionSoul } from "../context/soul/recordSoulEvent.js";
import { t } from "../i18n/index.js";
import { FromCoreProtocol, ToCoreProtocol } from "../protocol";
import { IMessenger, Message } from "../protocol/messenger";
import { analyzeForViewReadModel } from "../tools/modelRouting";
import {
  formatMatchedSkillsHint,
  matchSkillsByIntent,
} from "../skills/skillMatcher";
import { getSkillToolDescription } from "../tools/implementations/skill";
import { getSkillManager } from "../tools/implementations/skillSingleton";
import { SKILL_TOOL_NAME } from "../tools/definitions/skill";
import {
  clearLastCompactionResult,
  getLastCompactionResult,
} from "./countTokens.js";

function extractUserText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join(" ");
  }
  return "";
}

function injectSuggestedSkills(
  messages: ChatMessage[],
  hint: string,
): ChatMessage[] {
  if (!hint) {
    return messages;
  }
  const next = [...messages];
  const systemIndex = next.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    const existing = next[systemIndex];
    const existingText =
      typeof existing.content === "string"
        ? existing.content
        : extractUserText(existing);
    next[systemIndex] = {
      ...existing,
      content: existingText ? `${existingText}\n\n${hint}` : hint,
    };
    return next;
  }
  return [{ role: "system", content: hint }, ...next];
}

function notifyCompactionApplied(
  messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>,
  result: {
    tokensSaved: number;
    originalMessageCount: number;
    compactedMessageCount: number;
    summarized: boolean;
    deduplicated: boolean;
    summarizationMethod?: CompactionAppliedEvent["summarizationMethod"];
    summaryText?: string;
  },
) {
  if (
    result.tokensSaved <= 0 &&
    result.originalMessageCount <= result.compactedMessageCount
  ) {
    return;
  }
  const payload: CompactionAppliedEvent = {
    tokensSaved: result.tokensSaved,
    originalMessageCount: result.originalMessageCount,
    compactedMessageCount: result.compactedMessageCount,
    summarized: result.summarized,
    deduplicated: result.deduplicated,
    summarizationMethod: result.summarizationMethod ?? "none",
    summaryText: result.summaryText,
  };
  messenger.send("compaction/applied", payload);
  void pinCompactionSoul({
    tokensSaved: result.tokensSaved,
    originalMessageCount: result.originalMessageCount,
    compactedMessageCount: result.compactedMessageCount,
    summaryText: result.summaryText,
  }).catch(() => {});
}

export async function* llmStreamChat(
  configHandler: ConfigHandler,
  abortedMessageIds: Set<string>,
  msg: Message<ToCoreProtocol["llm/streamChat"][0]>,
  ide: IDE,
  messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>,
): AsyncGenerator<ChatMessage, PromptLog> {
  const { config } = await configHandler.loadConfig();
  if (!config) {
    throw new Error(t("configNotLoaded"));
  }

  const { title, legacySlashCommandData, completionOptions: rawCompletionOptions, messages } =
    msg.data;
  let completionOptions = rawCompletionOptions;

  // Cost optimization: Analyze if we should use View/Read model instead
  let effectiveTitle = title;
  let shouldUseViewRead = false;
  
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "user") {
      const messageContent = typeof lastMessage.content === "string" 
        ? lastMessage.content 
        : Array.isArray(lastMessage.content) 
          ? lastMessage.content.map(part => "text" in part ? part.text : "").join(" ")
          : "";
      
      // Check if we have context (previous messages or file contents)
      const hasContext = messages.length > 1 || 
                        messageContent.toLowerCase().includes("file") ||
                        messageContent.toLowerCase().includes("code") ||
                        (completionOptions?.tools?.length ?? 0) > 0;
      
      const analysis = analyzeForViewReadModel(messageContent, hasContext);
      
      if (analysis.shouldUseViewRead && config.selectedModelByRole.viewRead?.title) {
        effectiveTitle = config.selectedModelByRole.viewRead.title;
        shouldUseViewRead = true;
        console.log(`[Cost Optimization] 💰 Backend: Using View/Read model for chat: ${analysis.reason} (confidence: ${analysis.confidence})`);
      } else {
        console.log(`[Cost Optimization] Backend: Using Chat model: ${analysis.reason}`);
      }
    }
  }

  const model = await configHandler.llmFromTitle(effectiveTitle);

  // Log to return in case of error
  const errorPromptLog = {
    modelTitle: model.title ?? model.model,
    completion: "",
    prompt: "",
    completionOptions: {
      ...msg.data.completionOptions,
      model: model.model,
    },
  };

  if (legacySlashCommandData) {
    const { command, contextItems, historyIndex, input, selectedCode } =
      legacySlashCommandData;
    const slashCommand = config.slashCommands?.find(
      (sc) => sc.name === command.name,
    );
    if (!slashCommand) {
      throw new Error(t("unknownSlashCommand", { name: command.name }));
    }


    const gen = slashCommand.run({
      input,
      history: messages,
      llm: model,
      contextItems,
      params: command.params,
      ide,
      addContextItem: (item) => {
        void messenger.request("addContextItem", {
          item,
          historyIndex,
        });
      },
      selectedCode,
      config,
      fetch: (url, init) =>
        fetchwithRequestOptions(url, init, config.requestOptions),
      completionOptions,
    });
    const checkActiveInterval = setInterval(() => {
      if (abortedMessageIds.has(msg.messageId)) {
        abortedMessageIds.delete(msg.messageId);
        clearInterval(checkActiveInterval);
      }
    }, 100);
    try {
      let next = await gen.next();
      while (!next.done) {
        if (abortedMessageIds.has(msg.messageId)) {
          abortedMessageIds.delete(msg.messageId);
          next = await gen.return(errorPromptLog);
          clearInterval(checkActiveInterval);
          break;
        }
        if (next.value) {
          yield {
            role: "assistant",
            content: next.value,
          };
        }
        next = await gen.next();
      }
      if (!next.done) {
        throw new Error("Will never happen");
      }

      return next.value;
    } catch (e) {
      throw e;
    } finally {
      clearInterval(checkActiveInterval);
    }
  } else {
    // Inject dynamic skill tool description so the LLM sees available skill names
    if (completionOptions?.tools) {
      const dynamicDesc = getSkillToolDescription();
      completionOptions = {
        ...completionOptions,
        tools: completionOptions.tools.map((tool) =>
          tool.function.name === SKILL_TOOL_NAME
            ? {
                ...tool,
                function: {
                  ...tool.function,
                  description: dynamicDesc,
                },
              }
            : tool,
        ),
      };
    }

    // Optional LLM summarization before the sync compile/compaction path.
    let chatMessages = messages;
    let notifiedLlmCompaction = false;
    const useLlmSummarization =
      config.experimental?.useLlmSummarization === true;
    if (useLlmSummarization) {
      const summarizeLlm =
        config.selectedModelByRole.summarize ?? model;
      try {
        const compaction = await compactMessagesAsync(
          chatMessages,
          model.model,
          model.contextLength,
          completionOptions?.maxTokens ?? model.completionOptions?.maxTokens ?? 2048,
          0,
          350,
          { useLlmSummarization: true },
          (prompt, signal) => summarizeLlm.complete(prompt, signal),
        );
        if (compaction.tokensSaved > 0) {
          chatMessages = compaction.messages;
          notifyCompactionApplied(messenger, compaction);
          notifiedLlmCompaction = true;
        }
      } catch (err) {
        console.warn(
          "[Compaction] LLM summarization failed; falling back to heuristic:",
          err,
        );
      }
    }

    // Suggest intent-matched skills after compaction (names only; full body via tool)
    try {
      const manager = getSkillManager();
      const lastUser = [...messages]
        .reverse()
        .find((message) => message.role === "user");
      if (manager?.isLoaded && lastUser) {
        const matches = matchSkillsByIntent(
          extractUserText(lastUser),
          manager.all(),
          { limit: 3, minScore: 0.18 },
        );
        const hint = formatMatchedSkillsHint(matches);
        if (hint) {
          chatMessages = injectSuggestedSkills(chatMessages, hint);
        }
      }
    } catch {
      // Skill matching is best-effort
    }

    clearLastCompactionResult();
    const gen = model.streamChat(
      chatMessages,
      new AbortController().signal,
      completionOptions,
    );
    let next = await gen.next();
    // Heuristic compaction runs inside compileChatMessages on first tick.
    if (!notifiedLlmCompaction) {
      const syncCompaction = getLastCompactionResult();
      if (syncCompaction) {
        notifyCompactionApplied(messenger, syncCompaction);
      }
    }
    while (!next.done) {
      if (abortedMessageIds.has(msg.messageId)) {
        abortedMessageIds.delete(msg.messageId);
        next = await gen.return(errorPromptLog);
        break;
      }

      const chunk = next.value;

      yield chunk;
      next = await gen.next();
    }
    if (!next.done) {
      throw new Error("Will never happen");
    }

    return next.value;
  }
}
