import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import { BaseContextProvider } from "../index.js";

/** Integration `@debugger` provider title. Never a default mention. */
export const DEBUGGER_CONTEXT_PROVIDER_TITLE = "debugger";

export function formatDebuggerContext(opts: {
  threadName?: string;
  localVariables: string;
  callStackSources: string[];
}): string {
  const callStackContents = opts.callStackSources.reduce(
    (acc, source, index) =>
      `${acc}\n\ncall stack ${index}\n\`\`\`\n${source}\n\`\`\``,
    "",
  );
  return (
    `This is the paused thread: ${opts.threadName ?? ""}\n` +
    `Current local variables content: \n${opts.localVariables}.\n` +
    `Current top-level call stack: ${callStackContents}`
  );
}

export function debuggerSubmenuItems(
  threads: Array<{ id: number; name: string }>,
): ContextSubmenuItem[] {
  return threads.map((thread) => ({
    id: `${thread.id}`,
    title: thread.name,
    description: `${thread.id}`,
  }));
}

class DebugLocalsProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: DEBUGGER_CONTEXT_PROVIDER_TITLE,
    displayTitle: "Debugger",
    description: t("localVariables"),
    type: "submenu",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const threadIndex = Number(query);
    const localVariables = await extras.ide.getDebugLocals(threadIndex);
    const thread = (await extras.ide.getAvailableThreads()).find(
      (candidate) => candidate.id === threadIndex,
    );
    const callStacksSources = await extras.ide.getTopLevelCallStackSources(
      threadIndex,
      this.options?.stackDepth || 3,
    );
    return [
      {
        description: t("localVariablesDesc"),
        content: formatDebuggerContext({
          threadName: thread?.name,
          localVariables,
          callStackSources: callStacksSources,
        }),
        name: "Debugger",
      },
    ];
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    // Host DAP tracker + IDE.getAvailableThreads already keep paused threads only.
    return debuggerSubmenuItems(await args.ide.getAvailableThreads());
  }
}

export default DebugLocalsProvider;
