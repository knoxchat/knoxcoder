import { ToolCallDelta, ToolCallState } from "core";
import { getMarkdownLanguageTagForFile } from "core/util";
import { useMemo } from "react";

import StyledMarkdownPreview from "../../../components/markdown/StyledMarkdownPreview";

import { collapseFileToolCodePreview } from "./collapseFileToolCodePreview";
import {
  calculateFence,
  extractStreamingToolCode,
} from "./extractStreamingToolCode";

function getDisplayLanguage(filepath: string, contentKey?: string): string {
  if (contentKey === "patch" || contentKey === "diff") {
    return "diff";
  }
  if (!filepath) {
    return "";
  }
  const lang = getMarkdownLanguageTagForFile(filepath);
  if (lang === "markdown") {
    return "text";
  }
  return lang;
}

interface GenericCodePreviewProps {
  toolCall: ToolCallDelta;
  toolCallState: ToolCallState;
}

export function GenericCodePreview(props: GenericCodePreviewProps) {
  const isStreaming =
    props.toolCallState.status === "generating" ||
    props.toolCallState.status === "calling";

  const { filepath, codeContent, contentKey, started } = useMemo(
    () =>
      extractStreamingToolCode({
        parsedArgs: props.toolCallState.parsedArgs,
        rawArguments: props.toolCall.function?.arguments,
      }),
    [props.toolCall.function?.arguments, props.toolCallState.parsedArgs],
  );

  if (!started && !codeContent && !filepath) {
    return null;
  }
  if (!codeContent && !filepath && !isStreaming) {
    return null;
  }

  const language = getDisplayLanguage(filepath, contentKey);
  const fence = calculateFence(codeContent);
  const label = filepath || (contentKey === "patch" || contentKey === "diff" ? "patch" : "");
  const src = `${fence}${language} ${label}\n${codeContent}\n${fence}`;

  return (
    <StyledMarkdownPreview
      isRenderingInStepContainer={true}
      source={src}
      isStreaming={isStreaming}
      expanded={
        collapseFileToolCodePreview(props.toolCall.function?.name)
          ? false
          : undefined
      }
    />
  );
}
