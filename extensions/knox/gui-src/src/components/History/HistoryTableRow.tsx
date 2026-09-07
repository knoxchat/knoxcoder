import { SessionMetadata } from "core";
import { renderChatMessage } from "core/util/messageContent";
import {
  getUriPathBasename,
} from "core/util/uri";
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { Input } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { setSelectedBlockSettingsSection } from "../../redux/slices/uiSlice";
import {
  deleteSession,
  getSession,
  loadSession,
  updateSession,
} from "../../redux/thunks/session";
import { CheckIcon, DeleteIcon, DownloadIcon, PencilSquareIcon } from "../../svg-icons";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import { formatSessionDate } from "./parseDate";

export function HistoryTableRow({
  sessionMetadata,
  date,
  index,
  isSelectionMode = false,
  isSelected = false,
  onSelect = () => {},
}: {
  sessionMetadata: SessionMetadata;
  date: Date;
  index: number;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sessionTitleEditValue, setSessionTitleEditValue] = useState(
    sessionMetadata.title,
  );
  const currentSessionId = useAppSelector((state) => state.session.id);
  const workspaceName = getUriPathBasename(
    sessionMetadata.workspaceDirectory || "",
  );
  const compactDate = formatSessionDate(date, true);
  const fullDate = formatSessionDate(date);

  useEffect(() => {
    setSessionTitleEditValue(sessionMetadata.title);
  }, [sessionMetadata]);

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (sessionTitleEditValue !== sessionMetadata.title) {
        // imperfect solution of loading session just to update it
        // but fine for now, pretty low latency
        const currentSession = await getSession(
          ideMessenger,
          sessionMetadata.sessionId,
        );
        await dispatch(
          updateSession({
            ...currentSession,
            title: sessionTitleEditValue,
          }),
        );
      }
      setEditing(false);
    } else if (e.key === "Escape") {
      setSessionTitleEditValue(sessionMetadata.title);
      setEditing(false);
    }
  };

  const handleClick = async () => {
    if (isSelectionMode) {
      onSelect(!isSelected);
      return;
    }
    
    if (sessionMetadata.sessionId !== currentSessionId) {
      await dispatch(
        loadSession({
          sessionId: sessionMetadata.sessionId,
          saveCurrentSession: true,
        }),
      );
    }
    // Close the in-chat History overlay (Lump) when a session is opened
    dispatch(setSelectedBlockSettingsSection(null));
    navigate("/");
  };

  return (
    <div className="min-w-0 p-1" data-testid={`history-row-${index}`}>
      <div
        className={cn(
          "@container relative box-border flex min-w-0 max-w-full items-start overflow-hidden rounded-lg p-3 cursor-pointer transition-all",
          "border",
          isSelected 
            ? "bg-[rgba(21,153,148,0.08)] border-[rgba(21,153,148,0.3)]" 
            : "bg-transparent border-transparent",
          isSelected 
            ? "hover:bg-[rgba(21,153,148,0.12)]" 
            : "hover:bg-[rgba(60,60,60,0.2)]"
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
      >
        {isSelectionMode && (
          <div
            className={cn(
              "mt-0.5 mr-2 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-all @[16rem]:mr-3",
              "border-[rgba(120,120,120,0.3)] bg-[rgba(60,60,60,0.2)]",
              "hover:border-[rgba(21,153,148,0.5)]"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(!isSelected);
            }}
          >
            <div
              className={cn(
                "flex h-full w-full items-center justify-center rounded-[3px] text-white transition-all",
                isSelected ? "bg-[rgba(21,153,148,0.8)]" : "bg-transparent"
              )}
            >
              {isSelected && <CheckIcon className="h-3 w-3" />}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 overflow-hidden">
          {editing ? (
            <div className="min-w-0">
              <Input
                type="text"
                className="w-full min-w-0"
                ref={(titleInput) => {
                  if (titleInput) {
                    titleInput.focus();
                  }
                }}
                value={sessionTitleEditValue}
                onChange={(e) => setSessionTitleEditValue(e.target.value)}
                onKeyUp={(e) => handleKeyUp(e)}
                onBlur={() => setEditing(false)}
              />
            </div>
          ) : (
            <span
              className={cn(
                "block min-w-0 truncate text-[13px] font-semibold",
                hovered && !isSelectionMode && "pr-20 @[22rem]:pr-24",
              )}
              title={sessionMetadata.title}
            >
              {sessionMetadata.title}
            </span>
          )}

          <div className="flex min-w-0 flex-col gap-0.5 text-xs text-[#9ca3af] @[16rem]:flex-row @[16rem]:items-center @[16rem]:gap-2">
            {workspaceName ? (
              <span className="min-w-0 truncate" title={workspaceName}>
                {workspaceName}
              </span>
            ) : null}
            <time
              className="shrink-0 whitespace-nowrap tabular-nums @[16rem]:ml-auto"
              dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
              title={fullDate}
            >
              <span className="@[22rem]:hidden">{compactDate}</span>
              <span className="hidden @[22rem]:inline">{fullDate}</span>
            </time>
          </div>
        </div>

        {hovered && !editing && !isSelectionMode && (
          <div 
            className="absolute right-2 top-2 z-10 flex shrink-0 items-center gap-1 rounded-full p-1 shadow-md backdrop-blur-sm @[18rem]:right-3 @[18rem]:gap-2 @[18rem]:p-1.5"
            style={{
              backgroundColor: 'rgba(30, 30, 30, 0.85)',
            }}
          >
            <HeaderButtonWithToolTip
              text={t('download')}
              onClick={async (e) => {
                e.stopPropagation();
                console.log('Download button clicked for session:', sessionMetadata.sessionId);
                
                try {
                  // Load the full session data
                  console.log('Loading session data...');
                  const session = await getSession(ideMessenger, sessionMetadata.sessionId);
                  console.log('Session loaded:', session);
                  
                  // Format the session as markdown similar to the share command
                  const now = new Date();
                  let content = `### [Knox](https://knox.chat) ${t('knoxSessionTranscript')}\n ${t('exported')}: ${now.toLocaleString()}`;
                  
                  // Add session title and workspace info
                  content += `\n\n**${t('sessionLabel')}:** ${session.title}`;
                  if (session.workspaceDirectory) {
                    content += `\n**${t('workspaceLabel')}:** ${getUriPathBasename(session.workspaceDirectory)}`;
                  }
                  
                  // Format each message in the history
                  if (session.history && session.history.length > 0) {
                    for (const historyItem of session.history) {
                      const msg = historyItem.message;
                      let msgText = renderChatMessage(msg);
                      
                      // Format messages as blockquotes
                      msgText = msgText.replace(/^/gm, "> ");
                      
                      content += `\n\n#### ${
                        msg.role === "user" ? `_${t('userRole')}_` : `_${t('assistantRole')}_`
                      }\n\n${msgText}`;
                    }
                  } else {
                    content += `\n\n_${t('noMessagesInSession')}_`;
                  }
                  
                  // Create a safe filename from the session title
                  const safeTitle = sessionMetadata.title
                    .replace(/[^a-z0-9]/gi, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')
                    .substring(0, 50) || 'session';
                  
                  const timestamp = now.toISOString().split('T')[0]; // YYYY-MM-DD format
                  const filename = `${timestamp}_${safeTitle}.md`;
                  
                  console.log('Creating file with filename:', filename);
                  
                  // Get workspace directories to determine where to save
                  const workspaceDirsResult = await ideMessenger.request("getWorkspaceDirs", undefined);
                  if (workspaceDirsResult.status === "error") {
                    throw new Error(workspaceDirsResult.error);
                  }
                  const workspaceDirs: string[] = workspaceDirsResult.content;
                  const workspaceDir = workspaceDirs?.[0];
                  
                  let filePath: string;
                  if (workspaceDir) {
                    // Save in workspace root
                    const workspacePath = workspaceDir.replace('file://', '');
                    filePath = `${workspacePath}/${filename}`;
                  } else {
                    // Fallback to a default location
                    filePath = `/tmp/${filename}`;
                  }
                  
                  // Convert to file URL
                  const fileUrl = `file://${filePath}`;
                  
                  console.log('Saving file to:', fileUrl);
                  
                  // Save the file using VSCode API
                  await ideMessenger.request("writeFile", { path: fileUrl, contents: content });
                  
                  // Optionally open the file
                  await ideMessenger.request("openFile", { path: fileUrl });
                  
                  console.log('File saved and opened successfully');
                  
                  // Show a success message (optional)
                  await ideMessenger.request("showToast", ["info", t('sessionExportedTo', { filename })]);
                  
                } catch (error) {
                  console.error('Error downloading session:', error);
                  
                  // Show error message
                  const errorMessage = error instanceof Error ? error.message : t('unknownErrorOccurred');
                  await ideMessenger.request("showToast", ["error", t('failedToExportSession', { error: errorMessage })]);
                }
              }}
            >
              <span className="h-4 w-4">
                <DownloadIcon />
              </span>
            </HeaderButtonWithToolTip>
            <HeaderButtonWithToolTip
              text={t('edit')}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              <PencilSquareIcon />
            </HeaderButtonWithToolTip>
            <HeaderButtonWithToolTip
              text={t('delete')}
              onClick={async (e) => {
                e.stopPropagation();
                await dispatch(deleteSession(sessionMetadata.sessionId));
              }}
            >
              <span className="h-4 w-4">
                <DeleteIcon />
              </span>
            </HeaderButtonWithToolTip>
          </div>
        )}
      </div>
    </div>
  );
}
