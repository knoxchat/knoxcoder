/**
 * KN-354: vscode-free screenshot → `addImageAttachment` helpers.
 *
 * ScreenshotService is the vscode adapter (`knox.captureScreenshot`, OS
 * capture tools, `knox.sendToWebview`). Native GUI inbound already appends
 * `{ imageUrl, name }` to composer images.
 */

import * as path from "path";

export const CAPTURE_SCREENSHOT_COMMAND = "knox.captureScreenshot";
export const SEND_TO_WEBVIEW_COMMAND = "knox.sendToWebview";
export const ADD_IMAGE_ATTACHMENT_MESSAGE = "addImageAttachment";
export const SCREENSHOT_ATTACHMENT_NAME = "screenshot.png";
export const SCREENSHOT_CANCELLED = "cancelled";
export const SCREENSHOT_UNSUPPORTED_MESSAGE =
  "Screenshot capture not supported on this platform. Use Ctrl+V to paste from clipboard.";
export const SCREENSHOT_LINUX_MISSING_TOOL =
  "No screenshot tool found. Install gnome-screenshot or ImageMagick.";

export interface ScreenshotCaptureCommand {
  file: string;
  args: string[];
}

export interface AddImageAttachmentPayload {
  messageType: typeof ADD_IMAGE_ATTACHMENT_MESSAGE;
  data: { imageUrl: string; name: string };
}

export type ScreenshotFileResult =
  | { kind: "cancelled" }
  | { kind: "attachment"; payload: AddImageAttachmentPayload };

export function screenshotTempFilePath(tmpdir: string, now: number): string {
  return path.join(tmpdir, `knox-screenshot-${now}.png`);
}

export function screenshotCapturePlan(
  platform: string,
  outputPath: string,
): ScreenshotCaptureCommand[] {
  if (platform === "darwin") {
    return [{ file: "screencapture", args: ["-i", outputPath] }];
  }
  if (platform === "linux") {
    return [
      { file: "gnome-screenshot", args: ["-a", "-f", outputPath] },
      { file: "import", args: [outputPath] },
    ];
  }
  return [];
}

export function pngBufferToDataUrl(buffer: Buffer | Uint8Array): string {
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:image/png;base64,${base64}`;
}

export function addImageAttachmentPayload(
  imageUrl: string,
  name: string = SCREENSHOT_ATTACHMENT_NAME,
): AddImageAttachmentPayload {
  return {
    messageType: ADD_IMAGE_ATTACHMENT_MESSAGE,
    data: { imageUrl, name },
  };
}

export function screenshotResultFromFile(
  exists: boolean,
  buffer?: Buffer | Uint8Array,
): ScreenshotFileResult {
  if (!exists || buffer === undefined) {
    return { kind: "cancelled" };
  }
  return {
    kind: "attachment",
    payload: addImageAttachmentPayload(pngBufferToDataUrl(buffer)),
  };
}

export function isDarwinScreenshotCancel(
  error: unknown,
  platform: string,
): boolean {
  if (platform !== "darwin") {
    return false;
  }
  const code = (error as { code?: string | number } | undefined)?.code;
  return code === 1;
}

export function isScreenshotCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === SCREENSHOT_CANCELLED;
}

export function screenshotErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runScreenshotCapture(
  plan: ScreenshotCaptureCommand[],
  execFileFn: (file: string, args: string[]) => Promise<void>,
  platform: string,
): Promise<void> {
  if (plan.length === 0) {
    throw new Error(SCREENSHOT_UNSUPPORTED_MESSAGE);
  }

  for (let i = 0; i < plan.length; i++) {
    const command = plan[i];
    try {
      await execFileFn(command.file, command.args);
      return;
    } catch (error) {
      if (isDarwinScreenshotCancel(error, platform)) {
        throw new Error(SCREENSHOT_CANCELLED);
      }
      const hasFallback = i < plan.length - 1;
      if (hasFallback) {
        continue;
      }
      if (platform === "linux") {
        throw new Error(SCREENSHOT_LINUX_MISSING_TOOL);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
