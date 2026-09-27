import { ContextItem } from "core";
import * as vscode from "vscode";

import {
  buildToolsCallRequest,
  contextItemsToToolResultText,
  KNOX_LM_EXECUTE_TOOL_CALL_COMMAND,
  toolsCallInvocation,
} from "./knoxLmBridge";
import { createTextPart, createToolResult, knoxLm } from "./lmApi";
import { knoxLmToolContributions } from "./lmToolsCatalog";

import type { ConfigHandler } from "core/config/ConfigHandler";

async function resolveSelectedModelTitle(
  configHandler: ConfigHandler,
): Promise<string> {
  const { config } = await configHandler.loadConfig();
  return (
    config?.selectedModelByRole?.chat?.title ??
    config?.models?.[0]?.title ??
    "default"
  );
}

/**
 * KN-362: expose Knox builtin tools through `vscode.lm.registerTool` so
 * `lm.invokeTool('builtin_read_file', ...)` runs Core `tools/call`.
 */
export function registerKnoxLmTools(
  _context: vscode.ExtensionContext,
  configHandler: ConfigHandler,
): vscode.Disposable {
  const lm = knoxLm();
  const registerTool = lm.registerTool?.bind(lm);
  if (typeof registerTool !== "function") {
    return { dispose() {} };
  }

  let callSeq = 0;
  const subscriptions: vscode.Disposable[] = [];
  for (const tool of knoxLmToolContributions()) {
    subscriptions.push(
      registerTool(tool.name, {
        prepareInvocation(options) {
          const filepath =
            options.input &&
            typeof options.input === "object" &&
            "filepath" in options.input
              ? String((options.input as { filepath?: unknown }).filepath ?? "")
              : "";
          return {
            invocationMessage: filepath
              ? `${tool.displayName}: ${filepath}`
              : tool.displayName,
            confirmationMessages: tool.readonly
              ? undefined
              : {
                  title: `Allow Knox ${tool.displayName}?`,
                  message: tool.modelDescription,
                },
          };
        },
        async invoke(options, token) {
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
          const selectedModelTitle = await resolveSelectedModelTitle(
            configHandler,
          );
          callSeq += 1;
          const invocation = toolsCallInvocation(
            buildToolsCallRequest({
              toolName: tool.name,
              input: options.input ?? {},
              selectedModelTitle,
              callId: `lm-${tool.name}-${Date.now()}-${callSeq}`,
            }),
          );
          const items =
            (await vscode.commands.executeCommand<ContextItem[]>(
              KNOX_LM_EXECUTE_TOOL_CALL_COMMAND,
              invocation.data,
            )) ?? [];
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
          return createToolResult([
            createTextPart(contextItemsToToolResultText(items)),
          ]);
        },
      }),
    );
  }

  return vscode.Disposable.from(...subscriptions);
}
