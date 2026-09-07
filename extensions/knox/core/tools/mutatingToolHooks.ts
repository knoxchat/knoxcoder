import { ContextItem, IDE, Tool } from "..";
import { recordSoulEvent } from "../context/soul/recordSoulEvent.js";
import {
  extractSoulFiles,
  formatSoulCheckpointStamp,
} from "../context/soul/extractToolFiles.js";
import type { SoulEventKind } from "../context/soul/types.js";
import { BrainManager } from "../context/memory/brain/BrainManager.js";

import { ToolCallError, ToolCallErrorCode } from "./errors.js";
import {
  extractVerifiedFilePath,
  parseToolArgs,
  lspVerifySkippedItem,
  shouldCheckpointTool,
  shouldSkipLspVerify,
  shouldVerifyTool,
} from "./postEditVerification.js";
import { runPostEditBuildVerify } from "./build/verifyCommand.js";
import { classifyOracleEvent } from "../context/soul/oracleEvents.js";
import { blobTouchedUnsafe } from "./rustEditGuard.js";
import { resolveRustIsLib } from "./build/rustVerify.js";
import { joinPathsToUri } from "../util/uri.js";

function mutatingArgsTouchedUnsafe(args: unknown): boolean {
  const parsed = parseToolArgs(args) ?? {};
  const blob = [
    parsed.new_string,
    parsed.contents,
    parsed.patch,
    parsed.diff,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return blobTouchedUnsafe(blob);
}

async function rustVerifyLibHints(
  ide: IDE,
  filePath?: string,
): Promise<{ isLib?: boolean; cargoToml?: string }> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  let cargoToml = "";
  let libRsExists = false;
  if (root) {
    try {
      const tomlUri = joinPathsToUri(root, "Cargo.toml");
      if (await ide.fileExists(tomlUri)) {
        cargoToml = await ide.readFile(tomlUri);
      }
    } catch {
      // optional
    }
    try {
      libRsExists = await ide.fileExists(joinPathsToUri(root, "src", "lib.rs"));
    } catch {
      // optional
    }
  }
  return {
    cargoToml,
    isLib: resolveRustIsLib({ filePath, cargoToml, libRsExists }),
  };
}

export interface SoulHookOptions {
  tool: Tool;
  toolName: string;
  rawArgs: unknown;
  ide: IDE;
  selectedModelTitle?: string;
  sessionId?: string;
  turnId?: string;
  execute: () => Promise<ContextItem[]>;
  /** HL-07 compile oracle after mutating edits (`verifyCommand`). */
  buildVerify?: {
    command: string;
    maxIterations?: number;
    run: (command: string) => Promise<ContextItem[]>;
  };
}

function resolveSessionId(explicit?: string): string | undefined {
  return explicit || BrainManager.getActiveSessionId() || undefined;
}

function soulKindFromError(error: unknown): SoulEventKind {
  if (
    error instanceof ToolCallError &&
    error.code === ToolCallErrorCode.PERMISSION_DENIED
  ) {
    return "tool_denied";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/permission_denied|blocked by policy|denied/i.test(message)) {
    return "tool_denied";
  }
  return "tool_error";
}

/**
 * Shared mutating-tool side effects for GUI `tools/call` and `builtin_task`
 * children: turn checkpoint, undo snapshots, verification, SoulEvent.
 */
export async function executeToolWithSoulHooks(
  options: SoulHookOptions,
): Promise<ContextItem[]> {
  const {
    toolName,
    rawArgs,
    ide,
    selectedModelTitle,
    execute,
  } = options;
  const sessionId = resolveSessionId(options.sessionId);
  const files = extractSoulFiles(toolName, rawArgs);
  const mutating = shouldVerifyTool(toolName);
  const needsTurnCheckpoint = shouldCheckpointTool(toolName);
  let mutatingBeforeId: string | null = null;
  let workspaceCheckpointId: string | undefined;

  const emit = (
    kind: SoulEventKind,
    ok: boolean,
    summary: string,
    metadata?: Record<string, unknown>,
  ) => {
    if (!sessionId) {
      return Promise.resolve(0);
    }
    return recordSoulEvent({
      sessionId,
      kind,
      toolName,
      files,
      workspaceCheckpointId,
      ok,
      policy: kind === "tool_denied" ? "deny" : undefined,
      summary,
      metadata,
    }).catch(() => 0);
  };

  try {
    if (needsTurnCheckpoint && sessionId && typeof ide.ensureTurnCheckpoint === "function") {
      try {
        const checkpointId = await ide.ensureTurnCheckpoint({
          sessionId,
          turnId: options.turnId || sessionId,
          toolName,
        });
        if (checkpointId) {
          workspaceCheckpointId = checkpointId;
        }
      } catch (error) {
        console.warn(
          `[Soul] Turn checkpoint failed for ${toolName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (mutating && typeof ide.runPreRiskyCheckpoint === "function") {
      try {
        const result = await ide.runPreRiskyCheckpoint({
          toolName,
          sessionId,
          turnId: options.turnId,
        });
        if (result && typeof result === "object" && result.checkpointId) {
          workspaceCheckpointId = result.checkpointId;
        }
      } catch (error) {
        console.warn(
          `[Tools/Call] Pre-risky checkpoint failed for ${toolName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (mutating && typeof ide.captureMutatingToolBefore === "function") {
      try {
        mutatingBeforeId = await ide.captureMutatingToolBefore({
          toolName,
          toolArguments: rawArgs,
        });
      } catch (error) {
        console.warn(
          `[Tools/Call] Pre-mutation snapshot failed for ${toolName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const contextItems = await execute();

    if (options.buildVerify?.command && extractVerifiedFilePath(toolName, rawArgs)) {
      try {
        const filePath = extractVerifiedFilePath(toolName, rawArgs);
        const rustHints = await rustVerifyLibHints(ide, filePath);
        const buildItems = await runPostEditBuildVerify({
          toolName,
          command: options.buildVerify.command,
          maxIterations: options.buildVerify.maxIterations,
          circuitKey: `${sessionId ?? "anon"}:${options.buildVerify.command}`,
          run: options.buildVerify.run,
          filePath,
          unsafeTouched: mutatingArgsTouchedUnsafe(rawArgs),
          isLib: rustHints.isLib,
          cargoToml: rustHints.cargoToml,
        });
        if (buildItems.length) {
          contextItems.push(...buildItems);
        }
      } catch (error) {
        console.warn(
          `[Tools/Call] Post-edit build verify failed for ${toolName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (
      mutating &&
      typeof ide.runPostEditVerification === "function"
    ) {
      const filePath = extractVerifiedFilePath(toolName, rawArgs);
      if (filePath && shouldSkipLspVerify({ filePath })) {
        contextItems.push(lspVerifySkippedItem(filePath));
      } else if (filePath) {
        try {
          const verifyItems = await ide.runPostEditVerification({
            toolName,
            toolArguments: rawArgs,
            selectedModelTitle: selectedModelTitle || "",
          });
          if (verifyItems?.length) {
            contextItems.push(...verifyItems);
          }
        } catch (error) {
          console.warn(
            `[Tools/Call] Post-edit verification failed for ${toolName}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (typeof ide.recordMutatingToolAfter === "function") {
      try {
        await ide.recordMutatingToolAfter({
          toolName,
          toolArguments: rawArgs,
          beforeId: mutatingBeforeId,
          commit: true,
        });
      } catch (error) {
        console.warn(
          `[Tools/Call] Undo snapshot record failed for ${toolName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (workspaceCheckpointId) {
      contextItems.push({
        name: "soul",
        description: "checkpoint",
        content: formatSoulCheckpointStamp(workspaceCheckpointId),
      });
    }

    const summary = contextItems
      .map((item) => item.content)
      .join("\n")
      .slice(0, 1500);
    const oracle = classifyOracleEvent(toolName, summary);
    if (oracle) {
      void emit(oracle.kind, oracle.kind !== "build:fail" && oracle.kind !== "qemu:panic", oracle.summary, {
        oracle: oracle.kind,
        signature: oracle.signature,
      });
    } else {
      void emit("tool_success", true, (summary || `${toolName} succeeded`).slice(0, 500));
    }
    return contextItems;
  } catch (error) {
    if (mutatingBeforeId && typeof ide.recordMutatingToolAfter === "function") {
      try {
        await ide.recordMutatingToolAfter({
          toolName,
          toolArguments: rawArgs,
          beforeId: mutatingBeforeId,
          commit: false,
        });
      } catch {
        // Best-effort cleanup.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!/cancelled/i.test(message)) {
      void emit(soulKindFromError(error), false, message);
    }
    throw error;
  }
}
