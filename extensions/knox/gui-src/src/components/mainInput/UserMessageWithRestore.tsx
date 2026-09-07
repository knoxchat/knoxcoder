import { JSONContent } from "@tiptap/react";
import { ChatHistoryItem, InputModifiers } from "core";

import KnoxInputBox from "./KnoxInputBox";

interface UserMessageWithRestoreProps {
  item: ChatHistoryItem;
  index: number;
  isEditMode?: boolean;
  onEnter: (
    editorState: JSONContent,
    modifiers: InputModifiers,
  ) => void;
  isLastUserInput: boolean;
}

export default function UserMessageWithRestore({
  item,
  index,
  isEditMode,
  onEnter,
  isLastUserInput,
}: UserMessageWithRestoreProps) {
  // User messages no longer create checkpoints
  // Only assistant responses create checkpoints

  return (
    <div className="relative group">
      <KnoxInputBox
        isEditMode={isEditMode}
        onEnter={onEnter}
        isLastUserInput={isLastUserInput}
        isMainInput={false}
        editorState={item.editorState}
        contextItems={item.contextItems}
        inputId={(item.message as any).id}
        message={item.message}
      />
    </div>
  );
}
