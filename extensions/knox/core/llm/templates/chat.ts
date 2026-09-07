import { ChatMessage } from "../../index.js";
import { renderChatMessage } from "../../util/messageContent.js";

function templateFactory(
  systemMessage: (msg: ChatMessage) => string,
  userPrompt: string,
  assistantPrompt: string,
  separator: string,
  prefix?: string,
  emptySystemMessage?: string,
): (msgs: ChatMessage[]) => string {
  return (msgs: ChatMessage[]) => {
    let prompt = prefix ?? "";

    // Skip assistant messages at the beginning
    while (msgs.length > 0 && msgs[0].role === "assistant") {
      msgs.shift();
    }

    if (msgs.length > 0 && msgs[0].role === "system") {
      prompt += systemMessage(msgs.shift()!);
    } else if (emptySystemMessage) {
      prompt += emptySystemMessage;
    }

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      prompt += msg.role === "user" ? userPrompt : assistantPrompt;
      prompt += msg.content;
      if (i < msgs.length - 1) {
        prompt += separator;
      }
    }

    if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
      prompt += separator;
      prompt += assistantPrompt;
    }

    return prompt;
  };
}

function anthropicTemplateMessages(messages: ChatMessage[]): string {
  const HUMAN_PROMPT = "\n\nHuman:";
  const AI_PROMPT = "\n\nAssistant:";
  let prompt = "";

  // Anthropic prompt must start with a Human turn
  if (
    messages.length > 0 &&
    messages[0].role !== "user" &&
    messages[0].role !== "system"
  ) {
    prompt += `${HUMAN_PROMPT} Hello.`;
  }
  for (const msg of messages) {
    prompt += `${
      msg.role === "user" || msg.role === "system" ? HUMAN_PROMPT : AI_PROMPT
    } ${msg.content} `;
  }

  prompt += AI_PROMPT;
  return prompt;
}

`A chat between a curious user and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the user's questions.
USER: <image>{prompt}
ASSISTANT:`;

export {
  anthropicTemplateMessages,
};
