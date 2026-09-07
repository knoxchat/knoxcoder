import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { newSession } from "../../../redux/slices/sessionSlice";
import { saveCurrentSession } from "../../../redux/thunks/session";
import {
  ChipAIIcon,
  HistoryIcon,
  NewChatIcon,
  PencilSquareIcon,
  PromptIcon,
  RestoreIcon,
  ToolIcon,
} from "../../../svg-icons";
import { fontSize } from "../../../util";
import { ToolTip } from "../../gui/Tooltip";
import ModeSelect from "../../modelSelection/ModeSelect";
import HoverItem from "../InputToolbar/bottom/HoverItem";

const TooltipText = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("whitespace-nowrap", className)}
    style={{ color: "var(--knox-button-bg, #159994)" }}
    {...props}
  />
);

interface BlockSettingsToolbarIcon {
  tooltip: string;
  icon: React.ComponentType<any>;
  itemCount?: number;
  onClick: () => void;
  isSelected?: boolean;
  className?: string;
}

interface Section {
  id: string;
  tooltip: string;
  icon: React.ComponentType<any>;
}

const sectionKeys: { id: string; tooltipKey: string; icon: React.ComponentType<any> }[] = [
  { id: "models", tooltipKey: "models", icon: ChipAIIcon },
  { id: "rules", tooltipKey: "rules", icon: PencilSquareIcon },
  { id: "prompts", tooltipKey: "prompts", icon: PromptIcon },
  { id: "tools", tooltipKey: "tools", icon: ToolIcon },
  { id: "history", tooltipKey: "history", icon: HistoryIcon },
  { id: "checkpoints", tooltipKey: "checkpoints", icon: RestoreIcon },
];

function BlockSettingsToolbarIcon(props: BlockSettingsToolbarIcon) {
  return (
    <HoverItem px={0} onClick={props.onClick}>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onClick();
          }
        }}
        style={{
          backgroundColor: props.isSelected
            ? "var(--knox-button-soft, rgba(21, 153, 148, 0.2))"
            : undefined,
        }}
        className={`relative flex select-none items-center rounded-full px-1 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-knoxcyan/40 ${props.className || ""}`}
      >
        <props.icon
          className="h-3 w-3 hover:brightness-125"
          style={{
            color: props.isSelected
              ? "var(--knox-button-bg, #159994)"
              : undefined,
          }}
          aria-hidden="true"
        />
        <div
          style={{ fontSize: fontSize(-3) }}
          className={`overflow-hidden transition-all duration-200 ${
            props.isSelected ? "ml-1 w-auto opacity-100" : "w-0 opacity-0"
          }`}
        >
          <TooltipText>{props.tooltip}</TooltipText>
        </div>
      </div>
    </HoverItem>
  );
}

interface BlockSettingsTopToolbarProps {
  selectedSection: string | null;
  setSelectedSection: (value: string | null) => void;
}

export function BlockSettingsTopToolbar(props: BlockSettingsTopToolbarProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isExpanded = useAppSelector(
    (state) => state.ui.isBlockSettingsToolbarExpanded,
  );
  const hasHistory = useAppSelector(
    (state) => state.session.history.length > 0,
  );

  const handleNewChat = async () => {
    if (hasHistory) {
      await dispatch(
        saveCurrentSession({ openNewSession: false, generateTitle: true }),
      );
    }
    dispatch(newSession());
  };

  return (
    <div className="flex w-full items-center justify-between">
      <div className="xs:flex text-secgray hidden items-center justify-center">
        <HoverItem px={0} onClick={handleNewChat}>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleNewChat();
              }
            }}
            className="relative flex select-none items-center rounded-full px-1 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-knoxcyan/40"
            data-tooltip-id="new-chat-tooltip"
          >
            <NewChatIcon
              className="h-3 w-3 hover:brightness-125"
              aria-hidden="true"
            />
          </div>
        </HoverItem>
        <ToolTip id="new-chat-tooltip" place="top">
          {t('newChat')}
        </ToolTip>
        <div
          className="flex overflow-hidden transition-all duration-200"
          style={{ width: isExpanded ? `210px` : "0px" }}
        >
          <div className="flex">
            {sectionKeys.map((section) => (
              <BlockSettingsToolbarIcon
                key={section.id}
                icon={section.icon}
                tooltip={t(section.tooltipKey)}
                isSelected={props.selectedSection === section.id}
                onClick={() =>
                  props.setSelectedSection(
                    props.selectedSection === section.id ? null : section.id,
                  )
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className="ml-auto min-w-0 shrink-0">
        <ModeSelect />
      </div>
    </div>
  );
}
