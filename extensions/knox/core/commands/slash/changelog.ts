import { SlashCommand } from "../../index.js";
import { renderChatMessage } from "../../util/messageContent.js";

const ChangelogCommand: SlashCommand = {
  name: "changelog",
  description: "Generate a changelog from recent git history",
  run: async function* ({ ide, llm, input }) {
    const workspaceDirs = await ide.getWorkspaceDirs();
    if (workspaceDirs.length === 0) {
      yield "No workspace directory found.";
      return;
    }

    const workspaceDir = workspaceDirs[0];

    // Parse options: --since=<ref>, --count=<n>
    let sinceRef = "";
    let count = 50;

    const sinceMatch = input?.match(/--since=(\S+)/);
    if (sinceMatch) {
      sinceRef = sinceMatch[1];
    }

    const countMatch = input?.match(/--count=(\d+)/);
    if (countMatch) {
      count = Math.min(parseInt(countMatch[1], 10), 200);
    }

    // Get commit log
    let commitLog: string;
    try {
      const logCmd = sinceRef
        ? `git log ${sinceRef}..HEAD --pretty=format:"%h %s (%an, %ar)" --no-merges`
        : `git log -${count} --pretty=format:"%h %s (%an, %ar)" --no-merges`;
      const [stdout] = await ide.subprocess(logCmd, workspaceDir);
      commitLog = stdout;
    } catch (e) {
      yield "Failed to read git log. Make sure you're in a git repository.";
      return;
    }

    if (!commitLog.trim()) {
      yield "No commits found in the specified range.";
      return;
    }

    // Get diff stats for context
    let diffStat = "";
    if (sinceRef) {
      try {
        const [stdout] = await ide.subprocess(
          `git diff ${sinceRef}..HEAD --stat`,
          workspaceDir,
        );
        diffStat = stdout;
      } catch {
        // Non-critical
      }
    }

    const prompt = `You are generating a changelog from git commit history. Here are the commits:

${commitLog}

${diffStat ? `**File Changes Summary**:\n${diffStat}\n` : ""}

Generate a well-organized changelog in this format:

## Changelog

### Features
- Description of new features (reference commit hash)

### Bug Fixes
- Description of fixes (reference commit hash)

### Improvements
- Refactoring, performance, DX improvements

### Documentation
- Doc updates

### Other
- Build, CI, deps, etc.

Rules:
- Only include sections that have matching commits
- Group related commits into single entries where appropriate
- Use clear, user-facing language (not raw commit messages)
- Reference commit hashes in parentheses
- Sort entries by importance within each section

Output ONLY the changelog in markdown.`;

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: prompt }],
      new AbortController().signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default ChangelogCommand;
