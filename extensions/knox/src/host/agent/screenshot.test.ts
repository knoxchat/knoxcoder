import * as assert from "node:assert";
import * as path from "node:path";

import {
  ADD_IMAGE_ATTACHMENT_MESSAGE,
  addImageAttachmentPayload,
  CAPTURE_SCREENSHOT_COMMAND,
  isDarwinScreenshotCancel,
  isScreenshotCancelledError,
  pngBufferToDataUrl,
  runScreenshotCapture,
  SCREENSHOT_ATTACHMENT_NAME,
  SCREENSHOT_CANCELLED,
  SCREENSHOT_LINUX_MISSING_TOOL,
  SCREENSHOT_UNSUPPORTED_MESSAGE,
  screenshotCapturePlan,
  screenshotErrorMessage,
  screenshotResultFromFile,
  screenshotTempFilePath,
  SEND_TO_WEBVIEW_COMMAND,
} from "./screenshot";

suite("KN-354 screenshot attachment", () => {
  test("command and protocol ids stay contributed", () => {
    assert.strictEqual(CAPTURE_SCREENSHOT_COMMAND, "knox.captureScreenshot");
    assert.strictEqual(SEND_TO_WEBVIEW_COMMAND, "knox.sendToWebview");
    assert.strictEqual(ADD_IMAGE_ATTACHMENT_MESSAGE, "addImageAttachment");
    assert.strictEqual(SCREENSHOT_ATTACHMENT_NAME, "screenshot.png");
  });

  test("screenshotCapturePlan uses interactive OS tools", () => {
    assert.deepStrictEqual(screenshotCapturePlan("darwin", "/tmp/out.png"), [
      { file: "screencapture", args: ["-i", "/tmp/out.png"] },
    ]);
    assert.deepStrictEqual(screenshotCapturePlan("linux", "/tmp/out.png"), [
      { file: "gnome-screenshot", args: ["-a", "-f", "/tmp/out.png"] },
      { file: "import", args: ["/tmp/out.png"] },
    ]);
    assert.deepStrictEqual(screenshotCapturePlan("win32", "/tmp/out.png"), []);
  });

  test("pngBufferToDataUrl and addImageAttachmentPayload match GUI inbound", () => {
    const url = pngBufferToDataUrl(Buffer.from("png-bytes"));
    assert.strictEqual(url, `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
    assert.deepStrictEqual(addImageAttachmentPayload(url), {
      messageType: "addImageAttachment",
      data: { imageUrl: url, name: "screenshot.png" },
    });
  });

  test("missing capture file is treated as user cancel", () => {
    assert.deepStrictEqual(screenshotResultFromFile(false), { kind: "cancelled" });
    const attachment = screenshotResultFromFile(true, Buffer.from("x"));
    assert.strictEqual(attachment.kind, "attachment");
    if (attachment.kind === "attachment") {
      assert.strictEqual(attachment.payload.messageType, "addImageAttachment");
      assert.ok(attachment.payload.data.imageUrl.startsWith("data:image/png;base64,"));
    }
  });

  test("runScreenshotCapture maps darwin cancel, linux fallback, and unsupported", async () => {
    await assert.rejects(
      () => runScreenshotCapture([], async () => undefined, "win32"),
      (error: unknown) =>
        error instanceof Error && error.message === SCREENSHOT_UNSUPPORTED_MESSAGE,
    );

    await assert.rejects(
      () =>
        runScreenshotCapture(
          screenshotCapturePlan("darwin", "/tmp/out.png"),
          async () => {
            throw Object.assign(new Error("exit"), { code: 1 });
          },
          "darwin",
        ),
      (error: unknown) => isScreenshotCancelledError(error),
    );

    const linuxCalls: string[] = [];
    await runScreenshotCapture(
      screenshotCapturePlan("linux", "/tmp/out.png"),
      async (file) => {
        linuxCalls.push(file);
        if (file === "gnome-screenshot") {
          throw new Error("missing");
        }
      },
      "linux",
    );
    assert.deepStrictEqual(linuxCalls, ["gnome-screenshot", "import"]);

    await assert.rejects(
      () =>
        runScreenshotCapture(
          screenshotCapturePlan("linux", "/tmp/out.png"),
          async () => {
            throw new Error("missing");
          },
          "linux",
        ),
      (error: unknown) =>
        error instanceof Error && error.message === SCREENSHOT_LINUX_MISSING_TOOL,
    );
  });

  test("cancel / error helpers", () => {
    assert.strictEqual(isDarwinScreenshotCancel({ code: 1 }, "darwin"), true);
    assert.strictEqual(isDarwinScreenshotCancel({ code: 1 }, "linux"), false);
    assert.strictEqual(isScreenshotCancelledError(new Error(SCREENSHOT_CANCELLED)), true);
    assert.strictEqual(screenshotErrorMessage(new Error("boom")), "boom");
    assert.strictEqual(screenshotErrorMessage("nope"), "nope");
    assert.ok(
      screenshotTempFilePath("/tmp", 42).endsWith(path.join("knox-screenshot-42.png")),
    );
  });
});
