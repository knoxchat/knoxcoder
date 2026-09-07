import { Editor } from "@tiptap/react";
import { KeyboardEvent } from "react";

import { isMetaEquivalentKeyPressed } from "../../../util";
import {
  handleVSCMetaKeyIssues,
} from "../util/handleMetaKeyIssues";

export function useEditorEventHandlers(options: {
  editor: Editor | null;
  isOSREnabled: boolean;
  editorFocusedRef: React.MutableRefObject<boolean | undefined>;
  isInEditMode: boolean;
  setActiveKey: (key: string | null) => void;
}) {
  const { editor, isOSREnabled, editorFocusedRef, isInEditMode, setActiveKey } =
    options;

  const handleKeyDown = async (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editor) {
      return;
    }

    setActiveKey(e.key);

    if (!editorFocusedRef?.current || !isMetaEquivalentKeyPressed(e)) {return;}

    if (isOSREnabled) {
    } else {
      await handleVSCMetaKeyIssues(e, editor);
    }
  };

  const handleKeyUp = () => setActiveKey(null);

  return { handleKeyDown, handleKeyUp };
}
