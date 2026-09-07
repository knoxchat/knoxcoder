import { ContextItemWithId, ToolCallDelta, ToolCallState, ToolStatus } from "core";

import Spinner from "../../../components/gui/Spinner";
import { ArrowRightIcon, CheckIcon, XMarkIcon } from "../../../svg-icons";

import FunctionSpecificToolCallDiv from "./FunctionSpecificToolCallDiv";
import { ToolCallDisplay } from "./ToolCall";

interface ToolCallDivProps {
  toolCall: ToolCallDelta;
  toolCallState: ToolCallState;
  toolOutputContextItems?: ContextItemWithId[];
}

export function ToolCallDiv(props: ToolCallDivProps) {
  function getIcon(state: ToolStatus) {
    switch (state) {
      case "generating":
      case "calling":
        return <Spinner />;
      case "generated":
        return <span className="h-3.5 w-3.5"><ArrowRightIcon /></span>;
      case "done":
        return <CheckIcon />;
      case "canceled":
        return <XMarkIcon />;
    }
  }

  return (
    <ToolCallDisplay
      icon={getIcon(props.toolCallState.status)}
      toolCall={props.toolCall}
      toolCallState={props.toolCallState}
    >
      <FunctionSpecificToolCallDiv
        toolCall={props.toolCall}
        toolCallState={props.toolCallState}
        toolOutputContextItems={props.toolOutputContextItems || []}
      />
    </ToolCallDisplay>
  );
}
