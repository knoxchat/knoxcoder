import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execFile } from "child_process";

import { t } from "../i18n";

/**
 * Provides a VS Code command to capture a screen region screenshot
 * and inject it into the Knox Chat input as an image attachment.
 */
export class ScreenshotService {
  private static instance: ScreenshotService;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    this.disposables.push(
      vscode.commands.registerCommand(
        "knox.captureScreenshot",
        () => this.captureAndSend(),
      ),
    );
  }

  static getInstance(): ScreenshotService {
    if (!ScreenshotService.instance) {
      ScreenshotService.instance = new ScreenshotService();
    }
    return ScreenshotService.instance;
  }

  private async captureAndSend(): Promise<void> {
    const tempFile = path.join(
      os.tmpdir(),
      `knox-screenshot-${Date.now()}.png`,
    );

    try {
      await this.captureRegion(tempFile);

      if (!fs.existsSync(tempFile)) {
        // User cancelled the capture
        return;
      }

      const imageBuffer = fs.readFileSync(tempFile);
      const base64 = imageBuffer.toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      // Send to the webview as an image attachment
      await vscode.commands.executeCommand("knox.sendToWebview", {
        messageType: "addImageAttachment",
        data: { imageUrl: dataUrl, name: "screenshot.png" },
      });

      vscode.window.showInformationMessage(t("screenshot.captured"));
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") {
        return;
      }
      vscode.window.showErrorMessage(
        t("screenshot.failed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      // Clean up temp file
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
    return new Promise((resolve, reject) => {
      const platform = process.platform;

      if (platform === "darwin") {
        // macOS: interactive region capture
        execFile("screencapture", ["-i", outputPath], (error) => {
          if (error) {
            // Exit code 1 means user cancelled
            if (error.code === 1) {
              reject(new Error("cancelled"));
            } else {
              reject(error);
            }
          } else {
            resolve();
          }
        });
      } else if (platform === "linux") {
        // Linux: try gnome-screenshot, then import (ImageMagick)
        execFile(
          "gnome-screenshot",
          ["-a", "-f", outputPath],
          (error) => {
            if (error) {
              // Fallback to ImageMagick import
              execFile("import", [outputPath], (err2) => {
                if (err2) {
                  reject(
                    new Error(
                      "No screenshot tool found. Install gnome-screenshot or ImageMagick.",
                    ),
                  );
                } else {
                  resolve();
                }
              });
            } else {
              resolve();
            }
          },
        );
      } else {
        // Windows or unsupported: prompt to paste manually
        reject(
          new Error(
            "Screenshot capture not supported on this platform. Use Ctrl+V to paste from clipboard.",
          ),
        );
      }
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
