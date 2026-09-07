import { ChevronDown } from "lucide-react";
import { inferResolvedUriFromRelativePath } from "core/util/ideUtils";
import { debounce } from "lodash";
import { useContext, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  vscCommandCenterInactiveBorder,
  vscEditorBackground,
} from "../..";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useWebviewListener } from "../../../hooks/useWebviewListener";
import { useAppSelector } from "../../../redux/hooks";
import { selectDefaultModel } from "../../../redux/slices/configSlice";
import {
  selectApplyStateByStreamId,
} from "../../../redux/slices/sessionSlice";
import { getFontSize } from "../../../util";
import { childrenToText, isTerminalCodeBlock } from "../utils";

import ApplyActions from "./ApplyActions";
import {
  initialCodeBlockExpanded,
  shouldAutoExpandGeneratingCodeBlock,
} from "./codeBlockExpand";
import CopyButton from "./CopyButton";
import FileInfo from "./FileInfo";
import GeneratingCodeLoader from "./GeneratingCodeLoader";
import RunInTerminalButton from "./RunInTerminalButton";

export interface StepContainerPreToolbarProps {
  codeBlockContent: string;
  language: string | null;
  relativeFilepath: string;
  isGeneratingCodeBlock: boolean;
  codeBlockIndex: number; // To track which codeblock we are applying
  range?: string;
  children: any;
  expanded?: boolean;
  hideApply?: boolean;
}

export default function StepContainerPreToolbar(
  props: StepContainerPreToolbarProps,
) {
  const ideMessenger = useContext(IdeMessengerContext);
  const streamIdRef = useRef<string>(uuidv4());
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(() =>
    initialCodeBlockExpanded(props.codeBlockContent, props.expanded),
  );
  const [codeBlockContent, setCodeBlockContent] = useState("");
  const isStreaming = useAppSelector((state) => state.session.isStreaming);

  const nextCodeBlockIndex = useAppSelector(
    (state) => state.session.codeBlockApplyStates.curIndex,
  );

  const applyState = useAppSelector((state) =>
    selectApplyStateByStreamId(state, streamIdRef.current),
  );
  const isGeneratingCodeBlock = !isStreaming
    ? false
    : props.isGeneratingCodeBlock;

  // Read-file previews stay collapsed; expand only once generated code arrives.
  useEffect(() => {
    if (
      shouldAutoExpandGeneratingCodeBlock(
        isGeneratingCodeBlock,
        props.codeBlockContent,
        props.expanded,
      )
    ) {
      setIsExpanded(true);
    }
  }, [isGeneratingCodeBlock, props.codeBlockContent, props.expanded]);

  // Note: Auto-scroll is now handled inside SyntaxHighlightedPre component
  // This keeps the scroll logic close to the actual scrollable container

  const isNextCodeBlock = nextCodeBlockIndex === props.codeBlockIndex;
  const hasFileExtension = /\.[0-9a-z]+$/i.test(props.relativeFilepath);

  const defaultModel = useAppSelector(selectDefaultModel);

  async function onClickApply() {
    if (!defaultModel) {
      return;
    }

    let fileUri = await inferResolvedUriFromRelativePath(
      props.relativeFilepath,
      ideMessenger.ide,
    );

    ideMessenger.post("applyToFile", {
      streamId: streamIdRef.current,
      filepath: fileUri,
      text: codeBlockContent,
      curSelectedModelTitle: defaultModel.title,
    });
  }

  // Handle apply keyboard shortcut
  useWebviewListener(
    "applyCodeFromChat",
    async () => onClickApply(),
    [isNextCodeBlock, codeBlockContent],
    !isNextCodeBlock,
  );

  useEffect(() => {
    if (codeBlockContent === "") {
      setCodeBlockContent(props.codeBlockContent);
    } else {
      const debouncedEffect = debounce(() => {
        setCodeBlockContent(props.codeBlockContent);
      }, 100);

      debouncedEffect();

      return () => {
        debouncedEffect.cancel();
      };
    }
  }, [props.codeBlockContent, codeBlockContent]);

  async function onClickAcceptApply() {
    const fileUri = await inferResolvedUriFromRelativePath(
      props.relativeFilepath,
      ideMessenger.ide,
    );
    ideMessenger.post("acceptDiff", {
      filepath: fileUri,
      streamId: streamIdRef.current,
    });
  }

  async function onClickRejectApply() {
    const fileUri = await inferResolvedUriFromRelativePath(
      props.relativeFilepath,
      ideMessenger.ide,
    );
    ideMessenger.post("rejectDiff", {
      filepath: fileUri,
      streamId: streamIdRef.current,
    });
  }

  function onClickExpand() {
    setIsExpanded(!isExpanded);
  }

  // We want until there is an extension in the filepath to avoid rendering
  // an incomplete filepath
  if (!hasFileExtension) {
    return props.children;
  }

  return (
    <div 
      className="rounded-md mb-2 min-w-0 max-w-full"
      style={{
        outline: `1px solid ${vscCommandCenterInactiveBorder}`,
        outlineOffset: '-0.5px',
        backgroundColor: vscEditorBackground,
      }}
    >
      <div 
        className={`flex justify-between items-center bg-inherit p-1 px-1.5 m-0 find-widget-skip ${isExpanded ? 'border-b' : ''}`}
        style={{
          fontSize: `${getFontSize() - 2}px`,
          borderBottomColor: isExpanded ? vscCommandCenterInactiveBorder : 'transparent',
        }}
      >
        <div className="flex min-w-0 max-w-[45%] items-center">
          <ChevronDown
            onClick={onClickExpand}
            className={`h-3.5 w-3.5 shrink-0 cursor-pointer text-knoxcyan hover:brightness-125 ${
              isExpanded ? "rotate-0" : "-rotate-90"
            }`}
          />
          <div className="w-full min-w-0">
            <FileInfo
              relativeFilepath={props.relativeFilepath}
              range={props.range}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 max-sm:gap-1.5">
          {isGeneratingCodeBlock && (
            <GeneratingCodeLoader
              showLineCount={true}
              codeBlockContent={codeBlockContent}
            />
          )}

          {!isGeneratingCodeBlock && (
            <>
              <CopyButton text={props.codeBlockContent} />
              {props.hideApply ||
                (isTerminalCodeBlock(props.language, props.codeBlockContent) ? (
                  <RunInTerminalButton command={props.codeBlockContent} />
                ) : (
                  <ApplyActions
                    applyState={applyState}
                    onClickApply={onClickApply}
                    onClickAccept={onClickAcceptApply}
                    onClickReject={onClickRejectApply}
                  />
                ))}
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div
          ref={codeContainerRef}
          className={`overflow-hidden transition-opacity duration-200 ${
            isExpanded ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* SyntaxHighlightedPre handles its own scrolling and height constraints */}
          {props.children}
        </div>
      )}
    </div>
  );
}
