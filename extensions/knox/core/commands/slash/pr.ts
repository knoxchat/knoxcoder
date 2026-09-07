import { SlashCommand } from "../../index.js";
import { renderChatMessage } from "../../util/messageContent.js";

const PrDescriptionCommand: SlashCommand = {
  name: "pr",
  description: "Generate a PR description from current branch changes",
  run: async function* ({ ide, llm, input }) {
    const workspaceDirs = await ide.getWorkspaceDirs();
    if (workspaceDirs.length === 0) {
      yield "No workspace directory found.";
      return;
    }

    const workspaceDir = workspaceDirs[0];
    const branch = await ide.getBranch(workspaceDir);

    // Determine base branch — user can specify with --base=main
    let baseBranch = "main";
    const baseMatch = input?.match(/--base=(\S+)/);
    if (baseMatch) {
      baseBranch = baseMatch[1];
    }

    // Get diff against base branch
    let diffOutput: string;
    try {
      const [stdout] = await ide.subprocess(
        `git diff ${baseBranch}...HEAD`,
        workspaceDir,
      );
      diffOutput = stdout;
    } catch {
      // Fallback: try origin/main
      try {
        const [stdout] = await ide.subprocess(
          `git diff origin/${baseBranch}...HEAD`,
          workspaceDir,
        );
        diffOutput = stdout;
      } catch {
        yield `Could not compute diff against \`${baseBranch}\`. Make sure the base branch exists.`;
        return;
      }
    }

    if (!diffOutput.trim()) {
      yield `No changes found between \`${baseBranch}\` and current branch \`${branch}\`.`;
      return;
    }

    // Get commit log for context
    let commitLog = "";
    try {
      const [stdout] = await ide.subprocess(
        `git log ${baseBranch}..HEAD --oneline --no-merges`,
        workspaceDir,
      );
      commitLog = stdout;
    } catch {
      // Non-critical, proceed without
    }

    // Get diff stats
    let diffStat = "";
    try {
      const [stdout] = await ide.subprocess(
        `git diff ${baseBranch}...HEAD --stat`,
        workspaceDir,
      );
      diffStat = stdout;
    } catch {
      // Non-critical
    }

    // Truncate diff if too large (keep first 15000 chars)
    const truncatedDiff =
      diffOutput.length > 15000
        ? diffOutput.slice(0, 15000) + "\n\n... (diff truncated)"
        : diffOutput;

    const prompt = `You are generating a Pull Request description. Here is the context:

**Branch**: \`${branch}\` → \`${baseBranch}\`

**Commits**:
${commitLog || "(no commit log available)"}

**Diff Stats**:
${diffStat || "(not available)"}

**Full Diff**:
${truncatedDiff}

Generate a well-structured PR description in markdown with these sections:
## Title
A concise PR title (one line).

## Summary
2-3 sentences summarizing the overall purpose of this PR.

## Changes
A categorized bullet list of changes grouped by type:
- **Features**: New functionality added
- **Fixes**: Bug fixes
- **Refactoring**: Code improvements
- **Other**: Documentation, tests, config, etc.

Only include categories that have changes.

## Testing
Suggest what should be tested for this PR.

Output ONLY the PR description in markdown.`;

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: prompt }],
      new AbortController().signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default PrDescriptionCommand;
