import { CustomCommand, SlashCommand, SlashCommandDescription } from "../";

import SlashCommands from "./slash";

/**
 * YAML `prompts` → prompt-based slash command.
 * Expanded client-side (tools path); no legacy `run()` stream.
 */
export function slashFromCustomCommand(
  customCommand: CustomCommand,
): SlashCommand {
  return {
    name: customCommand.name,
    description: customCommand.description ?? "",
    prompt: customCommand.prompt,
    run: async function* () {
      throw new Error(
        `Slash command "/${customCommand.name}" is prompt-based and must be expanded client-side, not executed via run()`,
      );
    },
  };
}

export function slashCommandFromDescription(
  desc: SlashCommandDescription,
): SlashCommand | undefined {
  const cmd = SlashCommands.find((cmd) => cmd.name === desc.name);
  if (!cmd) {
    return undefined;
  }
  return {
    ...cmd,
    params: desc.params,
    description: desc.description ?? cmd.description,
  };
}
