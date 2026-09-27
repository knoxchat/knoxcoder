import * as vscode from "vscode";

import { ConfigHandler } from "core/config/ConfigHandler";

import { registerKnoxAssistProvider } from "./knoxAssistProvider";
import { registerKnoxInlineCompletions } from "./knoxInlineCompletionProvider";
import { registerKnoxLmTools } from "./registerLmTools";

/**
 * LM host hooks: `textModelApiTools` → Core `tools/call` and vendor `knox`
 * assist provider (KN-362). Optional ghost-text completions (KN-363) register
 * only while `knoxchat.enableInlineCompletions` is on (default off).
 */
export function registerLanguageModelFeatures(
  context: vscode.ExtensionContext,
  configHandler: ConfigHandler,
): void {
  context.subscriptions.push(
    registerKnoxLmTools(context, configHandler),
    registerKnoxAssistProvider(context, configHandler),
    registerKnoxInlineCompletions(context, configHandler),
  );
}
