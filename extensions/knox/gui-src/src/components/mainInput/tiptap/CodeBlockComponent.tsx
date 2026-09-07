import { NodeViewWrapper, NodeViewWrapperProps } from "@tiptap/react";
import { ContextItemWithId } from "core";

import { vscBadgeBackground } from "../..";
import CodeSnippetPreview from "../../markdown/CodeSnippetPreview";

export const CodeBlockComponent = (props: any) => {
  const { node, deleteNode, selected } = props;
  const item: ContextItemWithId = node.attrs.item;
  const inputId = node.attrs.inputId;
  const isFirstContextItem = false;
  const nodeViewWrapperTag: NodeViewWrapperProps["as"] = "div";

  return (
    <NodeViewWrapper
      className="code-block-with-content"
      as={nodeViewWrapperTag}
    >
      <CodeSnippetPreview
        inputId={inputId}
        borderColor={
          isFirstContextItem
            ? "#d0d"
            : selected
              ? vscBadgeBackground
              : undefined
        }
        item={item}
        onDelete={() => {
          deleteNode();
        }}
      />
    </NodeViewWrapper>
  );
};
