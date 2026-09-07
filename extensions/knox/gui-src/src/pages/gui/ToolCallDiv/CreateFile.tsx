import { ToolCallDelta, ToolCallState } from "core";
import { getMarkdownLanguageTagForFile } from "core/util";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import ClickableFilePath from "../../../components/markdown/ClickableFilePath";
import StyledMarkdownPreview from "../../../components/markdown/StyledMarkdownPreview";

import {
  calculateFence,
  extractStreamingToolCode,
} from "./extractStreamingToolCode";

interface CreateFileToolCallProps {
  toolCall: ToolCallDelta;
  toolCallState: ToolCallState;
  relativeFilepath?: string;
  fileContents?: string;
}

function getDisplayLanguage(filepath: string): string {
  if (!filepath) {
    return "";
  }
  const lang = getMarkdownLanguageTagForFile(filepath);
  if (lang === "markdown") {
    return "text";
  }
  return lang;
}

export function CreateFile(props: CreateFileToolCallProps) {
  const { t } = useTranslation();
  const isStreaming =
    props.toolCallState.status === "generating" ||
    props.toolCallState.status === "calling";

  const extracted = useMemo(
    () =>
      extractStreamingToolCode({
        parsedArgs: props.toolCallState.parsedArgs,
        rawArguments: props.toolCall.function?.arguments,
      }),
    [props.toolCall.function?.arguments, props.toolCallState.parsedArgs],
  );

  const filepath = props.relativeFilepath || extracted.filepath;
  const contents = props.fileContents ?? extracted.codeContent;

  if (!filepath && !contents && !extracted.started) {
    return null;
  }

  const language = getDisplayLanguage(filepath);
  const fence = calculateFence(contents);
  const src = `${fence}${language} ${filepath}\n${contents}\n${fence}`;

  return (
    <div className="flex flex-col gap-2">
      {filepath ? (
        <div className="flex flex-row items-center gap-2 px-1">
          <span className="text-sm font-medium text-knoxcyan whitespace-nowrap">
            {t("createdFile")}
          </span>
          <ClickableFilePath
            filepath={filepath}
            className="text-sm font-mono"
          />
        </div>
      ) : null}
      <StyledMarkdownPreview
        isRenderingInStepContainer={true}
        source={src}
        isStreaming={isStreaming}
      />
    </div>
  );
}
