import { ChatHistoryItem } from "core";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import { RestorePreviewDialog } from "../Checkpoints/RestorePreviewDialog";

export interface CheckpointButtonProps {
  item: ChatHistoryItem;
  index: number;
}

export default function CheckpointButton({ item, index }: CheckpointButtonProps) {
  const { t } = useTranslation();
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showRestorePreview, setShowRestorePreview] = useState(false);
  const [previewRewindMemory, setPreviewRewindMemory] = useState(false);
  const ideMessenger = useContext(IdeMessengerContext);
  const hasFetchedRef = useRef(false); // Track if we've already fetched for this component instance

  useEffect(() => {
    const messageId = (item.message as any).id;
    if (!messageId) {
      return;
    }

    // Only process once per component instance to prevent duplicate checkpoint creation
    if (hasFetchedRef.current) {
      return;
    }

    const checkOrCreateCheckpoint = async () => {
      hasFetchedRef.current = true;
      
      try {
        // STEP 1: Check if a checkpoint already exists for this message
        const existingResponse = await ideMessenger.request("getCheckpointForMessage", {
          messageId
        });
        
        if (existingResponse.status === "success" && existingResponse.content.checkpointId) {
          // Checkpoint already exists - use it
          setCheckpointId(existingResponse.content.checkpointId);
          return;
        }

        // STEP 2: No checkpoint exists yet - create one (only for assistant messages)
        // User messages no longer create checkpoints
        if (item.message.role !== "assistant") {
          // Don't show UI button or create checkpoint here for non-assistant messages
          return;
        }

        // Create a stable identifier to prevent duplicates
        const messageContent = typeof item.message.content === 'string' 
          ? item.message.content 
          : JSON.stringify(item.message.content);
        const stableId = `${item.message.role}-${index}-${messageId}`;

        // Check if checkpoint exists by stableId (in case messageId mapping is missing)
        const stableResponse = await ideMessenger.request("getCheckpointForStableId", {
          stableId
        });
        
        if (stableResponse.status === "success" && stableResponse.content.checkpointId) {
          // Found by stable ID
          setCheckpointId(stableResponse.content.checkpointId);
          return;
        }

        // Create new checkpoint with minimal description
        const description = item.message.role === "assistant" 
          ? `Assistant response at index ${index}`
          : `User message at index ${index}`;

        const createResponse = await ideMessenger.request("createCheckpointForMessage", {
          messageId,
          description,
          stableId,
          conversationContext: {
            messageContent: messageContent.substring(0, 500), // Limit size
            role: item.message.role,
            timestamp: new Date().toISOString(),
            index: index
          }
        });
        
        if (createResponse.status === "success" && createResponse.content.checkpointId) {
          setCheckpointId(createResponse.content.checkpointId);
        }
      } catch (error) {
        console.error('Failed to check/create checkpoint:', error);
        // Reset fetch flag on error so it can be retried if component remounts
        hasFetchedRef.current = false;
      }
    };
    
    checkOrCreateCheckpoint();
  }, [item.message.role, index, ideMessenger]); // Only depend on stable properties

  const handleRestoreClick = async (event?: MouseEvent) => {
    if (!checkpointId) {
      return;
    }

    setPreviewRewindMemory(Boolean(event?.shiftKey));
    setShowRestorePreview(true);
  };

  // Only show button if we have a checkpoint
  if (!checkpointId) {
    return null;
  }

  // Generate shortened checkpoint ID for tooltip (first 8 characters like in checkpoint list)
  const shortenedId = checkpointId.slice(0, 8);
  const tooltipText = isRestoring
    ? t("restoring")
    : t("restoreCheckpointHint", { id: shortenedId });

  return (
    <>
    <HeaderButtonWithToolTip
      testId={`checkpoint-restore-button-${index}`}
      text={tooltipText}
      tabIndex={-1}
      onClick={handleRestoreClick}
      disabled={isRestoring}
    >
      <span className={`h-3.5 w-3.5 ${isRestoring ? 'animate-spin' : ''}`}>
        {isRestoring ? (
          // Loading spinner
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
            />
          </svg>
        ) : (
          // Restore icon
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 2 24 24"><path fill="#159994" d="M12 21q-3.15 0-5.575-1.912T3.275 14.2q-.1-.375.15-.687t.675-.363q.4-.05.725.15t.45.6q.6 2.25 2.475 3.675T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H8q.425 0 .713.288T9 9t-.288.713T8 10H4q-.425 0-.712-.288T3 9V5q0-.425.288-.712T4 4t.713.288T5 5v1.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m0-7q-.825 0-1.412-.587T10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14"/></svg>
          // <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          //   <path
          //     fill="#159994"
          //     d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"
          //   />
          // </svg>
        )}
      </span>
    </HeaderButtonWithToolTip>
    {checkpointId && (
      <RestorePreviewDialog
        open={showRestorePreview}
        checkpointId={checkpointId}
        rewindMemory={previewRewindMemory}
        onOpenChange={setShowRestorePreview}
        onRestoringChange={setIsRestoring}
      />
    )}
    </>
  );
}
