import { Editor, JSONContent } from "@tiptap/react";
import { ContextItemWithId, InputModifiers, ChatMessage } from "core";
import { getImageParts } from "core/util/messageContent";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { useAppSelector } from "../../redux/hooks";
import { selectSlashCommandComboBoxInputs } from "../../redux/selectors";

import { AgentTurnMeter } from "../../pages/gui/AgentTurnMeter";
import ContextItemsPeek from "./belowMainInput/ContextItemsPeek";
import { GitDiffStatusPanel } from "./GitDiffStatusPanel";
import { ToolbarOptions } from "./InputToolbar";
import { Lump } from "./Lump";
import { CompactionStatusPanel } from "./CompactionStatusPanel";
import { BackgroundAgentPanel } from "./BackgroundAgentPanel";
import { WorktreePanel } from "./WorktreePanel";
import { InjectedMemoriesPanel } from "./InjectedMemoriesPanel";
import { TaskPlanPanel } from "./TaskPlanPanel";
import TipTapEditor from "./tiptap/TipTapEditor";

interface KnoxInputBoxProps {
  isEditMode?: boolean;
  isLastUserInput: boolean;
  isMainInput?: boolean;
  onEnter: (
    editorState: JSONContent,
    modifiers: InputModifiers,
    editor: Editor,
  ) => void;
  editorState?: JSONContent;
  contextItems?: ContextItemWithId[];
  hidden?: boolean;
  inputId: string; // used to keep track of things per input in redux
  message?: ChatMessage; // For displaying images in historical messages
  // Scroll navigation props
  showScrollButtons?: boolean;
  isAtTop?: boolean;
  isAtBottom?: boolean;
  onScrollToTop?: () => void;
  onScrollToBottom?: () => void;
}

const EDIT_DISALLOWED_CONTEXT_PROVIDERS = [
  "tree",
  "open",
  "web",
  "diff",
  "folder",
  "search",
  "debugger",
  "repo-map",
];

const GradientBorder = ({
  loading,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  loading: boolean;
}) => (
  <div
    className={cn("knox-sent-frame w-full", loading && "knox-sent-frame--live", className)}
    {...props}
  >
    {loading && <span aria-hidden className="knox-sent-frame-ring" />}
    <div className="knox-sent-frame-inner">{children}</div>
  </div>
);



function KnoxInputBox(props: KnoxInputBoxProps) {
  const { t } = useTranslation();
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const history = useAppSelector((state) => state.session.history);
  const mode = useAppSelector((state) => state.session.mode);
  const availableSlashCommands = useAppSelector(
    selectSlashCommandComboBoxInputs,
  );
  const availableContextProviders = useAppSelector(
    (state) => state.config.config.contextProviders,
  );
  const editModeState = useAppSelector((state) => state.editModeState);

  // State for managing historical images (for non-main inputs)
  const [historicalImages, setHistoricalImages] = useState<string[]>(() => {
    if (!props.isMainInput && props.message) {
      return getImageParts(props.message.content);
    }
    return [];
  });

  // Function to remove historical images
  const removeHistoricalImage = (index: number) => {
    setHistoricalImages(prev => prev.filter((_, i) => i !== index));
  };

  const filteredSlashCommands = props.isEditMode ? [] : availableSlashCommands;
  const filteredContextProviders = useMemo(() => {
    if (!props.isEditMode) {
      return availableContextProviders ?? [];
    }

    return (
      availableContextProviders?.filter(
        (provider) =>
          !EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes(provider.title),
      ) ?? []
    );
  }, [availableContextProviders]);

  const historyKey = props.isEditMode ? "edit" : "chat";
  const placeholder = props.isEditMode
    ? t('describeHowToModifyCode')
    : undefined;

  const toolbarOptions: ToolbarOptions = props.isEditMode
    ? {
        hideAddContext: false,
        hideImageUpload: false,
        hideSelectModel: false,
        enterText: editModeState.editStatus === "accepting" ? t('retry') : t('edit'),
      }
    : {};

  const [lumpOpen, setLumpOpen] = useState(true);

  return (
    <div className={`${props.hidden ? "hidden" : ""}`}>
      <div className={`relative flex flex-col px-2`}>
        {props.isMainInput && <Lump open={lumpOpen} setOpen={setLumpOpen} />}
        {props.isMainInput && !props.isEditMode && mode === "agent" && (
          <AgentTurnMeter history={history} isStreaming={isStreaming} />
        )}
        {props.isMainInput && <GitDiffStatusPanel />}
        {props.isMainInput && <CompactionStatusPanel />}
        {props.isMainInput && <WorktreePanel />}
        {props.isMainInput && <TaskPlanPanel />}
        {props.isMainInput && <InjectedMemoriesPanel />}
        {props.isMainInput && <BackgroundAgentPanel />}
        <GradientBorder loading={isStreaming && props.isLastUserInput}>
          <TipTapEditor
            editorState={props.editorState}
            onEnter={props.onEnter}
            placeholder={placeholder}
            isMainInput={props.isMainInput ?? false}
            availableContextProviders={filteredContextProviders}
            availableSlashCommands={filteredSlashCommands}
            historyKey={historyKey}
            toolbarOptions={toolbarOptions}
            lumpOpen={lumpOpen}
            setLumpOpen={setLumpOpen}
            inputId={props.inputId}
            historicalImages={historicalImages}
            onRemoveHistoricalImage={!props.isMainInput ? removeHistoricalImage : undefined}
            showScrollButtons={props.showScrollButtons}
            isAtTop={props.isAtTop}
            isAtBottom={props.isAtBottom}
            onScrollToTop={props.onScrollToTop}
            onScrollToBottom={props.onScrollToBottom}
          />
        </GradientBorder>
      </div>
      <ContextItemsPeek
        contextItems={props.contextItems}
        isCurrentContextPeek={props.isLastUserInput}
      />
    </div>
  );
}

export default KnoxInputBox;
