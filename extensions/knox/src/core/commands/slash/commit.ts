import { SlashCommand } from "../../index.js";
import { t } from "../../i18n/index.js";
import { renderChatMessage } from "../../util/messageContent.js";

const CommitMessageCommand: SlashCommand = {
  name: "commit",
  description: t("generateCommitMessage"),
  run: async function* ({ ide, llm, params, input }) {
    const includeUnstaged = params?.includeUnstaged ?? false;
    const useConventional = input?.includes("--conventional") || params?.conventional;
    const diff = await ide.getDiff(includeUnstaged);

    if (diff.length === 0) {
      yield t("noChangesDetected");
      return;
    }

    const diffText = diff.join("\n");

    let prompt: string;
    if (useConventional) {
      prompt = `${diffText}\n\nAnalyze the above changes and generate a conventional commit message. Use conventional commit format:

<type>(<scope>): <subject>

<body>

Where type is one of: feat, fix, refactor, docs, test, chore, style, perf, ci, build, revert
Scope should be the main area affected (e.g., auth, api, ui).
Subject should be lowercase, imperative, no period, max 72 characters.
Body should have bullet points explaining key changes (max 5 bullets, each max 60 characters).

Output ONLY the commit message, nothing else.`;
    } else {
      prompt = `${diffText}\n\nGenerate a commit message for the above set of changes. First, give a single sentence, no more than 80 characters. Then, after 2 line breaks, give a list of no more than 5 short bullet points, each no more than 40 characters. Output nothing except for the commit message, and don't surround it in quotes.`;
    }

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: prompt }],
      new AbortController().signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default CommitMessageCommand;
