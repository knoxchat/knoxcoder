import * as assert from "node:assert";

import {
  CLIPBOARD_CACHE_ADD_MESSAGE,
  CLIPBOARD_COPY_COMMAND,
  COPY_BUFFER_STATE_KEY,
  copyBufferSpyResult,
  copyBufferStateFromText,
  EMPTY_COPY_BUFFER_DATE,
  emptyCopyBufferState,
  shouldAddClipboardCache,
} from "./copyBuffer";

suite("KN-356 copy-buffer spy", () => {
  test("command, state key, and cache message stay stable", () => {
    assert.strictEqual(CLIPBOARD_COPY_COMMAND, "editor.action.clipboardCopyAction");
    assert.strictEqual(COPY_BUFFER_STATE_KEY, "knoxchat.copyBuffer");
    assert.strictEqual(CLIPBOARD_CACHE_ADD_MESSAGE, "clipboardCache/add");
    assert.strictEqual(EMPTY_COPY_BUFFER_DATE, "1900-01-01T00:00:00.000Z");
  });

  test("empty clipboard is stored but not cached for @clipboard", () => {
    assert.strictEqual(shouldAddClipboardCache(""), false);
    const empty = copyBufferSpyResult("", "2026-01-01T00:00:00.000Z");
    assert.strictEqual(empty.cache, undefined);
    assert.deepStrictEqual(empty.state, {
      text: "",
      copiedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(emptyCopyBufferState(), {
      text: "",
      copiedAt: EMPTY_COPY_BUFFER_DATE,
    });
  });

  test("non-empty copy writes cache payload and workspace state", () => {
    assert.strictEqual(shouldAddClipboardCache("hello"), true);
    const copiedAt = "2026-09-27T00:00:00.000Z";
    assert.deepStrictEqual(copyBufferSpyResult("hello", copiedAt), {
      cache: { content: "hello" },
      state: { text: "hello", copiedAt },
    });
    assert.deepStrictEqual(copyBufferStateFromText("hello", copiedAt), {
      text: "hello",
      copiedAt,
    });
  });
});
