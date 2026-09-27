import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";

import { t } from "../i18n";
import {
  isScreenshotCancelledError,
  runScreenshotCapture,
  screenshotCapturePlan,
  screenshotErrorMessage,
  screenshotResultFromFile,
  screenshotTempFilePath,
  SEND_TO_WEBVIEW_COMMAND,
} from "./screenshot";

/**
 * KN-354: vscode adapter over `screenshot.ts`.
 *
 * Captures a screen region and injects it into native chat as
 * `addImageAttachment` via `knox.sendToWebview`. Command registration
 * lives in `activateAgentMode`.
 */
export class ScreenshotService implements vscode.Disposable {
  private static instance: ScreenshotService | undefined;
  private disposables: vscode.Disposable[] = [];

  public static getInstance(): ScreenshotService {
    if (!ScreenshotService.instance) {
      ScreenshotService.instance = new ScreenshotService();
    }
    return ScreenshotService.instance;
  }

  private constructor() {}

  public async captureAndSend(): Promise<void> {
    const tempFile = screenshotTempFilePath(os.tmpdir(), Date.now());

    try {
      await this.captureRegion(tempFile);

      const exists = fs.existsSync(tempFile);
      const buffer = exists ? fs.readFileSync(tempFile) : undefined;
      const result = screenshotResultFromFile(exists, buffer);
      if (result.kind === "cancelled") {
        return;
      }

      await vscode.commands.executeCommand(
        SEND_TO_WEBVIEW_COMMAND,
        result.payload,
      );

      vscode.window.showInformationMessage(t("screenshot.captured"));
    } catch (e) {
      if (isScreenshotCancelledError(e)) {
        return;
      }
      vscode.window.showErrorMessage(
        t("screenshot.failed", {
          message: screenshotErrorMessage(e),
        }),
      );
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private captureRegion(outputPath: string): Promise<void> {
    const plan = screenshotCapturePlan(process.platform, outputPath);
    return runScreenshotCapture(plan, execFileAsPromise, process.platform);
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    if (ScreenshotService.instance === this) {
      ScreenshotService.instance = undefined;
    }
  }
}

function execFileAsPromise(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
