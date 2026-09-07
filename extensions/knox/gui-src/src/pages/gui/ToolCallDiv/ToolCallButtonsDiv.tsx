import { useTranslation } from "react-i18next";

import { lightGray } from "../../../components";
import Spinner from "../../../components/gui/Spinner";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { selectCurrentToolCall } from "../../../redux/selectors/selectCurrentToolCall";
import { cancelStream } from "../../../redux/thunks/cancelStream";
import { isSamePermissionTool } from "../../../redux/util/permissionMode";
import { formatToolName, getCategorizedToolName } from "../../../util/toolNameFormatter";

import { PermissionActionButtons } from "./PermissionActionButtons";

interface ToolCallButtonsProps {}

export function ToolCallButtons(props: ToolCallButtonsProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const toolCallState = useAppSelector(selectCurrentToolCall);
  const availableTools = useAppSelector((state) => state.config.config.tools);

  if (!toolCallState) {
    return null;
  }

  const tool = availableTools.find((candidate) =>
    isSamePermissionTool(
      candidate.function.name,
      toolCallState.toolCall.function.name,
    ),
  );
  const toolLabel = tool
    ? getCategorizedToolName(tool)
    : formatToolName(toolCallState.toolCall.function.name);

  return (
    <>
      <div className="flex flex-col gap-1">
        {toolCallState.status === "generating" ? (
          <div
            className="flex w-full items-center justify-center gap-4"
            style={{
              color: lightGray,
              minHeight: "40px",
            }}
          >
            {t("thinkingEllipsis")}
          </div>
        ) : toolCallState.status === "generated" ? (
          <>
            <div className="text-secgray mx-2 mt-2 text-[11px]">
              {t("permissionForTool", { name: toolLabel })}
            </div>
            <PermissionActionButtons
              toolName={toolCallState.toolCall.function.name}
            />
          </>
        ) : toolCallState.status === "calling" ? (
          <div className="flex w-full items-center gap-2 m-2">
            <button
              type="button"
              onClick={() => dispatch(cancelStream())}
              className="p-1 rounded-md flex-1 cursor-pointer hover:opacity-80 text-lightgray border border-lightgray bg-transparent"
            >
              {t("cancel")}
            </button>
            <div className="ml-auto flex items-center gap-4 px-2">
              {t("loading")}
              <Spinner />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
