import { ReactNode, useMemo } from "react";
import { Tooltip } from "react-tooltip";

import { getFontSize } from "../../../util";

interface ToolbarButtonWithTooltipProps {
  onClick: () => void;
  children: ReactNode;
  tooltipContent: string;
}

export function ToolbarButtonWithTooltip({
  onClick,
  children,
  tooltipContent,
}: ToolbarButtonWithTooltipProps) {
  const tooltipId = useMemo(
    () => `tooltip-${Math.random().toString(36).slice(2, 11)}`,
    [],
  );

  return (
    <>
      <button
        onClick={onClick}
        data-tooltip-id={tooltipId}
        className="flex items-center border-none outline-none bg-transparent text-lightgray px-0.5 cursor-pointer hover:brightness-125"
        style={{ fontSize: `${getFontSize() - 2}px` }}
      >
        {children}
      </button>
      <Tooltip id={tooltipId} place="top">
        {tooltipContent}
      </Tooltip>
    </>
  );
}
