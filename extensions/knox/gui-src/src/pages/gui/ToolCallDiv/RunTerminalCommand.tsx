import { ContextItemWithId, ToolCallState } from "core";
import { DEFAULT_UI_SETTINGS } from "core/config/sharedConfig";
import { XTermTerminal } from "../../../components/xterm/XTermTerminal";
import { useAppSelector } from "../../../redux/hooks";
import { selectUIConfig } from "../../../redux/slices/configSlice";
import "../../../components/xterm/xterm-custom.css";
import { extractTerminalOutput } from "./extractTerminalOutput";

export { extractTerminalOutput } from "./extractTerminalOutput";

interface RunTerminalCommandToolCallProps {
  command: string;
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}

export function RunTerminalCommand(props: RunTerminalCommandToolCallProps) {
  const command = props.command ?? "";
  const toolStatus = props.toolCallState.status;
  const isStreaming = toolStatus === "generating" || toolStatus === "calling";
  const isDone = toolStatus === "done";
  const isCanceled = toolStatus === "canceled";

  // Get code wrap setting from config
  const uiConfig = useAppSelector(selectUIConfig);
  const codeWrap = uiConfig?.codeWrap ?? DEFAULT_UI_SETTINGS.codeWrap;

  // Prefer the completed tool-message items; while calling, stream from toolCallState.output
  const terminalOutput =
    extractTerminalOutput(props.toolOutputContextItems) ||
    extractTerminalOutput(props.toolCallState.output);

  return (
    <XTermTerminal
      command={command}
      content={terminalOutput}
      isStreaming={isStreaming}
      isDone={isDone}
      isCanceled={isCanceled}
      showHeader={true}
      minHeight={80}
      maxHeight={400}
      wordWrap={codeWrap}
    />
  );
}
