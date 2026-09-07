import { ChatHistoryItem } from "core";
import { renderChatMessage, stripImages, getImageParts } from "core/util/messageContent";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import { useAppSelector } from "../../redux/hooks";
import { selectUIConfig } from "../../redux/slices/configSlice";
import { deleteMessage } from "../../redux/slices/sessionSlice";
import { getFontSize } from "../../util";
import StyledMarkdownPreview from "../markdown/StyledMarkdownPreview";

import Reasoning from "./Reasoning";
import ResponseActions from "./ResponseActions";
import ThinkingIndicator from "./ThinkingIndicator";
import { t } from "i18next";

interface StepContainerProps {
  item: ChatHistoryItem;
  index: number;
  isLast: boolean;
}

// Component to display images inline with messages - matches ImageThumbnailArea styling
function MessageImages({ images }: { images: string[] }) {
  if (images.length === 0) {return null};

  return (
    <div className="image-thumbnail-area">
      <div className="image-thumbnail-grid">
        {images.map((imageUrl, index) => (
          <div 
            key={index}
            className="image-thumbnail-item"
            onClick={() => {
              // Open image in a new window/tab for full view
              window.open(imageUrl, '_blank');
            }}
          >
            <img 
              src={imageUrl} 
              alt={t('uploadedImageAlt', { index: index + 1 })}
              className="thumbnail-image"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StepContainer(props: StepContainerProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [isTruncated, setIsTruncated] = useState(false);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const historyItemAfterThis = useAppSelector(
    (state) => state.session.history[props.index + 1],
  );
  const uiConfig = useAppSelector(selectUIConfig);

  const hideActionSpace =
    historyItemAfterThis?.message.role === "assistant" ||
    historyItemAfterThis?.message.role === "thinking";
  const hideActions = hideActionSpace || (isStreaming && props.isLast);

  // const isStepAheadOfCurCheckpoint =
  //   isInEditMode && Math.floor(props.index / 2) > curCheckpointIndex;

  useEffect(() => {
    if (!isStreaming) {
      const content = renderChatMessage(props.item.message).trim();
      const endingPunctuation = [".", "?", "!", "```", ":"];

      // If not ending in punctuation or emoji, we assume the response got truncated
      if (
        content.trim() !== "" &&
        !(
          endingPunctuation.some((p) => content.endsWith(p)) ||
          /\p{Emoji}/u.test(content.slice(-2))
        )
      ) {
        setIsTruncated(true);
      } else {
        setIsTruncated(false);
      }
    }
  }, [props.item.message.content, isStreaming]);

  function onDelete() {
    dispatch(deleteMessage(props.index));
  }

  function onKnoxGeneration() {
    window.postMessage(
      {
        messageType: "userInput",
        data: {
          input: t('continueFromWhereYouLeftOff'),
        },
      },
      "*",
    );
  }

  return (
    <div
    // className={isStepAheadOfCurCheckpoint ? "opacity-25" : "relative"}
    >
      <div 
        className="p-2 px-2.5 overflow-hidden min-w-0 relative rounded-b [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        style={{
          backgroundColor: 'var(--vscode-background)',
          fontSize: `${getFontSize()}px`
        }}
      >
        {/* Gradient line at top */}
        <div 
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: 'linear-gradient(90deg, rgba(21, 153, 148, 0) 0%, rgba(21, 153, 148, 0.2) 50%, rgba(21, 153, 148, 0) 100%)'
          }}
        />
        
        {uiConfig?.displayRawMarkdown ? (
          <>
            {/* Display images for user messages in raw markdown mode */}
            {props.item.message.role === "user" && (
              <MessageImages images={getImageParts(props.item.message.content)} />
            )}
            <pre
              className="max-w-full overflow-x-auto whitespace-pre-wrap wrap-break-word p-4"
              style={{ fontSize: getFontSize() - 2 }}
            >
              {renderChatMessage(props.item.message)}
            </pre>
          </>
        ) : (
          <>
            <Reasoning {...props} />

            {/* Display images for user messages */}
            {props.item.message.role === "user" && (
              <MessageImages images={getImageParts(props.item.message.content)} />
            )}

            <StyledMarkdownPreview
              isRenderingInStepContainer
              source={stripImages(props.item.message.content)}
              itemIndex={props.index}
              isStreaming={isStreaming && props.isLast}
            />
          </>
        )}
        {props.isLast && <ThinkingIndicator historyItem={props.item} />}
      </div>
      {/* We want to occupy space in the DOM regardless of whether the actions are visible to avoid jank on stream complete */}
      {!hideActionSpace && (
        <div className={`mt-2 h-7 transition-opacity duration-300 ease-in-out`}>
          {!hideActions && (
            <ResponseActions
              isTruncated={isTruncated}
              onDelete={onDelete}
              onKnoxGeneration={onKnoxGeneration}
              index={props.index}
              item={props.item}
            />
          )}
        </div>
      )}
    </div>
  );
}
