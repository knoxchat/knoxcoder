import { ILLM } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import * as vscode from "vscode";

import {
  buildFimPrompt,
  ENABLE_INLINE_COMPLETIONS_DEFAULT,
  ENABLE_INLINE_COMPLETIONS_SETTING,
  INLINE_COMPLETION_ACCEPT_COMMAND,
  INLINE_COMPLETION_COMPLETE_OPTIONS,
  INLINE_COMPLETION_MODEL_SETTING,
  INLINE_COMPLETION_STATS_COMMAND,
  INLINE_COMPLETION_PREFIX_LINES,
  INLINE_COMPLETION_SUFFIX_LINES,
  INLINE_COMPLETION_TRIGGER_AUTOMATIC,
  INLINE_COMPLETION_TRIGGER_EXPLICIT,
  isInlineCompletionsEnabled,
  pickInlineCompletionModel,
  sanitizeCompletion,
  shouldProvideInlineCompletion,
  slicePrefixSuffix,
} from "./knoxInlineCompletion";
import { InlineCompletionStats } from "./inlineCompletionStats";

/** Shared by the provider and the stats command. */
export const inlineCompletionStats = new InlineCompletionStats();

/**
 * KN-363: optional ghost-text completions from the configured Knox
 * edit/chat model. Gating lives in `knoxInlineCompletion.ts`; this
 * adapter registers only while `knoxchat.enableInlineCompletions` is on.
 */
function inlineCompletionsSettingEnabled(): boolean {
  return isInlineCompletionsEnabled(
    vscode.workspace
      .getConfiguration()
      .get<boolean>(
        ENABLE_INLINE_COMPLETIONS_SETTING,
        ENABLE_INLINE_COMPLETIONS_DEFAULT,
      ),
  );
}

export class KnoxInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private inflight: AbortController | undefined;

  constructor(private readonly configHandler: ConfigHandler) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const enabled = inlineCompletionsSettingEnabled();
    const last = document.lineAt(Math.max(0, document.lineCount - 1));
    if (
      !shouldProvideInlineCompletion({
        enabled,
        scheme: document.uri.scheme,
        documentChars: document.offsetAt(last.range.end),
        triggerKind:
          context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
            ? INLINE_COMPLETION_TRIGGER_AUTOMATIC
            : INLINE_COMPLETION_TRIGGER_EXPLICIT,
        atWord: Boolean(document.getWordRangeAtPosition(position)),
        atLineStart: position.character === 0,
      })
    ) {
      return undefined;
    }

    const llm = await this.resolveLlm();
    if (!llm || token.isCancellationRequested) {
      return undefined;
    }

    const start = Math.max(0, position.line - INLINE_COMPLETION_PREFIX_LINES);
    const end = Math.min(
      document.lineCount,
      position.line + INLINE_COMPLETION_SUFFIX_LINES + 1,
    );
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      lines.push(document.lineAt(i).text);
    }
    const { prefix, suffix } = slicePrefixSuffix({
      lines,
      line: position.line - start,
      character: position.character,
    });

    inlineCompletionStats.recordRequest();
    const startedAt = Date.now();
    this.inflight?.abort();
    const abort = new AbortController();
    this.inflight = abort;
    const cancel = token.onCancellationRequested(() => abort.abort());
    try {
      const completion = sanitizeCompletion(
        await llm.complete(
          buildFimPrompt(document.languageId, prefix, suffix),
          abort.signal,
          INLINE_COMPLETION_COMPLETE_OPTIONS,
        ),
        prefix,
      );
      inlineCompletionStats.recordLatency(Date.now() - startedAt);
      if (token.isCancellationRequested) {
        inlineCompletionStats.recordCancelled();
        return undefined;
      }
      if (!completion) {
        inlineCompletionStats.recordEmpty();
        return undefined;
      }
      inlineCompletionStats.recordShown();
      const item = new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position),
      );
      item.command = {
        command: INLINE_COMPLETION_ACCEPT_COMMAND,
        title: "Knox inline completion accepted",
      };
      return [item];
    } catch {
      if (token.isCancellationRequested || abort.signal.aborted) {
        inlineCompletionStats.recordCancelled();
      } else {
        inlineCompletionStats.recordFailed();
      }
      return undefined;
    } finally {
      cancel.dispose();
      if (this.inflight === abort) {
        this.inflight = undefined;
      }
    }
  }

  private async resolveLlm(): Promise<ILLM | undefined> {
    const { config } = await this.configHandler.loadConfig();
    return pickInlineCompletionModel({
      edit: config?.selectedModelByRole?.edit,
      chat: config?.selectedModelByRole?.chat,
      models: config?.models,
      preferredTitle: vscode.workspace
        .getConfiguration()
        .get<string>(INLINE_COMPLETION_MODEL_SETTING, ""),
    });
  }
}

export function registerKnoxInlineCompletions(
  _context: vscode.ExtensionContext,
  configHandler: ConfigHandler,
): vscode.Disposable {
  const provider = new KnoxInlineCompletionProvider(configHandler);
  let registration: vscode.Disposable | undefined;

  const sync = () => {
    const enabled = inlineCompletionsSettingEnabled();
    if (enabled && !registration) {
      registration = vscode.languages.registerInlineCompletionItemProvider(
        [
          { scheme: "file" },
          { scheme: "untitled" },
          { scheme: "vscode-notebook-cell" },
        ],
        provider,
      );
    } else if (!enabled && registration) {
      registration.dispose();
      registration = undefined;
    }
  };

  sync();
  const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(ENABLE_INLINE_COMPLETIONS_SETTING)) {
      sync();
    }
  });

  const commands = [
    vscode.commands.registerCommand(INLINE_COMPLETION_ACCEPT_COMMAND, () =>
      inlineCompletionStats.recordAccepted(),
    ),
    vscode.commands.registerCommand(INLINE_COMPLETION_STATS_COMMAND, () =>
      vscode.window.showInformationMessage(
        `Knox inline completions\n${inlineCompletionStats.format()}`,
        { modal: true },
      ),
    ),
  ];

  return vscode.Disposable.from(watcher, ...commands, {
    dispose() {
      registration?.dispose();
      registration = undefined;
    },
  });
}
