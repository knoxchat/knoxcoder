import { ChevronDown, ChevronUp } from "lucide-react";
import { ToolCallDelta, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import Mustache from "mustache";
import { ReactNode, useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ToolTip } from "../../../components/gui/Tooltip";
import { useScrollContext } from "../../../contexts/ScrollContext";
import { useAppSelector } from "../../../redux/hooks";
import { formatToolName } from "../../../util/toolNameFormatter";
import { displayArgsForToolCall } from "./extractStreamingToolCode";

interface ToolCallDisplayProps {
  children: React.ReactNode;
  icon: React.ReactNode;
  toolCall: ToolCallDelta;
  toolCallState: ToolCallState;
}

export function ToolCallDisplay(props: ToolCallDisplayProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const availableTools = useAppSelector((state) => state.config.config.tools);
  const containerRef = useRef<HTMLDivElement>(null);
  const isGeneratingOrCalling = props.toolCallState.status === "generating" || props.toolCallState.status === "calling";
  
  // Use the global scroll context
  const { 
    setIsGenerating
  } = useScrollContext();

  // Update global generating state when this component is generating
  useEffect(() => {
    setIsGenerating(isGeneratingOrCalling);
    
    return () => {
      if (isGeneratingOrCalling) {
        setIsGenerating(false);
      }
    };
  }, [isGeneratingOrCalling, setIsGenerating]);

  const tool = useMemo(() => {
    return availableTools.find(
      (tool: { function: { name: string | undefined; }; }) => props.toolCall.function?.name === tool.function.name,
    );
  }, [availableTools, props.toolCall]);

  const statusMessage = useMemo(() => {
    if (!tool) {return t('agentToolUsage');}

    // Use the formatted tool name for a more professional display
    const formattedToolName = formatToolName(tool);
    const displayArgs = displayArgsForToolCall(
      props.toolCallState.parsedArgs,
      props.toolCall.function?.arguments,
    );
    
    const defaultToolDescription = (
      <>
        <code>{tool.displayTitle || formattedToolName}</code> {t('tool')}
      </>
    );

    const renderedWouldLikeTo = tool.wouldLikeTo
      ? Mustache.render(tool.wouldLikeTo, displayArgs).trim()
      : "";
    const futureMessage = renderedWouldLikeTo ? (
      renderedWouldLikeTo
    ) : (
      <>
        <span>{t('toolUse')}</span> {defaultToolDescription}
      </>
    );

    let intro = "";
    let message: ReactNode = "";

    if (props.toolCallState.status === "generating") {
      intro = t('toolGenerating');
      message = futureMessage;
    } else if (props.toolCallState.status === "generated") {
      intro = t('toolWouldLikeTo');
      message = futureMessage;
    } else if (props.toolCallState.status === "calling") {
      intro = t('toolFor');
      message = tool.isCurrently ? (
        Mustache.render(tool.isCurrently, displayArgs)
      ) : (
        <>
          <span>{t('toolUsing')}</span> {defaultToolDescription}
        </>
      );
    } else if (props.toolCallState.status === "done") {
      intro = "";
      message = tool.hasAlready ? (
        Mustache.render(tool.hasAlready, displayArgs)
      ) : (
        <>
          <span>{t('toolUsed')}</span> {defaultToolDescription}
        </>
      );
    } else if (props.toolCallState.status === "canceled") {
      intro = t('toolCanceled');
      message = futureMessage;
    }
    
    // Render message - if it's a string (from Mustache), use dangerouslySetInnerHTML for HTML support
    const messageElement = typeof message === 'string' 
      ? <span dangerouslySetInnerHTML={{ __html: message }} />
      : message;
    
    return (
      <div className="block">
        <span>{t('knox')}</span> {intro} {messageElement}
      </div>
    );
  }, [props.toolCallState, tool]);

  const args: [string, any][] = useMemo(() => {
    return Object.entries(
      displayArgsForToolCall(
        props.toolCallState.parsedArgs,
        props.toolCall.function?.arguments,
      ),
    );
  }, [props.toolCall.function?.arguments, props.toolCallState.parsedArgs]);

  const argsTooltipId = useMemo(() => {
    return "args-hover-" + props.toolCallState.toolCallId;
  }, [props.toolCallState]);

  // For CreateNewFile when done, hide the parameters section since filepath is shown in CreateFile component
  const isCreateFileDone = useMemo(() => {
    return (
      props.toolCall.function?.name === BuiltInToolNames.CreateNewFile &&
      props.toolCallState.status === "done"
    );
  }, [props.toolCall.function?.name, props.toolCallState.status]);

  const hideAskUserParameters =
    props.toolCall.function?.name === BuiltInToolNames.AskUser;

  const shouldShowParameters = useMemo(() => {
    return !!args.length && !isCreateFileDone && !hideAskUserParameters;
  }, [args.length, hideAskUserParameters, isCreateFileDone]);

  return (
    <>
      <div className="relative flex flex-col justify-center p-4 pb-0" ref={containerRef}>
        <div className="mb-4 flex flex-col">
          <div className="flex flex-row items-center justify-between gap-3">
            <div className="flex flex-row gap-2 min-w-0 flex-1">
              <div
                style={{
                  width: `16px`,
                  height: `16px`,
                  fontWeight: "bolder",
                  marginTop: "1px",
                  flexShrink: 0,
                }}
              >
                {props.icon}
              </div>
              {tool?.faviconUrl && (
                <img src={tool.faviconUrl} className="h-4 w-4 rounded-xs shrink-0" alt={t('toolIcon')} />
              )}
              <div className="flex min-w-0 flex-1 overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">{statusMessage}</div>
            </div>
            {shouldShowParameters ? (
              <div
                data-tooltip-id={argsTooltipId}
                onClick={() => setIsExpanded(!isExpanded)}
                className="ml-2 cursor-pointer hover:opacity-80"
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-knoxcyan" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-knoxcyan" />
                )}
              </div>
            ) : null}
            {shouldShowParameters && (
              <ToolTip id={argsTooltipId}>
                {isExpanded ? t('hideParameters') : t('showParameters')}
              </ToolTip>
            )}
          </div>

          {isExpanded && shouldShowParameters && (
            <div className="ml-7 mt-1">
              {args.map(([key, value]) => (
                <div key={key} className="flex gap-2 py-0.5">
                  <span className="text-lightgray">{key}:</span>
                  <code className="line-clamp-1">{typeof value === 'string' ? value : JSON.stringify(value)}</code>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>{props.children}</div>
      </div>
    </>
  );
}