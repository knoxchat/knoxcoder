import { Editor } from "@tiptap/core";
import { InputModifiers } from "core";
import { rifWithContentsToContextItem } from "core/commands/util";
import { MutableRefObject } from "react";

import { useWebviewListener } from "../../../hooks/useWebviewListener";
import {
  clearCodeToEdit,
  setNewestCodeblocksForInput,
} from "../../../redux/slices/sessionSlice";
import { AppDispatch } from "../../../redux/store";
import { loadSession, saveCurrentSession } from "../../../redux/thunks/session";

import { TipTapEditorProps } from "./TipTapEditor";

export function useWebviewListeners(options: {
  editor: Editor | null;
  onEnterRef: MutableRefObject<(modifiers: InputModifiers) => void>;
  dispatch: AppDispatch;
  historyLength: number;
  props: TipTapEditorProps;
  editorFocusedRef: MutableRefObject<boolean | undefined>;
  addImageToThumbnails?: (imageUrl: string, name?: string) => void;
}) {
  const {
    editor,
    onEnterRef,
    dispatch,
    historyLength,
    props,
    editorFocusedRef,
    addImageToThumbnails,
  } = options;

  useWebviewListener(
    "userInput",
    async (data) => {
      if (!props.isMainInput) {
        return;
      }
      editor?.commands.insertContent(data.input);
      onEnterRef.current({ noContext: true });
    },
    [editor, onEnterRef.current, props.isMainInput],
  );

  useWebviewListener(
    "focusKnoxInput",
    async (data) => {
      if (!props.isMainInput) {
        return;
      }

      dispatch(clearCodeToEdit());

      if (historyLength > 0) {
        await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: true,
          }),
        );
      }
      setTimeout(() => {
        editor?.commands.blur();
        editor?.commands.focus("end");
      }, 20);
    },
    [historyLength, editor, props.isMainInput],
  );

  useWebviewListener(
    "focusKnoxInputWithoutClear",
    async () => {
      if (!props.isMainInput) {
        return;
      }
      setTimeout(() => {
        editor?.commands.focus("end");
      }, 20);
    },
    [editor, props.isMainInput],
  );

  useWebviewListener(
    "focusKnoxInputWithNewSession",
    async () => {
      if (!props.isMainInput) {
        return;
      }
      await dispatch(
        saveCurrentSession({
          openNewSession: true,
          generateTitle: true,
        }),
      );
      setTimeout(() => {
        editor?.commands.focus("end");
      }, 20);
    },
    [editor, props.isMainInput],
  );

  useWebviewListener(
    "highlightedCode",
    async (data) => {
      if (!props.isMainInput || !editor) {
        return;
      }

      const contextItem = rifWithContentsToContextItem(
        data.rangeInFileWithContents,
      );

      let index = 0;
      for (const el of editor.getJSON()?.content ?? []) {
        if (el.attrs?.item?.name === contextItem.name) {
          return; // Prevent exact duplicate code blocks
        }
        if (el.type === "codeBlock") {
          index += 2;
        } else {
          break;
        }
      }
      editor
        .chain()
        .insertContentAt(index, {
          type: "codeBlock",
          attrs: {
            item: contextItem,
            inputId: props.inputId,
          },
        })
        .run();
      dispatch(
        setNewestCodeblocksForInput({
          inputId: props.inputId,
          contextItemId: contextItem.id.itemId,
        }),
      );
      if (data.prompt) {
        editor.commands.focus("end");
        editor.commands.insertContent(data.prompt);
      }

      if (data.shouldRun) {
        onEnterRef.current({ noContext: true });
      }

      setTimeout(() => {
        editor.commands.blur();
        editor.commands.focus("end");
      }, 20);
    },
    [editor, props.isMainInput, historyLength, onEnterRef.current],
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      if (!props.isMainInput) {
        return;
      }

      setTimeout(() => {
        editor?.commands.focus("end");
      }, 20);
    },
    [editor, props.isMainInput],
  );

  useWebviewListener(
    "focusEditWithoutClear",
    async () => {
      if (!props.isMainInput) {
        return;
      }

      setTimeout(() => {
        editor?.commands.focus("end");
      }, 2000);
    },
    [editor, props.isMainInput],
  );

  useWebviewListener(
    "isKnoxInputFocused",
    async () => {
      return props.isMainInput && !!editorFocusedRef.current;
    },
    [editorFocusedRef, props.isMainInput],
    !props.isMainInput,
  );

  useWebviewListener(
    "focusKnoxSessionId",
    async (data) => {
      if (!props.isMainInput || !data.sessionId) {
        return;
      }
      await dispatch(
        loadSession({
          sessionId: data.sessionId,
          saveCurrentSession: true,
        }),
      );
    },
    [props.isMainInput],
  );

  useWebviewListener(
    "addImageAttachment",
    async (data) => {
      if (!props.isMainInput || !addImageToThumbnails) {
        return;
      }
      addImageToThumbnails(data.imageUrl, data.name);
      editor?.commands.focus("end");
    },
    [props.isMainInput, addImageToThumbnails, editor],
  );
}
