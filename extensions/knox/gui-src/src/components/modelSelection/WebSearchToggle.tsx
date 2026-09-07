import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { setWebSearchEnabled } from "../../redux/slices/uiSlice";
import { modelSupportsWebSearch } from "../../util/webSearch";

interface WebSearchToggleProps {
  disabled?: boolean;
}

function WebSearchToggle({ disabled = false }: WebSearchToggleProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const defaultModel = useAppSelector(selectDefaultModel);
  const webSearchEnabled = useAppSelector((state) => state.ui.webSearchEnabled);
  const supportsWebSearch = modelSupportsWebSearch(defaultModel);

  if (!supportsWebSearch) {
    return null;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => dispatch(setWebSearchEnabled(!webSearchEnabled))}
      title={
        webSearchEnabled
          ? t("webSearchTooltipActive", "Click to disable web search")
          : t("webSearchTooltipInactive", "Enable web search for this model")
      }
      className={cn(
        "all-unset flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded px-0 py-0 transition-colors hover:brightness-110 disabled:cursor-wait disabled:opacity-60",
        webSearchEnabled
          ? "bg-knoxcyan/10 text-knoxcyan"
          : "text-lightgray hover:text-knoxcyan",
      )}
      style={webSearchEnabled ? { color: "#159994" } : undefined}
    >
      <Globe className="h-3 w-3 shrink-0" />
    </button>
  );
}

export default WebSearchToggle;
