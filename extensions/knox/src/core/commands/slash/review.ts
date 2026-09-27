import { ChatMessage, SlashCommand } from "../../index.js";
import { t } from "../../i18n/index.js";
import { renderChatMessage } from "../../util/messageContent.js";

const prompt = `
     Review the following code, focusing on Readability, Maintainability, Code Smells, Speed, and Memory Performance. Provide feedback with these guidelines:

     Tone: Friendly casual tone of a fellow engineer, ensure the feedback is clear and focused on practical improvements.
     Orderly Analysis: Address the code sequentially, from top to bottom, to ensure a thorough review without skipping any parts.
     Descriptive Feedback: Avoid referencing line numbers directly, as they may vary. Instead, describe the code sections or specific constructs that need attention, explaining the reasons clearly.
     Provide Examples: For each issue identified, offer an example of how the code could be improved or rewritten for better clarity, performance, or maintainability.
     Your response should be structured to first identify the issue, then explain why it’s a problem, and finally, offer a solution with example code.`;

function getLastUserHistory(history: ChatMessage[]): string {
  const lastUserHistory = history
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserHistory) {
    return "";
  }

  if (Array.isArray(lastUserHistory.content)) {
    return lastUserHistory.content.reduce(
      (acc: string, current: { type: string; text?: string }) => {
        return current.type === "text" && current.text
          ? acc + current.text
          : acc;
      },
      "",
    );
  }

  return typeof lastUserHistory.content === "string"
    ? lastUserHistory.content
    : "";
}

const ReviewMessageCommand: SlashCommand = {
  name: "review",
  description: t("reviewCode"),
  run: async function* ({ ide, llm, history, input }) {
    const useDiff = input?.includes("--diff");
    let reviewText: string;

    if (useDiff) {
      const diff = await ide.getDiff(true);
      if (diff.length === 0) {
        yield "No changes detected in git diff. Stage or modify some files first.";
        return;
      }
      reviewText = diff.join("\n");
    } else {
      reviewText = getLastUserHistory(history).replace("\\review", "");
    }

    if (!reviewText.trim()) {
      yield "No code to review. Provide code in the chat or use `/review --diff` to review git changes.";
      return;
    }

    const content = `${prompt} \r\n ${reviewText}`;

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: content }],
      new AbortController().signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default ReviewMessageCommand;
