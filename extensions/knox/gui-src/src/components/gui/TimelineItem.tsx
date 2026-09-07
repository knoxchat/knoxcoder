import { ChatHistoryItem } from "core";
import { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { lightGray } from "..";
import { ChatBubbleOvalLeftIcon } from "../../svg-icons";
import { getFontSize } from "../../util";

interface TimelineItemProps {
  item: ChatHistoryItem;
  open: boolean;
  onToggle: () => void;
  children: ReactElement;
  iconElement?: ReactElement;
}

function TimelineItem(props: TimelineItemProps) {
  const { t } = useTranslation();
  return props.open ? (
    props.children
  ) : (
    <div 
      className="mt-2 mb-2 ml-2 flex items-center gap-1 min-h-4"
      style={{ fontSize: `${getFontSize()}px` }}
    >
      <div
        className="flex justify-center items-center shrink-0 grow-0 ml-3.5 cursor-pointer"
        style={{ backgroundColor: 'var(--vscode-background)' }}
        onClick={() => {
          props.onToggle();
        }}
      >
        {props.iconElement || <ChatBubbleOvalLeftIcon />}
      </div>
      <span style={{ color: lightGray }}>
        {t('roleMessage', { role: props.item.message.role })}
      </span>
    </div>
  );
}

export default TimelineItem;
