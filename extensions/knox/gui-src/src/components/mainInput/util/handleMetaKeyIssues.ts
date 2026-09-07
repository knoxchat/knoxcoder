import { Editor } from "@tiptap/react";
import { KeyboardEvent } from "react";

import { isWebEnvironment } from "../../../util";

const isWebEnv = isWebEnvironment();

/**
 * This handles reported issues with cut/copy/paste in .ipynb files in VSC
 */
export const handleVSCMetaKeyIssues = async (
  e: KeyboardEvent,
  editor: Editor,
) => {
  const text = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
  );

  const handlers: Record<string, () => Promise<void>> = {
    x: () => handleCutOperation(text, editor),
    c: () => handleCopyOperation(text),
    v: () => handlePasteOperation(editor),
    z: () => {
      return e.shiftKey
        ? handleRedoOperation(editor)
        : handleUndoOperation(editor);
    },
  };

  if (e.key in handlers) {
    e.stopPropagation();
    e.preventDefault();
    await handlers[e.key]();
  }
};

export const handleCutOperation = async (text: string, editor: Editor) => {
  if (isWebEnv) {
    await navigator.clipboard.writeText(text);
    editor.commands.deleteSelection();
  } else {
    document.execCommand("cut");
  }
};

export const handleCopyOperation = async (text: string) => {
  if (isWebEnv) {
    await navigator.clipboard.writeText(text);
  } else {
    document.execCommand("copy");
  }
};

export const handlePasteOperation = async (editor: Editor) => {
  if (isWebEnv) {
    const clipboardText = await navigator.clipboard.readText();
    editor.commands.insertContent(clipboardText);
  } else {
    document.execCommand("paste");
  }
};

export const handleUndoOperation = async (editor: Editor) => {
  editor.commands.undo();
};

export const handleRedoOperation = async (editor: Editor) => {
  editor.commands.redo();
};
