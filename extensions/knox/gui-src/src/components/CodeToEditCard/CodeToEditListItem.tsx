import { ChevronDown, ChevronRight, X } from "lucide-react";
import { CodeToEdit } from "core";
import { getMarkdownLanguageTagForFile } from "core/util";
import {
  getLastNUriRelativePathParts,
  getUriPathBasename,
} from "core/util/uri";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import FileIcon from "../FileIcon";
import StyledMarkdownPreview from "../markdown/StyledMarkdownPreview";

/**
 * Get appropriate language for syntax highlighting.
 * For markdown files, use 'text' to display as plain text.
 */
function getDisplayLanguage(filepath: string): string {
  const lang = getMarkdownLanguageTagForFile(filepath);
  // Markdown files should be displayed as plain text
  if (lang === "markdown") {
    return "text";
  }
  return lang;
}


export interface CodeToEditListItemProps {
  code: CodeToEdit;
  onDelete: (codeToEdit: CodeToEdit) => void | Promise<void>;
  onClickFilename: (codeToEdit: CodeToEdit) => void | Promise<void>;
}

const NoPaddingWrapper = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "*:m-0! *:p-0!",
      "[&_pre]:m-0! [&_pre]:pl-2.5! [&_pre]:py-0! [&_pre]:pr-0!",
      className
    )}
    {...props}
  />
);

export default function CodeToEditListItem({
  code,
  onDelete,
  onClickFilename,
}: CodeToEditListItemProps) {
  const { t } = useTranslation();
  const [showCodeSnippet, setShowCodeSnippet] = useState(false);

  const fileName = getUriPathBasename(code.filepath);
  const last2Parts = getLastNUriRelativePathParts(
    window.workspacePaths ?? [],
    code.filepath,
    2,
  );

  let isInsertion = false;
  let title = fileName;

  if ("range" in code) {
    const start = code.range.start.line + 1;
    const end = code.range.end.line + 1;

    isInsertion = start === end;

    title += isInsertion
      ? ` - ${t('insertingAtLine', { line: start })}`
      : ` (${start} - ${end})`;
  }

  const source =
    "```" +
    getDisplayLanguage(code.filepath) +
    "\n" +
    code.contents +
    "\n" +
    "```";

  return (
    <li
      className="group flex cursor-pointer flex-col"
      onClick={() => {
        if (!isInsertion) {
          setShowCodeSnippet((showCodeSnippet) => !showCodeSnippet);
        }
      }}
    >
      <div
        className={`hover:text-vsc-foreground flex items-center justify-between rounded-sm px-2 py-0.5 transition-colors hover:bg-opacity-20 ${showCodeSnippet && "text-vsc-foreground bg-knoxcyan/20 bg-opacity-20"}`}
      >
        <div className="flex w-4/5 min-w-0 items-center gap-0.5">
          <FileIcon filename={code.filepath} height={"18px"} width={"18px"} />
          <div className="flex min-w-0 gap-1.5">
            <span
              className="shrink-0 text-xs hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void onClickFilename(code);
              }}
            >
              {title}
            </span>
            <span className="text-lightgray invisible grow truncate text-xs group-hover:visible">
              {last2Parts}
            </span>
          </div>
        </div>

        <div className="invisible flex items-center group-hover:visible">
          <div className={`flex items-center ${isInsertion ? "hidden" : ""}`}>
            {showCodeSnippet ? (
              <ChevronDown
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCodeSnippet(false);
                }}
                className="text-knoxcyan hover:bg-knoxcyan/125 hover:text-knoxcyan/55 h-5 w-5 cursor-pointer rounded-sm p-0.5 hover:bg-opacity-20"
              />
            ) : (
              <ChevronRight
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCodeSnippet(true);
                }}
                className="text-knoxcyan hover:text-knoxcyan/125 h-5 w-5 cursor-pointer rounded-sm p-0.5 hover:bg-opacity-20"
              />
            )}
          </div>
          <div className="flex items-center">
            <X
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(code);
              }}
              className="text-red hover:text-red/115 h-5 w-5 cursor-pointer rounded-sm p-0.5 hover:bg-opacity-20"
            />
          </div>
        </div>
      </div>

      {showCodeSnippet && (
        <div className="max-h-[25vh] overflow-y-auto px-1 py-2">
          <NoPaddingWrapper>
            <StyledMarkdownPreview source={source} />
          </NoPaddingWrapper>
        </div>
      )}
    </li>
  );
}
