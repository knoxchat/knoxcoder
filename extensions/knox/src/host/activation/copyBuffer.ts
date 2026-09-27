/**
 * KN-356: vscode-free copy-buffer spy helpers.
 *
 * The host intercepts `editor.action.clipboardCopyAction`, then stores the
 * clipboard in workspaceState (`IDE.getClipboardContent`) and Core
 * `clipboardCache/add` (the `@clipboard` submenu).
 */

export const CLIPBOARD_COPY_COMMAND = "editor.action.clipboardCopyAction";
export const COPY_BUFFER_STATE_KEY = "knoxchat.copyBuffer";
export const CLIPBOARD_CACHE_ADD_MESSAGE = "clipboardCache/add" as const;
export const EMPTY_COPY_BUFFER_DATE = "1900-01-01T00:00:00.000Z";

export interface CopyBufferState {
  text: string;
  copiedAt: string;
}

export interface ClipboardCacheAddPayload {
  content: string;
}

export interface CopyBufferSpyResult {
  cache?: ClipboardCacheAddPayload;
  state: CopyBufferState;
}

export function emptyCopyBufferState(
  copiedAt: string = EMPTY_COPY_BUFFER_DATE,
): CopyBufferState {
  return { text: "", copiedAt };
}

export function copyBufferStateFromText(
  text: string,
  copiedAt: string,
): CopyBufferState {
  return { text, copiedAt };
}

export function shouldAddClipboardCache(text: string): boolean {
  return Boolean(text);
}

export function copyBufferSpyResult(
  clipboardText: string,
  copiedAt: string,
): CopyBufferSpyResult {
  return {
    cache: shouldAddClipboardCache(clipboardText)
      ? { content: clipboardText }
      : undefined,
    state: copyBufferStateFromText(clipboardText, copiedAt),
  };
}
