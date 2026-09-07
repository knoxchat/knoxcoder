import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { saveReasoningEffort } from "../../redux/thunks/reasoningEffort";
import {
  getReasoningEffortConfig,
  getReasoningModelKeys,
  resolveReasoningEffort,
} from "../../util/reasoningEffort";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const levelLabelKeys: Record<string, string> = {
  none: "reasoningEffortLevelNone",
  minimal: "reasoningEffortLevelMinimal",
  low: "reasoningEffortLevelLow",
  medium: "reasoningEffortLevelMedium",
  high: "reasoningEffortLevelHigh",
  xhigh: "reasoningEffortLevelXHigh",
  max: "reasoningEffortLevelMax",
};

interface ReasoningEffortSelectProps {
  disabled?: boolean;
}

function ReasoningEffortSelect({
  disabled = false,
}: ReasoningEffortSelectProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const defaultModel = useAppSelector(selectDefaultModel);
  const stickyByModel = useAppSelector(
    (state) => state.ui.reasoningEffortByModel ?? {},
  );
  const legacyEffort = useAppSelector((state) => state.ui.reasoningEffort);
  const config = getReasoningEffortConfig(defaultModel);
  const value = resolveReasoningEffort(
    defaultModel,
    stickyByModel,
    legacyEffort,
  );
  const modelKeys = getReasoningModelKeys(defaultModel);

  if (!config || !value) {
    return null;
  }

  return (
    <Select
      value={value}
      onValueChange={(nextValue) =>
        dispatch(
          saveReasoningEffort({
            effort: nextValue,
            modelKeys,
          }),
        )
      }
      disabled={disabled}
    >
      <SelectTrigger
        className="text-knoxcyan h-4.5 w-auto min-w-21.5 gap-1 border-none bg-transparent px-1 py-0 shadow-none hover:brightness-110 focus:ring-0 focus:ring-offset-0 disabled:cursor-wait disabled:opacity-60 [&>svg:last-child]:h-3 [&>svg:last-child]:w-3 [&>svg:last-child]:opacity-70"
        style={{ fontSize: "inherit" }}
        title={t("reasoningEffortTooltip", "Reasoning effort")}
      >
        <Brain className="h-3 w-3 shrink-0" />
        <SelectValue placeholder={t("reasoningEffortSelect", "Effort")} />
      </SelectTrigger>
      <SelectContent className="border-lightgray bg-vsc-input-background text-vsc-foreground z-9999 min-w-26 rounded-sm">
        {config.allowed.map((level) => (
          <SelectItem
            key={level}
            value={level}
            className="focus:bg-list-active focus:text-list-active-foreground cursor-pointer rounded-sm py-1 text-xs"
          >
            {t(levelLabelKeys[level] ?? level, level)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ReasoningEffortSelect;
