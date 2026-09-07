import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";
import { useTranslation } from "react-i18next";

import { useAppSelector } from "../../redux/hooks";
import { selectIsInEditMode } from "../../redux/slices/sessionSlice";
import { CopyIconButton } from "../gui/CopyIconButton";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";

import CheckpointButton from "./CheckpointButton";
import EditActions from "./EditActions";

export interface ResponseActionsProps {
  isTruncated: boolean;
  onKnoxGeneration: () => void;
  index: number;
  onDelete: () => void;
  item: ChatHistoryItem;
}

export default function ResponseActions({
  onKnoxGeneration,
  index,
  item,
  isTruncated,
  onDelete,
}: ResponseActionsProps) {
  const { t } = useTranslation();
  const isInEditMode = useAppSelector(selectIsInEditMode);

  if (isInEditMode) {
    return <EditActions index={index} item={item} />;
  }

  return (
    <div className="mx-2 flex cursor-default items-center justify-end space-x-1 bg-transparent pb-0 text-xs text-knoxcyan">
      {/* Checkpoint restore button - shown first for assistant messages */}
      <CheckpointButton item={item} index={index} />
      
      {isTruncated && (
        <HeaderButtonWithToolTip
          tabIndex={-1}
          text={t('knoxGeneration')}
          onClick={onKnoxGeneration}
        >
          <span className="text-knoxcyan h-3.5 w-3.5">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path
                fill="#159994"
                d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm8 1v8.5L7.5 11l-1.42 1.42L12 18.34l5.92-5.92L16.5 11L13 14.5V6z"
              />
            </svg>
          </span>
        </HeaderButtonWithToolTip>
      )}

      <HeaderButtonWithToolTip
        testId={`delete-button-${index}`}
        text={t('delete')}
        tabIndex={-1}
        onClick={onDelete}
      >
        <span className="h-3.5 w-3.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path
              fill="#fd7e14"
              d="M20 6h-4V5a3 3 0 0 0-3-3h-2a3 3 0 0 0-3 3v1H4a1 1 0 0 0 0 2h1v11a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8h1a1 1 0 0 0 0-2M10 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1h-4Zm7 14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8h10Z"
            />
          </svg>
        </span>
      </HeaderButtonWithToolTip>

      <CopyIconButton
        tabIndex={-1}
        text={renderChatMessage(item.message)}
        clipboardIconClassName="h-3.5 w-3.5 text-gray-500"
        checkIconClassName="h-3.5 w-3.5 text-green-400"
      />
    </div>
  );
}
