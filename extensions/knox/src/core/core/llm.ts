import { v4 as uuidv4 } from "uuid";

import { streamDiffLines } from "../edit/streamDiffLines";
import { llmStreamChat } from "../llm/streamChat";
import { ChatDescriber } from "../util/chatDescriber";
import { clipboardCache } from "../util/clipboardCache";

import { DiffLine } from "..";
import type { ToCoreProtocol } from "../protocol";
import type { Message } from "../protocol/messenger";
import type { ConfigHandler } from "../config/ConfigHandler";
import type { CoreRuntime } from "./runtime";

async function* streamDiffLinesGenerator(
  configHandler: ConfigHandler,
  abortedMessageIds: Set<string>,
  msg: Message<ToCoreProtocol["streamDiffLines"][0]>,
): AsyncGenerator<DiffLine> {
  const data = msg.data;
  const llm = await configHandler.llmFromTitle(msg.data.modelTitle);
  for await (const diffLine of streamDiffLines(
    data.prefix,
    data.highlighted,
    data.suffix,
    llm,
    data.input,
    data.language,
    false,
    undefined,
  )) {
    if (abortedMessageIds.has(msg.messageId)) {
      abortedMessageIds.delete(msg.messageId);
      break;
    }
    yield diffLine;
  }
}

export function registerLlmHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  on("clipboardCache/add", (msg) => {
    const added = clipboardCache.add(uuidv4(), msg.data.content);
    if (added) {
      core.messenger.send("refreshSubmenuItems", {
        providers: ["clipboard"],
      });
    }
  });

  on("llm/streamChat", (msg) =>
    llmStreamChat(
      core.configHandler,
      core.abortedMessageIds,
      msg,
      core.ide,
      core.messenger,
    ),
  );

  on("llm/complete", async (msg) => {
    const model = await core.configHandler.llmFromTitle(msg.data.title);
    const completion = await model.complete(
      msg.data.prompt,
      new AbortController().signal,
      msg.data.completionOptions,
    );
    return completion;
  });
  on("llm/listModels", async (msg) => {
    const { config } = await core.configHandler.loadConfig();
    if (!config) {
      return [];
    }

    const model =
      config.models.find((model) => model.title === msg.data.title) ??
      config.models.find((model) => model.title?.startsWith(msg.data.title));
    try {
      if (model) {
        return await model.listModels();
      } else {
        return undefined;
      }
    } catch (e) {
      console.debug(`Error listing models: ${e}`);
      return undefined;
    }
  });

  // Provide messenger to utils so they can interact with GUI + state
  ChatDescriber.messenger = core.messenger;

  on("chatDescriber/describe", async (msg) => {
    const currentModel = await core.configHandler.llmFromTitle(
      msg.data.selectedModelTitle,
    );
    return await ChatDescriber.describe(currentModel, {}, msg.data.text);
  });

  on("streamDiffLines", (msg) =>
    streamDiffLinesGenerator(core.configHandler, core.abortedMessageIds, msg),
  );
}
