/**
 * Prompt-based (non-legacy) slash command helpers.
 *
 * Commands with a `prompt` field (custom / YAML / .prompt files) are expanded
 * into the user message and streamed through the normal tool-capable path.
 * Built-ins without `prompt` still use `legacySlashCommandData` + `run()`.
 */

export function extractSlashUserInput(
  fullInput: string,
  commandName: string,
): string {
  const prefix = `/${commandName}`;
  if (fullInput.startsWith(prefix)) {
    return fullInput.slice(prefix.length).trimStart();
  }
  return fullInput;
}

export function expandPromptSlashCommand(
  prompt: string,
  userInput: string,
): string {
  if (prompt.includes("{{{ input }}}") || prompt.includes("{{{input}}}")) {
    return prompt
      .replace(/\{\{\{\s*input\s*\}\}\}/g, userInput)
      .trim();
  }
  if (!userInput.trim()) {
    return prompt.trim();
  }
  return `${prompt.trim()}\n\n${userInput}`;
}

export function isPromptBasedSlashCommand(command: {
  prompt?: string;
}): boolean {
  return typeof command.prompt === "string" && command.prompt.length > 0;
}
