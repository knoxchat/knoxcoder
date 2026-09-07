import { ContextItemWithId } from "core";

import ContextItemsPeek from "../../../components/mainInput/belowMainInput/ContextItemsPeek";
import { isVisibleTaskPlanPeekItem } from "../../../redux/util/taskPlan";

interface ToolOutputProps {
  contextItems: ContextItemWithId[];
  toolCallId: string;
}

function ToolOutput(props: ToolOutputProps) {
  const contextItems = props.contextItems.filter(isVisibleTaskPlanPeekItem);
  if (contextItems.length === 0) {
    return null;
  }

  return (
    <div>
      <ContextItemsPeek
        isCurrentContextPeek={false}
        contextItems={contextItems}
      />
    </div>
  );
}

export default ToolOutput;
