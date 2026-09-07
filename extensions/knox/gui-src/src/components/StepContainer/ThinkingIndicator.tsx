import { ChatHistoryItem } from "core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppSelector } from "../../redux/hooks";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { shouldShowThinkingPlaceholder } from "../../util/reasoningEffort";

interface ThinkingIndicatorProps {
  historyItem: ChatHistoryItem;
}

/**
 * Pre-content thinking placeholder while a reasoning model is streaming
 * but has not yet emitted answer or reasoning text.
 */
const ThinkingIndicator = ({ historyItem }: ThinkingIndicatorProps) => {
  const { t } = useTranslation();
  const [animation, setAnimation] = useState(2);
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimation((prevState) => (prevState === 2 ? 0 : prevState + 1));
    }, 600);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const selectedModel = useAppSelector(selectDefaultModel);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);

  const hasContent = Array.isArray(historyItem.message.content)
    ? !!historyItem.message.content.length
    : !!historyItem.message.content;
  const hasReasoningText = !!historyItem.reasoning?.text?.trim();
  const showForModel = shouldShowThinkingPlaceholder(selectedModel);
  const isThinking =
    isStreaming &&
    !historyItem.isGatheringContext &&
    !hasContent &&
    !hasReasoningText;

  if (!isThinking || !showForModel) {
    return null;
  }

  return (
    <div className="px-2 py-2">
      <span className="text-lightgray">
        {`${t("thinkingDots")}${".".repeat(animation)}`}
      </span>
    </div>
  );
};

export default ThinkingIndicator;
