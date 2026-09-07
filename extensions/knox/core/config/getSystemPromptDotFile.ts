import { IDE } from "..";
import { joinPathsToUri } from "../util/uri";

/** Legacy workspace rules file. Prefer `loadRules()` which also reads AGENTS.md. */
export const SYSTEM_PROMPT_DOT_FILE = ".knoxrules";

export async function getSystemPromptDotFile(ide: IDE): Promise<string | null> {
  const dirs = await ide.getWorkspaceDirs();

  let prompts: string[] = [];
  for (const dir of dirs) {
    const dotFile = joinPathsToUri(dir, SYSTEM_PROMPT_DOT_FILE);
    if (await ide.fileExists(dotFile)) {
      try {
        const content = await ide.readFile(dotFile);
        prompts.push(content);
      } catch (e) {
        // ignore if file doesn't exist
      }
    }
  }

  if (!prompts.length) {
    return null;
  }

  return prompts.join("\n\n");
}
