import { InputModifiers } from "core";
import { modelSupportsImages, modelSupportsTools } from "core/llm/autodetect";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { lightGray, vscForeground } from "..";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectUseActiveFile } from "../../redux/selectors";
import { selectCurrentToolCall } from "../../redux/selectors/selectCurrentToolCall";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import {
  selectHasCodeToEdit,
  selectIsInEditMode,
} from "../../redux/slices/sessionSlice";
import { exitEditMode } from "../../redux/thunks";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { hasUnsettledToolCalls } from "../../redux/util";
import {
  collectRunningTaskJobs,
  countRunningJobs,
  mergeBackgroundJobs,
} from "../../redux/util/backgroundJobs";
import { loadLastSession } from "../../redux/thunks/session";
import { ToolTip } from "../gui/Tooltip";
import ModelSelect from "../modelSelection/ModelSelect";
import ReasoningEffortSelect from "../modelSelection/ReasoningEffortSelect";
import WebSearchToggle from "../modelSelection/WebSearchToggle";
import { useFontSize } from "../ui/font";

import HoverItem from "./InputToolbar/bottom/HoverItem";

const EnterButton = ({
  isPrimary,
  isCancel,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  isPrimary?: boolean;
  isCancel?: boolean;
}) => (
  <button
    className={cn(
      "all-unset flex cursor-pointer items-center rounded px-1 py-0.5 transition-all duration-200",
      isCancel
        ? "bg-orange/20 text-orange"
        : "bg-lightgray/20 text-vsc-foreground",
      "hover:-translate-y-px",
      isCancel ? "hover:bg-orange/20" : "hover:bg-lightgray/35",
      "disabled:cursor-wait disabled:opacity-60",
      className,
    )}
    {...props}
  />
);

export interface ToolbarOptions {
  hideImageUpload?: boolean;
  hideAddContext?: boolean;
  enterText?: string;
  hideSelectModel?: boolean;
}

interface InputToolbarProps {
  onEnter?: (modifiers: InputModifiers) => void;
  onAddContextItem?: () => void;
  onClick?: () => void;
  onImageFileSelected?: (file: File) => void;
  hidden?: boolean;
  activeKey: string | null;
  toolbarOptions?: ToolbarOptions;
  disabled?: boolean;
  isMainInput?: boolean;
  lumpOpen: boolean;
  setLumpOpen: (open: boolean) => void;
  // Scroll navigation props
  showScrollButtons?: boolean;
  isAtTop?: boolean;
  isAtBottom?: boolean;
  onScrollToTop?: () => void;
  onScrollToBottom?: () => void;
}

function InputToolbar(props: InputToolbarProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultModel = useAppSelector(selectDefaultModel);
  const useActiveFile = useAppSelector(selectUseActiveFile);
  const isInEditMode = useAppSelector(selectIsInEditMode);
  const hasCodeToEdit = useAppSelector(selectHasCodeToEdit);
  const toolCallState = useAppSelector(selectCurrentToolCall);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const history = useAppSelector((state) => state.session.history);
  const shellJobs = useAppSelector((state) => state.ui.backgroundJobs ?? []);
  const runningJobs = countRunningJobs(
    mergeBackgroundJobs(shellJobs, collectRunningTaskJobs(history)),
  );
  // Keep Stop available while a tool is mid-flight even if the LLM stream already ended
  // (e.g. user approved a permission-gated tool after the assistant finished).
  const canCancel =
    isStreaming ||
    toolCallState?.status === "calling" ||
    hasUnsettledToolCalls(history) ||
    runningJobs > 0;
  const isEditModeAndNoCodeToEdit = isInEditMode && !hasCodeToEdit;

  const isEnterDisabled =
    props.disabled ||
    isEditModeAndNoCodeToEdit ||
    toolCallState?.status === "generated";
  const toolsSupported = defaultModel && modelSupportsTools(defaultModel);

  const supportsImages =
    defaultModel &&
    modelSupportsImages(
      defaultModel.provider,
      defaultModel.model,
      defaultModel.title,
      defaultModel.capabilities,
    );

  const smallFont = useFontSize(-2);
  const tinyFont = useFontSize(-3);

  // Handle button click - either send or cancel based on streaming/tool state
  const handleButtonClick = async (e: React.MouseEvent) => {
    if (canCancel) {
      // Cancel the current stream / in-flight tool
      dispatch(cancelStream());
    } else {
      // Send the message
      if (props.onEnter) {
        props.onEnter({
          noContext: useActiveFile ? e.altKey : !e.altKey,
        });
      }
    }
  };

  // Determine button text and icon based on streaming state
  const getButtonContent = () => {
    if (canCancel) {
      return {
        text: undefined,
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M6 6L18 18M6 18L18 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ),
        isCancel: true,
      };
    } else {
      return {
        text: props.toolbarOptions?.enterText ?? t("send"),
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            className="mr-1"
            aria-hidden="true"
          >
            <path
              d="M15.43 8.56949L10.744 15.1395C10.6422 15.282 10.5804 15.4492 10.5651 15.6236C10.5498 15.7981 10.5815 15.9734 10.657 16.1315L13.194 21.4425C13.2737 21.6097 13.3991 21.751 13.5557 21.8499C13.7123 21.9488 13.8938 22.0014 14.079 22.0015H14.117C14.3087 21.9941 14.4941 21.9307 14.6502 21.8191C14.8062 21.7075 14.9261 21.5526 14.995 21.3735L21.933 3.33649C22.0011 3.15918 22.0164 2.96594 21.977 2.78013C21.9376 2.59432 21.8452 2.4239 21.711 2.28949L15.43 8.56949Z"
              fill="currentColor"
            />
            <path
              opacity="0.5"
              d="M20.664 2.06648L2.62602 9.00148C2.44768 9.07085 2.29348 9.19082 2.1824 9.34663C2.07131 9.50244 2.00818 9.68731 2.00074 9.87853C1.99331 10.0697 2.04189 10.259 2.14054 10.4229C2.23919 10.5869 2.38359 10.7185 2.55601 10.8015L7.86601 13.3365C8.02383 13.4126 8.19925 13.4448 8.37382 13.4297C8.54839 13.4145 8.71565 13.3526 8.85801 13.2505L15.43 8.56548L21.711 2.28448C21.5762 2.15096 21.4055 2.05932 21.2198 2.02064C21.034 1.98196 20.8409 1.99788 20.664 2.06648Z"
              fill="currentColor"
            />
          </svg>
        ),
        isCancel: false,
      };
    }
  };

  const buttonContent = getButtonContent();

  return (
    <>
      <div
        onClick={props.onClick}
        className={`find-widget-skip bg-vsc-input-background flex flex-row items-center justify-between gap-1 pt-1 select-none ${props.hidden ? "pointer-events-none h-0 cursor-default opacity-0" : "pointer-events-auto cursor-text opacity-100"}`}
        style={{
          fontSize: smallFont,
        }}
      >
        <div className="xs:gap-1.5 flex flex-row items-center gap-1">
          <div className="xs:flex text-secgray -mb-1 hidden items-center transition-colors duration-200">
            {props.toolbarOptions?.hideImageUpload ||
              (supportsImages && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
                    onChange={(e) => {
                      const files = e.target?.files ?? [];
                      for (const file of files) {
                        props.onImageFileSelected?.(file);
                      }
                    }}
                  />
                  <HoverItem className="">
                    <span
                      className="h-3 w-3 hover:brightness-125"
                      data-tooltip-id="image-tooltip"
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                      >
                        <g
                          fill="none"
                          stroke="#159994"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1"
                        >
                          <path d="M15 8h.01M10 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5" />
                          <path d="m3 16l5-5c.928-.893 2.072-.893 3 0l1 1m2 9v-4a2 2 0 1 1 4 0v4m-4-2h4m3-4v6" />
                        </g>
                      </svg>
                    </span>
                    <ToolTip id="image-tooltip" place="top-middle">
                      {t("attachImage")}
                    </ToolTip>
                  </HoverItem>
                </>
              ))}
            {props.toolbarOptions?.hideAddContext || (
              <HoverItem onClick={props.onAddContextItem}>
                <span
                  data-tooltip-id="add-context-item-tooltip"
                  className="h-3 w-3 hover:brightness-125"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                  >
                    <g
                      fill="none"
                      stroke="#159994"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1"
                    >
                      <rect width="20" height="20" x="2" y="2" rx="2" />
                      <path d="M14 17.7a6 6 0 1 1 4-5.7a2 2 0 0 1-4 0" />
                      <circle cx="12" cy="12" r="2" />
                    </g>
                  </svg>
                </span>

                <ToolTip id="add-context-item-tooltip" place="top-middle">
                  {t("addContext")}
                </ToolTip>
              </HoverItem>
            )}
          </div>
          <span className="mt-1">
            <ModelSelect />
          </span>
          <span className="mt-1">
            <ReasoningEffortSelect disabled={isStreaming || props.disabled} />
          </span>
          <span className="mt-1">
            <WebSearchToggle disabled={isStreaming || props.disabled} />
          </span>
        </div>

        <div
          className="text-knoxcyan flex items-center gap-2 whitespace-nowrap"
          style={{
            fontSize: tinyFont,
          }}
        >
          {/* Scroll navigation buttons */}
          {props.showScrollButtons && (
            <div className="flex items-center gap-1">
              {/* Scroll to top button */}
              <button
                onClick={props.onScrollToTop}
                disabled={props.isAtTop}
                title={t("scrollToTop")}
                className={cn(
                  "rounded p-1 transition-all duration-150",
                  props.isAtTop
                    ? "cursor-not-allowed opacity-30"
                    : "hover:bg-lightgray/20 cursor-pointer opacity-70 hover:opacity-100",
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#159994"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
              {/* Scroll to bottom button */}
              <button
                onClick={props.onScrollToBottom}
                disabled={props.isAtBottom}
                title={t("scrollToBottom")}
                className={cn(
                  "rounded p-1 transition-all duration-150",
                  props.isAtBottom
                    ? "cursor-not-allowed opacity-30"
                    : "hover:bg-lightgray/20 cursor-pointer opacity-70 hover:opacity-100",
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#159994"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            </div>
          )}

          {isInEditMode && (
            <HoverItem
              className="hidden hover:underline sm:flex"
              onClick={async () => {
                await dispatch(
                  loadLastSession({
                    saveCurrentSession: false,
                  }),
                );
                dispatch(exitEditMode());
              }}
            >
              <span>
                <i>Esc</i>
                {t("exitEdit")}
              </span>
            </HoverItem>
          )}

          <EnterButton
            isPrimary={props.isMainInput}
            isCancel={buttonContent.isCancel}
            data-testid="submit-input-button"
            data-tooltip-id="send-cancel-button-tooltip"
            aria-label={
              canCancel ? t("cancelGeneration") : t("sendMessage")
            }
            onClick={handleButtonClick}
            disabled={isEnterDisabled && !canCancel}
          >
            <span
              className={`flex items-center ${buttonContent.isCancel ? "text-orange" : "mr-1 text-knoxcyan"}`}
            >
              {buttonContent.icon}
              {buttonContent.text}
            </span>
          </EnterButton>
          <ToolTip id="send-cancel-button-tooltip" place="top">
            {canCancel ? t("cancelGeneration") : t("sendMessage")}
          </ToolTip>
        </div>
      </div>
    </>
  );
}

export default InputToolbar;
