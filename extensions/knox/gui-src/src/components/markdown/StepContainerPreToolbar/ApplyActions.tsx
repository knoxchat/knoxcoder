import { ApplyState } from "core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { lightGray, vscForeground } from "../..";
import { CheckIcon, XMarkIcon } from "../../../svg-icons";
import { getMetaKeyLabel } from "../../../util";
import Spinner from "../../gui/Spinner";

import { ToolbarButtonWithTooltip } from "./ToolbarButtonWithTooltip";

interface ApplyActionsProps {
  applyState?: ApplyState;
  onClickAccept: () => void;
  onClickReject: () => void;
  onClickApply: () => void;
}

export default function ApplyActions(props: ApplyActionsProps) {
  const { t } = useTranslation();
  const [hasRejected, setHasRejected] = useState(false);
  const [showApplied, setShowApplied] = useState(false);
  const isClosed = props.applyState?.status === "closed";
  const isSuccessful = !hasRejected && props.applyState?.numDiffs === 0;

  useEffect(() => {
    if (isClosed && isSuccessful) {
      setShowApplied(true);
      const timer = setTimeout(() => {
        setShowApplied(false);
      }, 5_000);
      return () => clearTimeout(timer);
    }
  }, [isClosed, isSuccessful]);

  function onClickReject() {
    props.onClickReject();
    setHasRejected(true);
  }

  const applyButton = (text: string) => (
    <button
      className={`flex items-center border-none bg-transparent text-xs text-[${vscForeground}] cursor-pointer outline-hidden hover:brightness-125`}
      onClick={props.onClickApply}
      style={{ color: lightGray }}
    >
      <div className="flex items-center gap-1 text-knoxcyan">
        <span className="h-3 w-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 8 28 16"
            width="14px"
            height="14px"
            className="mr-0.5 mt-0.5"
          >
            <path
              fill="#159994"
              d="m18 15l-.001 3H21v2h-3.001L18 23h-2l-.001-3H13v-2h2.999L16 15zm-7 3v2H3v-2zm10-7v2H3v-2zm0-7v2H3V4z"
            />
          </svg>
        </span>
        <span className="xs:inline hidden text-knoxcyan">{text}</span>
      </div>
    </button>
  );

  switch (props.applyState ? props.applyState.status : null) {
    case "streaming":
      return (
        <div className="flex items-center rounded-sm bg-zinc-700 pl-2 pr-1">
          <span className="inline-flex items-center gap-2 text-xs text-knoxcyan">
            {t('applyingChanges')}
            <Spinner />
          </span>
        </div>
      );
    case "done":
      return (
        <div className="xs:pl-2 xs:pr-1 flex items-center rounded-sm bg-zinc-700">
          <span className="max-xs:hidden xs:mr-1 text-xs text-knoxcyan">
            {t('diffsRemaining', { count: props.applyState?.numDiffs ?? 0 })}
            <span className="max-md:hidden">{` ${t('remaining')}`}</span>
          </span>

          <ToolbarButtonWithTooltip
            onClick={onClickReject}
            tooltipContent={`${t('rejectAll')} (${getMetaKeyLabel()}⇧⌫)`}
          >
            <span className="h-4 w-4 hover:brightness-125">
              <XMarkIcon />
            </span>
          </ToolbarButtonWithTooltip>

          <ToolbarButtonWithTooltip
            onClick={props.onClickAccept}
            tooltipContent={`${t('acceptAll')} (${getMetaKeyLabel()}⇧⏎)`}
          >
            <span className="h-4 w-4 hover:brightness-125">
              <CheckIcon />
            </span>
          </ToolbarButtonWithTooltip>
        </div>
      );
    case "closed":
      if (!hasRejected && props.applyState?.numDiffs === 0) {
        if (showApplied) {
          return (
            <span className="flex items-center rounded-sm bg-zinc-700 text-knoxcyan max-sm:px-0.5 sm:pl-2">
              <span className="max-sm:hidden">{t('applied')}</span>
              <span className="h-4 w-4 hover:brightness-125 sm:px-1">
                <CheckIcon />
              </span>
            </span>
          );
        }

        return applyButton(t('reApply'));
      }
    default:
      return applyButton(t('apply'));
  }
}