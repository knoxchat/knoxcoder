import { CSSProperties, MouseEvent, useContext } from "react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import {
  openFileInEditor,
  splitDisplayPath,
} from "../../util/openFileInEditor";
import FileIcon from "../FileIcon";

export interface ClickableFilePathProps {
  filepath: string;
  /** 1-based line to reveal after opening. */
  startLine?: number;
  endLine?: number;
  /** Extra label shown after the filename, e.g. a line range. */
  range?: string;
  showIcon?: boolean;
  iconSize?: string;
  className?: string;
  dirClassName?: string;
  nameClassName?: string;
  dirStyle?: CSSProperties;
  nameStyle?: CSSProperties;
}

export default function ClickableFilePath({
  filepath,
  startLine,
  endLine,
  range,
  showIcon = false,
  iconSize = "16px",
  className = "",
  dirClassName = "",
  nameClassName = "",
  dirStyle,
  nameStyle,
}: ClickableFilePathProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const { dir, name } = splitDisplayPath(filepath);

  function onClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void openFileInEditor(ideMessenger, filepath, {
      startLine,
      endLine,
    });
  }

  return (
    <button
      type="button"
      data-testid="clickable-file-path"
      title={filepath}
      onClick={onClick}
      className={`m-0 flex min-w-0 max-w-full cursor-pointer items-center gap-0.5 border-none bg-transparent p-0 text-left font-[inherit] text-[length:inherit] leading-[inherit] ${className}`}
    >
      {showIcon && (
        <FileIcon height={iconSize} width={iconSize} filename={filepath} />
      )}
      {dir ? (
        <span
          className={`min-w-0 truncate ${dirClassName}`}
          style={dirStyle}
        >
          {dir}
        </span>
      ) : null}
      <span
        className={`shrink-0 hover:underline ${nameClassName}`}
        style={{
          color: "var(--vscode-textLink-foreground)",
          ...nameStyle,
        }}
      >
        {name}
      </span>
      {range ? (
        <span className="ml-1 shrink-0 opacity-70">{range}</span>
      ) : null}
    </button>
  );
}
