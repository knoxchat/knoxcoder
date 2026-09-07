import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import {
  defaultBorderRadius,
  vscCommandCenterInactiveBorder,
  vscEditorBackground,
} from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppSelector } from "../../redux/hooks";
import {
  selectDefaultModel,
  selectUIConfig,
} from "../../redux/slices/configSlice";
import { ApplyIcon, InsertIcon, TerminalIcon } from "../../svg-icons";
import { CopyIconButton } from "../gui/CopyIconButton";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";

import { getTerminalCommand, isTerminalCodeBlock } from "./utils";

interface StepContainerPreActionButtonsProps {
  language: string | null;
  codeBlockContent: string;
  codeBlockIndex: number;
  children: any;
  isGenerating?: boolean;
}

export default function StepContainerPreActionButtons({
  language,
  codeBlockContent,
  codeBlockIndex,
  children,
  isGenerating: isGeneratingProp,
}: StepContainerPreActionButtonsProps) {
  const [hovering, setHovering] = useState(false);
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const uiConfig = useAppSelector(selectUIConfig);
  const streamIdRef = useRef<string | null>(null);
  const nextCodeBlockIndex = useAppSelector(
    (state) => state.session.codeBlockApplyStates.curIndex,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const isGenerating = isGeneratingProp ?? false;
  const isBottomToolbarPosition =
    uiConfig?.codeBlockToolbarPosition === "bottom";

  // Note: Auto-scroll is now handled inside SyntaxHighlightedPre component

  const toolTipPlacement = isBottomToolbarPosition ? "top" : "bottom";

  const shouldRunTerminalCmd =
    isTerminalCodeBlock(language, codeBlockContent);
  const isNextCodeBlock = nextCodeBlockIndex === codeBlockIndex;

  if (streamIdRef.current === null) {
    streamIdRef.current = uuidv4();
  }

  const defaultModel = useAppSelector(selectDefaultModel);

  function onClickApply() {
    if (!defaultModel || !streamIdRef.current) {
      return;
    }
    ideMessenger.post("applyToFile", {
      streamId: streamIdRef.current,
      text: codeBlockContent,
      curSelectedModelTitle: defaultModel.title,
    });
  }

  async function onClickRunTerminal(): Promise<void> {
    if (shouldRunTerminalCmd) {
      return ideMessenger.ide.runCommand(getTerminalCommand(codeBlockContent));
    }
  }

  // Handle apply keyboard shortcut
  useWebviewListener(
    "applyCodeFromChat",
    async () => onClickApply(),
    [isNextCodeBlock, codeBlockContent],
    !isNextCodeBlock,
  );

  return (
    <div
      tabIndex={-1}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="bg-vsc-editor-background relative my-2.5 min-w-0 max-w-full"
      style={{
        border: `1px solid ${vscCommandCenterInactiveBorder}`,
        borderRadius: defaultBorderRadius,
      }}
    >
      {/* SyntaxHighlightedPre handles its own scrolling and height constraints */}
      <div className="h-full w-full min-w-0 overflow-hidden rounded-md">
        {children}
      </div>
      {hovering && !isStreaming && !isGenerating && (
        <div
          className="bg-vsc-editor-background z-100 absolute right-3 flex -translate-y-1/2 gap-1.5 px-1 py-0.5"
          style={{
            top: !isBottomToolbarPosition ? 0 : "100%",
            border: `1px solid ${vscCommandCenterInactiveBorder}`,
            borderRadius: defaultBorderRadius,
          }}
        >
          {shouldRunTerminalCmd && (
            <HeaderButtonWithToolTip
              text={t('runInTerminal')}
              style={{ backgroundColor: vscEditorBackground }}
              onClick={onClickRunTerminal}
              tooltipPlacement={toolTipPlacement}
            >
              <span className="h-4 w-4">
                <TerminalIcon />
              </span>
            </HeaderButtonWithToolTip>
          )}
          <HeaderButtonWithToolTip
            text={t('apply')}
            style={{ backgroundColor: vscEditorBackground }}
            onClick={onClickApply}
            tooltipPlacement={toolTipPlacement}
          >
            <span className="h-4 w-4">
              <ApplyIcon />
            </span>
          </HeaderButtonWithToolTip>
          <HeaderButtonWithToolTip
            text={t('insert')}
            style={{ backgroundColor: vscEditorBackground }}
            onClick={() =>
              ideMessenger.post("insertAtCursor", { text: codeBlockContent })
            }
            tooltipPlacement={toolTipPlacement}
          >
            <span className="h-4 w-4">
              <InsertIcon />
            </span>
          </HeaderButtonWithToolTip>
          <CopyIconButton
            text={codeBlockContent}
            tooltipPlacement={toolTipPlacement}
          />
        </div>
      )}
    </div>
  );
}
