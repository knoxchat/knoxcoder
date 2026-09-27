/** Built-in @-mentions that are not workspace files. */
export const PROMPT_BUILTIN_MENTIONS = new Set([
  "clipboard",
  "codebase",
  "commit",
  "currentFile",
  "debugger",
  "diff",
  "docs",
  "file",
  "folder",
  "memory",
  "open",
  "os",
  "problems",
  "repo-map",
  "search",
  "terminal",
  "tree",
  "url",
  "web",
]);

export type PromptAtMention = {
  token: string;
  start: number;
  end: number;
};

/**
 * Collect `@path` mentions from a .prompt file, skipping builtin context ids.
 */
export function collectPromptFileAtMentions(text: string): PromptAtMention[] {
  const mentions: PromptAtMention[] = [];
  const regex = /@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1];
    const head = token.split(/[?#]/)[0];
    if (
      PROMPT_BUILTIN_MENTIONS.has(token) ||
      PROMPT_BUILTIN_MENTIONS.has(head)
    ) {
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) {
      continue;
    }
    mentions.push({
      token: head,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return mentions;
}
