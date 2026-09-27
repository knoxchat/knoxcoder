import { ContextItem } from "core";
import {
  extractVerifiedFilePath,
  shouldSkipLspVerify,
  shouldVerifyTool,
} from "core/tools/postEditVerification";
import * as vscode from "vscode";

import { CommandHistoryService } from "./CommandHistoryService";
import { VerificationService } from "./VerificationService";

/** Consecutive verification failures per file before we skip further auto-fix. */
const FILE_FAILURE_CIRCUIT_THRESHOLD = 3;

const fileFailureCounts = new Map<string, number>();

export interface RunPostEditVerificationParams {
  toolName: string;
  toolArguments: unknown;
  selectedModelTitle: string;
}

/**
 * Shared post-edit verification used by Core `tools/call` (GUI + agent).
 * Toggle: `knoxchat.enablePostEditVerification` (default true).
 */
export async function runPostEditVerification(
  params: RunPostEditVerificationParams,
): Promise<ContextItem[]> {
  const enabled = vscode.workspace
    .getConfiguration("knoxchat")
    .get<boolean>("enablePostEditVerification", true);
  if (!enabled) {
    return [];
  }

  const verifyCommand = vscode.workspace
    .getConfiguration("knoxchat")
    .get<string>("verifyCommand", "")
    ?.trim();
  const verifyMode = vscode.workspace
    .getConfiguration("knoxchat")
    .get<string>("verifyMode", "diagnostics");
  const { toolName, toolArguments, selectedModelTitle } = params;
  if (!shouldVerifyTool(toolName)) {
    return [];
  }
  const filePath = extractVerifiedFilePath(toolName, toolArguments);
  if (!filePath) {
    return [];
  }
  if (
    shouldSkipLspVerify({
      filePath,
      verifyMode,
      verifyCommand,
      rustAnalyzerAvailable: Boolean(
        vscode.extensions.getExtension("rust-lang.rust-analyzer")?.isActive,
      ),
    })
  ) {
    return [];
  }

  const failures = fileFailureCounts.get(filePath) ?? 0;
  if (failures >= FILE_FAILURE_CIRCUIT_THRESHOLD) {
    return [
      {
        name: "Auto-Verification Skipped",
        description: "Post-edit verification circuit breaker",
        content: `Skipped auto-verification for ${filePath}: ${failures} consecutive unsuccessful fix attempts. Fix manually or reload the window to reset.`,
      },
    ];
  }

  const verificationService = VerificationService.getInstance();
  if (!verificationService.shouldVerify()) {
    return [];
  }

  try {
    const verifyResult = await verificationService.verifyAndFix(
      filePath,
      selectedModelTitle,
    );

    if (verifyResult.totalFixed > 0) {
      try {
        await CommandHistoryService.getInstance().refreshAfterSnapshotForPath(
          filePath,
        );
      } catch {
        // Undo history may be unavailable outside agent init — ignore.
      }
    }

    if (verifyResult.clean) {
      fileFailureCounts.delete(filePath);
    } else if (verifyResult.bailedOut || verifyResult.iterations > 0) {
      fileFailureCounts.set(filePath, failures + 1);
    }

    if (verifyResult.totalFixed > 0) {
      return [
        {
          name: "Auto-Verification Result",
          description: "Post-edit diagnostic verification",
          content: verifyResult.clean
            ? `Auto-verification: fixed ${verifyResult.totalFixed} diagnostic issue(s) in ${verifyResult.iterations} iteration(s). File is now clean.`
            : `Auto-verification: fixed ${verifyResult.totalFixed} issue(s) in ${verifyResult.iterations} iteration(s), but ${verifyResult.remainingIssues.length} issue(s) remain.`,
        },
      ];
    }

    if (!verifyResult.clean && verifyResult.remainingIssues.length > 0) {
      return [
        {
          name: "Auto-Verification Result",
          description: "Post-edit diagnostic verification",
          content: `Auto-verification: ${verifyResult.remainingIssues.length} diagnostic issue(s) detected but could not be auto-fixed: ${verifyResult.remainingIssues
            .map((i) => `Line ${i.line}: ${i.message}`)
            .join("; ")}`,
        },
      ];
    }

    return [];
  } catch (error) {
    console.warn(
      `[postEditVerification] Failed for ${filePath}:`,
      (error as Error).message,
    );
    fileFailureCounts.set(filePath, failures + 1);
    return [
      {
        name: "Auto-Verification Error",
        description: "Post-edit diagnostic verification",
        content: `Auto-verification failed for ${filePath}: ${(error as Error).message}`,
      },
    ];
  }
}

/** Reset circuit-breaker state (e.g. on extension deactivate / tests). */
export function resetPostEditVerificationCircuit(): void {
  fileFailureCounts.clear();
}
