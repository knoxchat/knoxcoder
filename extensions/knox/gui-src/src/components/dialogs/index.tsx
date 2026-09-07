import React, { isValidElement, useEffect, ReactElement } from "react";
import ReactMarkdown from "react-markdown";

import {
  CloseButton,
  VSC_BACKGROUND_VAR,
  lightGray,
  parseColorForHex,
} from "..";
import { XMarkIcon } from "../../svg-icons";

interface TextDialogProps {
  showDialog: boolean;
  onEnter: () => void;
  onClose: () => void;
  message?: string | ReactElement;
}

const TextDialog = (props: TextDialogProps) => {

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [props]);

  if (!isValidElement(props.message) && typeof props.message !== "string") {
    return null;
  }

  return (
    <div 
      className="fixed w-full h-full z-[1000]"
      style={{ 
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(2px)'
      }}
      onClick={props.onClose} 
      hidden={!props.showDialog}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 xs:w-[90%] no-scrollbar max-h-full w-[92%] max-w-[600px] overflow-auto sm:w-[88%] md:w-[80%]"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div 
          className="flex flex-col rounded mx-auto break-words"
          style={{
            color: 'var(--vscode-editor-foreground, #fff)',
            backgroundColor: 'var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30, 30, 30)))',
            border: `1px solid var(--vscode-input-border, ${lightGray})`
          }}
        >
          <CloseButton onClick={props.onClose}>
            <span className="z-50 h-5 w-5 hover:brightness-125">
              <XMarkIcon />
            </span>
          </CloseButton>

          {typeof props.message === "string" ? (
            <ReactMarkdown>{props.message || ""}</ReactMarkdown>
          ) : !React.isValidElement(props.message) ? null : (
            props.message
          )}
        </div>
      </div>
    </div>
  );
};

export default TextDialog;
