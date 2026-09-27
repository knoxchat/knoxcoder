import { SlashCommand } from "../..";
import { parsePromptFileV1V2 } from "./parsePromptFileV1V2";

/**
 * Convert a `.prompt` file into a prompt-based slash command.
 *
 * Product path (GUI): expands `prompt` client-side and streams with tools.
 * Legacy `run()` generators are not attached — built-ins still provide `run`.
 */
export function slashCommandFromPromptFile(
  path: string,
  content: string,
): SlashCommand | null {
  const { name, description, systemMessage, prompt } = parsePromptFileV1V2(
    path,
    content,
  );

  if (!name?.trim()) {
    return null;
  }

  let body = prompt ?? "";
  if (systemMessage?.trim()) {
    body = `${systemMessage.trim()}\n\n${body}`.trim();
  }

  return {
    name,
    description: description ?? name,
    prompt: body,
    // Required by SlashCommand type; never used for prompt-based commands.
    run: async function* () {
      throw new Error(
        `Slash command "/${name}" is prompt-based and must be expanded client-side, not executed via run()`,
      );
    },
  };
}
