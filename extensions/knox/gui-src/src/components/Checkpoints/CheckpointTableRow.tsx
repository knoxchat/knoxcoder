import React, { useContext, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Separator } from "../ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { compareCheckpointTargets } from "./checkpointListQuery";
import { Calendar, Hash, RotateCcw, Info, User, Bot, File, FolderOpen, Clock, PanelLeftOpen, PanelLeftClose, GitCompare, Brain, Pin, Tag, Trash2, Loader2 } from "lucide-react";
import { FileTreeView } from "./FileTreeView";
import { CodeViewer } from "./CodeViewer";
import { ResizableSplitter } from "./ResizableSplitter";
import { PierreDiffViewer } from "./PierreDiffViewer";
import { RestorePreviewDialog } from "./RestorePreviewDialog";
import { indexedDBManager } from "../../util/indexedDB";
import { ToolTip } from "../gui/Tooltip";
import { CP_ICON, CP_ICON_META } from "./checkpointUi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

import type { CheckpointMetadata } from "./checkpointTypes";

const formatDate = (date: Date, t: (key: string, opts?: any) => string): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return diffMins < 1 ? t('justNow') : t('minutesAgo', { count: diffMins });
  } else if (diffHours < 24) {
    return t('hoursAgo', { count: diffHours });
  } else if (diffDays === 1) {
    return t('yesterday');
  } else if (diffDays < 7) {
    return t('daysAgo', { count: diffDays });
  } else {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
};

// Helper function to format description - detects and formats JSON
function formatDescription(description: string, t: (key: string) => string): React.ReactNode {
  if (!description) return t('noDescriptionAvailable');
  
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(description);
    const formattedJson = JSON.stringify(parsed, null, 2);
    
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Hash className={CP_ICON_META} />
          {t('formattedJson')}
        </div>
        <div className="bg-background/80 p-3 rounded border max-h-40 overflow-y-auto">
          <pre className="font-mono text-xs whitespace-pre-wrap">
            <code className="language-json text-foreground">
              {formattedJson}
            </code>
          </pre>
        </div>
      </div>
    );
  } catch {
    // If not valid JSON, check if it looks like JSON-ish content
    if (description.includes('"type"') || description.includes('"text"') || description.startsWith('{')) {
      return (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className={CP_ICON_META} />
            {t('rawContentInvalidJson')}
          </div>
          <div className="bg-background/80 p-3 rounded border max-h-40 overflow-y-auto">
            <pre className="font-mono text-xs whitespace-pre-wrap odp-text-orange">
              {description}
            </pre>
          </div>
        </div>
      );
    }
    
    // Regular text description
    return <span className="text-foreground">{description}</span>;
  }
}

function ActionButtonWithTooltip({
  tooltipId,
  tooltip,
  children,
  ...props
}: {
  tooltipId: string;
  tooltip: React.ReactNode;
} & React.ComponentProps<typeof Button>) {
  return (
    <>
      <Button data-tooltip-id={tooltipId} {...props}>
        {children}
      </Button>
      <ToolTip id={tooltipId} place="top" style={{ textAlign: "left", maxWidth: 260 }}>
        {tooltip}
      </ToolTip>
    </>
  );
}

interface CheckpointTableRowProps {
  checkpointMetadata: CheckpointMetadata;
  date: Date;
  index?: number; // Make optional since it's not used
  isSelectionMode: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  onSelect: (selected: boolean, event?: { shiftKey?: boolean }) => void;
  onDelete?: (checkpointId: string) => void;
  /** Full checkpoint catalog, used to offer arbitrary compare targets */
  allCheckpoints?: Array<Pick<CheckpointMetadata, "id" | "description" | "dateCreated">>;
}

/** Checkpoint-shaped object consumed by the diff viewers */
interface DiffSideCheckpoint {
  id: string;
  description: string;
  created: string;
  fileSnapshots: Array<{
    relativePath: string;
    content: string;
    encoding: string;
    lastModified: Date;
    size: number;
  }>;
}

export function CheckpointTableRow({
  checkpointMetadata,
  date,
  index: _index, // Prefix with underscore to indicate intentionally unused
  isSelectionMode,
  isSelected,
  isFocused = false,
  onSelect,
  onDelete,
  allCheckpoints,
}: CheckpointTableRowProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pinned, setPinned] = useState(!!checkpointMetadata.pinned);
  const [restoringFilePath, setRestoringFilePath] = useState<string | null>(null);
  const [checkpointDetails, setCheckpointDetails] = useState<any>(null);
  const [previousCheckpoint, setPreviousCheckpoint] = useState<any>(null);
  const [diffPair, setDiffPair] = useState<{ old: DiffSideCheckpoint; new: DiffSideCheckpoint } | null>(null);
  const [compareTargetId, setCompareTargetId] = useState<string>("previous");
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showRestorePreview, setShowRestorePreview] = useState(false);
  const [previewRewindMemory, setPreviewRewindMemory] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [isCopied, setIsCopied] = useState(false);
  // Initialize file tree expanded state from IndexedDB, defaulting to true for first-time users
  const [isFileTreeExpanded, setIsFileTreeExpanded] = useState(true);

  // Load file tree expanded state from IndexedDB on mount
  useEffect(() => {
    let mounted = true;

    async function loadExpandedState() {
      try {
        const saved = await indexedDBManager.getItem('knoxchat-file-tree-expanded' as any);
        
        if (mounted && saved !== undefined) {
          setIsFileTreeExpanded(typeof saved === 'string' ? JSON.parse(saved) : saved);
        }
      } catch (error) {
        console.warn('Failed to load file tree state from IndexedDB:', error);
      }
    }

    loadExpandedState();

    return () => {
      mounted = false;
    };
  }, []);

  // Save file tree expanded state to IndexedDB whenever it changes
  useEffect(() => {
    indexedDBManager.setItem('knoxchat-file-tree-expanded' as any, isFileTreeExpanded as any).catch((error) => {
      console.warn('Failed to save file tree state to IndexedDB:', error);
    });
  }, [isFileTreeExpanded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setPinned(!!checkpointMetadata.pinned);
  }, [checkpointMetadata.pinned]);

  const handleRowClick = (event: React.MouseEvent) => {
    if (event.shiftKey || isSelectionMode) {
      onSelect(!isSelected, { shiftKey: event.shiftKey });
    }
  };

  const handleCheckboxChange = (checked: boolean) => {
    onSelect(checked);
  };

  const handleDetailsClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isLoadingDetails) {
      return;
    }
    
    setIsLoadingDetails(true);
    
    try {
      // Fetch detailed checkpoint data from extension
      const response = await ideMessenger.request("getCheckpointDetails", {
        checkpointId: checkpointMetadata.id
      });
      
      if (response.status === "success" && response.content.success && response.content.details) {
        setCheckpointDetails(response.content.details);
        setSelectedFile(null); // Reset selected file when opening modal
        setShowDetailsModal(true);
        
        // Also compute the diff for the compare view (async, don't wait)
        setCompareTargetId("previous");
        loadDiff("previous");
      } else {
        console.error('Failed to fetch checkpoint details');
      }
    } catch (error) {
      console.error('Failed to fetch checkpoint details:', error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  /**
   * Load an accurate checkpoint diff from the extension. The extension
   * reconstructs true file contents at both checkpoints (checkpoints only
   * store delta snapshots), which fixes files being mislabeled as added.
   * targetId "workspace" compares the checkpoint against the live workspace.
   * Falls back to the legacy previous-checkpoint comparison on failure.
   */
  const loadDiff = async (targetId: string) => {
    setIsLoadingDiff(true);
    setDiffPair(null);
    setPreviousCheckpoint(null);
    
    try {
      const response = await ideMessenger.request("computeCheckpointDiff", {
        checkpointId: checkpointMetadata.id,
        ...(targetId === "workspace"
          ? { compareToWorkspace: true }
          : targetId !== "previous"
            ? { compareToCheckpointId: targetId }
            : {}),
      });
      
      if (response.status === "success" && response.content.success && response.content.diff) {
        const diff = response.content.diff;
        
        if (!diff.oldCheckpoint) {
          // First checkpoint in history — nothing to compare against
          setDiffPair(null);
          return;
        }
        
        const toSnapshot = (relativePath: string, content: string, encoding?: string) => ({
          relativePath,
          content,
          encoding: encoding || "utf8",
          lastModified: new Date(),
          // Base64 length overstates the real file size by ~4/3
          size: encoding === "base64" ? Math.round(content.length * 0.75) : content.length,
        });
        
        setDiffPair({
          old: {
            id: diff.oldCheckpoint.id,
            description: diff.oldCheckpoint.description,
            created: diff.oldCheckpoint.created,
            fileSnapshots: diff.files
              .filter((f) => f.oldContent !== null)
              .map((f) => toSnapshot(f.relativePath, f.oldContent as string, f.oldEncoding)),
          },
          new: {
            id: diff.newCheckpoint.id,
            description: targetId === "workspace" ? t('currentWorkspaceOption') : diff.newCheckpoint.description,
            created: diff.newCheckpoint.created,
            fileSnapshots: diff.files
              .filter((f) => f.newContent !== null)
              .map((f) => toSnapshot(f.relativePath, f.newContent as string, f.newEncoding)),
          },
        });
        return;
      }
      
      if (targetId !== "workspace") {
        await loadPreviousCheckpointFallback();
      }
    } catch (error) {
      console.error('Failed to compute checkpoint diff:', error);
      if (targetId !== "workspace") {
        await loadPreviousCheckpointFallback();
      }
    } finally {
      setIsLoadingDiff(false);
    }
  };

  /** Legacy comparison against raw snapshots of the previous checkpoint */
  const loadPreviousCheckpointFallback = async () => {
    try {
      const response = await ideMessenger.request("getPreviousCheckpoint", {
        checkpointId: checkpointMetadata.id
      });
      
      if (response.status === "success" && response.content.success && response.content.details) {
        setPreviousCheckpoint(response.content.details);
      }
    } catch (error) {
      console.error('Failed to fetch previous checkpoint:', error);
    }
  };

  const handleCompareTargetChange = (targetId: string) => {
    setCompareTargetId(targetId);
    loadDiff(targetId);
  };

  // Older checkpoints available as compare baselines
  const compareOptions = compareCheckpointTargets(allCheckpoints || [], checkpointMetadata.id);

  const handleRestoreClick = (
    e: React.MouseEvent,
    rewindMemory = false,
  ) => {
    e.stopPropagation();

    if (isRestoring) {
      return;
    }

    setPreviewRewindMemory(rewindMemory);
    setShowRestorePreview(true);
  };

  const handlePinClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pinned;
    try {
      const response = await ideMessenger.request("pinCheckpoint", {
        checkpointId: checkpointMetadata.id,
        pinned: next,
      });
      if (response.status === "success" && response.content.success) {
        setPinned(next);
      }
    } catch (error) {
      console.error("Failed to pin checkpoint:", error);
    }
  };

  /** Restore a single file from this checkpoint (selective restore) */
  const handleRestoreFile = async (relativePath: string) => {
    if (restoringFilePath) {
      return;
    }
    
    setRestoringFilePath(relativePath);
    
    try {
      await ideMessenger.request("restoreCheckpointFiles", {
        checkpointId: checkpointMetadata.id,
        relativePaths: [relativePath],
      });
    } catch (error) {
      console.error('Failed to restore file from checkpoint:', error);
    } finally {
      setTimeout(() => setRestoringFilePath(null), 1500);
    }
  };

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      await navigator.clipboard.writeText(checkpointMetadata.id);
      setIsCopied(true);
      
      // Reset after 3 seconds
      setTimeout(() => setIsCopied(false), 3000);
    } catch (error) {
      console.error('Failed to copy checkpoint ID:', error);
    }
  };

  return (
    <>
      <Card 
        className={cn(
          "@container min-w-0 transition-all duration-200 hover:shadow-md cursor-pointer border-border/40",
          isSelected && "ring-2 ring-primary/20 border-primary/50 bg-primary/5",
          isFocused && !isSelected && "ring-1 ring-foreground/30",
        )}
        data-testid="checkpoint-row"
        data-checkpoint-id={checkpointMetadata.id}
        onClick={handleRowClick}
      >
        <CardContent className="p-2.5">
          <div className="flex items-start gap-2">
            {isSelectionMode && (
              <div className="flex items-center pt-0.5">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={handleCheckboxChange}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="min-w-0 font-medium text-sm text-foreground leading-snug line-clamp-2 break-words [overflow-wrap:anywhere]">
                {checkpointMetadata.description}
              </h3>
              {checkpointMetadata.conversationContext && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {checkpointMetadata.conversationContext.messageContent.slice(0, 100)}
                  {checkpointMetadata.conversationContext.messageContent.length > 100 ? '...' : ''}
                </p>
              )}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-xs font-normal">
                  <Calendar className={`${CP_ICON_META} mr-1`} />
                  {formatDate(date, t)}
                </Badge>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs cursor-pointer hover:bg-muted/50 transition-colors font-normal",
                    isCopied && "odp-chip-green border"
                  )}
                  onClick={handleCopyId}
                  title={isCopied ? t('copiedToClipboard') : t('clickToCopyId')}
                >
                  <Hash className={`${CP_ICON_META} mr-1`} />
                  {isCopied ? t('copied') : checkpointMetadata.id.slice(0, 8)}
                </Badge>
                {pinned && (
                  <Badge variant="outline" className="text-xs font-normal">
                    <Pin className={`${CP_ICON_META} mr-1`} />
                    {t("pinned")}
                  </Badge>
                )}
                {checkpointMetadata.tags?.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-xs font-normal"
                    title={t("tags")}
                  >
                    <Tag className={`${CP_ICON_META} mr-1`} />
                    {tag}
                  </Badge>
                ))}
                {checkpointMetadata.conversationContext?.role && (
                  <Badge variant={checkpointMetadata.conversationContext.role === 'user' ? 'default' : 'secondary'} className="text-xs font-normal">
                    {checkpointMetadata.conversationContext.role === 'user' ? (
                      <><User className={`${CP_ICON_META} mr-1`} />{t('user')}</>
                    ) : (
                      <><Bot className={`${CP_ICON_META} mr-1`} />{t('ai')}</>
                    )}
                  </Badge>
                )}
                {checkpointMetadata.fileStats && checkpointMetadata.fileStats.total > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                    title={t('fileStatsTooltip', {
                      created: checkpointMetadata.fileStats.created,
                      modified: checkpointMetadata.fileStats.modified,
                      deleted: checkpointMetadata.fileStats.deleted,
                    })}
                  >
                    <File className={`${CP_ICON_META} mr-1`} />
                    {checkpointMetadata.fileStats.total}
                    {checkpointMetadata.fileStats.created > 0 && (
                      <span className="ml-1 font-medium odp-text-green">+{checkpointMetadata.fileStats.created}</span>
                    )}
                    {checkpointMetadata.fileStats.modified > 0 && (
                      <span className="ml-1 font-medium odp-text-yellow">~{checkpointMetadata.fileStats.modified}</span>
                    )}
                    {checkpointMetadata.fileStats.deleted > 0 && (
                      <span className="ml-1 font-medium odp-text-red">−{checkpointMetadata.fileStats.deleted}</span>
                    )}
                  </Badge>
                )}
              </div>

              <div
                className="flex flex-wrap items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                  <ActionButtonWithTooltip
                    tooltipId={`cp-pin-${checkpointMetadata.id}`}
                    tooltip={pinned ? t("unpinCheckpointTooltip") : t("pinCheckpointTooltip")}
                    variant={pinned ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-8 gap-1 px-2",
                      !pinned && "odp-text-yellow hover:bg-yellow/10 hover:text-[var(--odp-yellow)]",
                    )}
                    onClick={handlePinClick}
                    aria-label={pinned ? t("unpinCheckpoint") : t("pinCheckpoint")}
                    aria-pressed={pinned}
                  >
                    <Pin className={CP_ICON} />
                    <span className="hidden @[22rem]:inline">
                      {pinned ? t("unpinCheckpoint") : t("pinCheckpoint")}
                    </span>
                  </ActionButtonWithTooltip>

                  <ActionButtonWithTooltip
                    tooltipId={`cp-details-${checkpointMetadata.id}`}
                    tooltip={t('details')}
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2 odp-text-blue hover:bg-blue/10 hover:text-[var(--odp-blue)]"
                    onClick={handleDetailsClick}
                    disabled={isLoadingDetails}
                    aria-label={t('details')}
                  >
                    {isLoadingDetails ? (
                      <Loader2 className={`${CP_ICON} animate-spin`} />
                    ) : (
                      <Info className={CP_ICON} />
                    )}
                    <span className="hidden @[22rem]:inline">
                      {isLoadingDetails ? t('loading') : t('details')}
                    </span>
                  </ActionButtonWithTooltip>

                  <ActionButtonWithTooltip
                    tooltipId={`cp-restore-${checkpointMetadata.id}`}
                    tooltip={t('restoreTooltip')}
                    variant={isRestoring ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-8 gap-1 px-2",
                      !isRestoring && "odp-text-cyan hover:bg-cyan/10 hover:text-[var(--odp-cyan)]",
                    )}
                    onClick={(e) => handleRestoreClick(e, false)}
                    disabled={isRestoring}
                    aria-label={t('restore')}
                  >
                    {isRestoring ? (
                      <Loader2 className={`${CP_ICON} animate-spin`} />
                    ) : (
                      <RotateCcw className={CP_ICON} />
                    )}
                    <span className="hidden @[18rem]:inline">
                      {isRestoring ? t('restoring') : t('restore')}
                    </span>
                  </ActionButtonWithTooltip>

                  <ActionButtonWithTooltip
                    tooltipId={`cp-restore-memory-${checkpointMetadata.id}`}
                    tooltip={
                      <div>
                        <div className="font-medium">{t("restoreWithMemory")}</div>
                        <div className="mt-0.5 opacity-80">{t("restoreWithMemoryTooltip")}</div>
                      </div>
                    }
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2 odp-text-purple hover:bg-purple/10 hover:text-[var(--odp-purple)]"
                    onClick={(e) => handleRestoreClick(e, true)}
                    disabled={isRestoring}
                    aria-label={t("restoreWithMemory")}
                  >
                    <Brain className={CP_ICON} />
                    <span className="hidden @[22rem]:inline">
                      {t("restoreWithMemoryShort")}
                    </span>
                  </ActionButtonWithTooltip>

                  {onDelete && (
                    <ActionButtonWithTooltip
                      tooltipId={`cp-delete-${checkpointMetadata.id}`}
                      tooltip={t("deleteCheckpointTooltip")}
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2 odp-text-red text-red hover:bg-destructive/10 hover:text-red"
                      onClick={() => onDelete(checkpointMetadata.id)}
                      aria-label={t("deleteAction")}
                    >
                      <Trash2 className={CP_ICON} />
                      <span className="hidden @[22rem]:inline">
                        {t("deleteAction")}
                      </span>
                    </ActionButtonWithTooltip>
                  )}
                </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comprehensive Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="w-[99vw] h-[99vh] max-w-none max-h-none min-w-[320px] min-h-125 overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0 pb-0">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Info className={CP_ICON} />
              {t('checkpointDetails')}
            </DialogTitle>
            {/* <DialogDescription className="text-sm">
              {checkpointMetadata.id}
            </DialogDescription> */}
          </DialogHeader>
          {checkpointDetails && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <Tabs defaultValue={checkpointDetails.fileSnapshots && checkpointDetails.fileSnapshots.length > 0 ? "file-snapshots" : "basic-info"} className="w-full h-full flex flex-col">
                <TabsList className="grid w-full grid-cols-3 shrink-0">
                  <TabsTrigger value="basic-info" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm min-w-0 px-1 sm:px-3">
                    <Hash className={CP_ICON} />
                    <span className="truncate hidden md:inline">{t('basicInformation')}</span>
                    <span className="truncate md:hidden">{t('basic')}</span>
                  </TabsTrigger>
                  <TabsTrigger value="file-snapshots" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm min-w-0 px-1 sm:px-3" disabled={!checkpointDetails.fileSnapshots || checkpointDetails.fileSnapshots.length === 0}>
                    <File className={CP_ICON} />
                    <span className="truncate hidden md:inline">{t('fileSnapshots')} ({checkpointDetails.fileSnapshots?.length || 0})</span>
                    <span className="truncate md:hidden">{t('files')} ({checkpointDetails.fileSnapshots?.length || 0})</span>
                  </TabsTrigger>
                  <TabsTrigger value="diff" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm min-w-0 px-1 sm:px-3" disabled={!diffPair && !previousCheckpoint && !isLoadingDiff}>
                    <GitCompare className={CP_ICON} />
                    <span className="truncate hidden md:inline">{t('compareChanges')}</span>
                    <span className="truncate md:hidden">{t('diff')}</span>
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="basic-info" className="mt-3 flex-1 overflow-hidden">
                  <div className="space-y-3 md:space-y-4 h-full overflow-y-auto pr-2">
                    {/* Basic Information - Always Expanded */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">ID</div>
                      <div className="font-mono text-sm bg-muted/50 p-2 rounded">
                        {checkpointDetails.id}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">{t('created')}</div>
                      <div className="text-sm flex items-center gap-2">
                        <Clock className={CP_ICON} />
                        {new Date(checkpointDetails.created).toLocaleString()}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">{t('description')}</div>
                      <div className="text-sm bg-muted/50 p-2 rounded">
                        {formatDescription(checkpointDetails.description, t)}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">{t('workspacePath')}</div>
                      <div className="font-mono text-sm bg-muted/50 p-2 rounded flex items-center gap-2">
                        <FolderOpen className={CP_ICON} />
                        {checkpointDetails.workspacePath || t('notAvailable')}
                      </div>
                    </div>
                    {checkpointDetails.messageId && (
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium text-muted-foreground">{t('messageId')}</div>
                        <div className="font-mono text-sm bg-muted/50 p-2 rounded">
                          {checkpointDetails.messageId}
                        </div>
                      </div>
                    )}
                  </div>

                {/* Conversation Context */}
                {checkpointDetails.conversationContext && (
                  <>
                        <Separator />
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        {checkpointDetails.conversationContext.role === 'user' ? (
                          <><User className={CP_ICON} />{t('userContext')}</>
                        ) : (
                          <><Bot className={CP_ICON} />{t('aiContext')}</>
                        )}
                      </h3>
                      <div className="bg-muted/50 p-4 rounded-lg">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">
                          {checkpointDetails.conversationContext.messageContent}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{t('messageNumber', { number: checkpointDetails.conversationContext.index + 1 })}</span>
                        <span>•</span>
                        <span>{t('timestamp')}: {new Date(checkpointDetails.conversationContext.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  </>
                )}
                  </div>
                </TabsContent>
                
                <TabsContent value="file-snapshots" className="mt-3 flex-1 overflow-hidden">
                  {checkpointDetails.fileSnapshots && checkpointDetails.fileSnapshots.length > 0 ? (
                    <div className="h-full border rounded-lg overflow-hidden">
                      {isFileTreeExpanded ? (
                        /* Expanded State: ResizableSplitter with toggle button integrated */
                    <ResizableSplitter
                      leftPanel={
                            <div className="h-full flex flex-col">
                              {/* Toggle Button in File Tree */}
                              <div className="flex items-center justify-between p-1.5 border-b bg-muted/20">
                                <span className="text-xs font-medium text-muted-foreground">
                                  {t('fileTree')} ({checkpointDetails.fileSnapshots.length} {t('files')})
                                </span>
                                <button
                                  onClick={() => setIsFileTreeExpanded(false)}
                                  className="p-1 hover:bg-muted/50 transition-colors rounded"
                                  title={t('collapseFileTree')}
                                >
                                  <PanelLeftClose className={CP_ICON} />
                                </button>
                              </div>
                              <div className="flex-1 min-h-0 overflow-hidden">
                        <FileTreeView
                          files={checkpointDetails.fileSnapshots}
                          onFileSelect={setSelectedFile}
                          selectedFile={selectedFile}
                        />
                              </div>
                            </div>
                      }
                      rightPanel={
                        selectedFile ? (
                          <CodeViewer
                            file={selectedFile}
                            onRestoreFile={handleRestoreFile}
                            isRestoringFile={restoringFilePath === selectedFile.relativePath}
                          />
                        ) : (
                              <div className="bg-muted/10 flex items-center justify-center h-full">
                            <div className="text-center text-muted-foreground p-4">
                              <File className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-3 opacity-50" />
                              <p className="text-xs sm:text-sm">{t('selectFileFromTree')}</p>
                                  <p className="text-xs mt-2 opacity-70">{t('resizeFileTree')}</p>
                            </div>
                          </div>
                        )
                      }
                          defaultLeftWidth={Math.min(320, windowWidth * 0.25)}
                          minLeftWidth={Math.min(200, windowWidth * 0.15)}
                          maxLeftWidth={Math.min(500, windowWidth * 0.4)}
                        />
                      ) : (
                        /* Collapsed State: Only toggle button and code viewer */
                        <div className="h-full flex">
                          <div className="flex flex-col border-r bg-muted/20 w-12">
                            <button
                              onClick={() => setIsFileTreeExpanded(true)}
                              className="p-2 hover:bg-muted/50 transition-colors border-b flex items-center justify-center h-12"
                              title={t('expandFileTree')}
                            >
                              <PanelLeftOpen className={CP_ICON} />
                            </button>
                          </div>
                          <div className="flex-1 min-w-0">
                            {selectedFile ? (
                              <CodeViewer
                                file={selectedFile}
                                onRestoreFile={handleRestoreFile}
                                isRestoringFile={restoringFilePath === selectedFile.relativePath}
                              />
                            ) : (
                              <div className="bg-muted/10 flex items-center justify-center h-full">
                                <div className="text-center text-muted-foreground p-4">
                                  <File className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-3 opacity-50" />
                                  <p className="text-xs sm:text-sm">{t('clickPanelToExpandTree')}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full border rounded-lg bg-muted/10">
                      <div className="text-center text-muted-foreground p-4">
                        <File className="w-8 h-8 md:w-12 md:h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-xs md:text-sm">{t('noFileSnapshots')}</p>
                  </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="diff" className="mt-3 flex-1 overflow-hidden">
                  <div className="h-full flex flex-col">
                    {/* Compare controls */}
                    <div className="flex items-center justify-between gap-2 mb-2 px-1 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground shrink-0">
                          {t('compareAgainst')}
                        </span>
                        <Select
                          value={compareTargetId}
                          onValueChange={handleCompareTargetChange}
                          disabled={isLoadingDiff}
                        >
                          <SelectTrigger className="h-7 max-w-64 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="previous">{t('previousCheckpointOption')}</SelectItem>
                            <SelectItem value="workspace">{t('currentWorkspaceOption')}</SelectItem>
                            {compareOptions.map((cp) => (
                              <SelectItem key={cp.id} value={cp.id}>
                                {cp.description.length > 48
                                  ? `${cp.description.slice(0, 48)}…`
                                  : cp.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    {isLoadingDiff ? (
                      <div className="flex items-center justify-center flex-1 border rounded-lg bg-muted/10">
                        <div className="text-center text-muted-foreground p-8">
                          <div className="w-12 h-12 border-4 border-current border-t-transparent rounded-full animate-spin mx-auto mb-3 opacity-50" />
                          <p className="text-sm">{t('loadingPreviousCheckpoint')}</p>
                        </div>
                      </div>
                    ) : !(diffPair || previousCheckpoint) ? (
                      <div className="flex items-center justify-center flex-1 border rounded-lg bg-muted/10">
                        <div className="text-center text-muted-foreground p-8">
                          <GitCompare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p className="text-sm font-medium mb-1">{t('noPreviousCheckpoint')}</p>
                          <p className="text-xs">{t('firstCheckpointInHistory')}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-hidden">
                        <PierreDiffViewer
                          oldCheckpoint={diffPair ? diffPair.old : previousCheckpoint}
                          newCheckpoint={diffPair ? diffPair.new : checkpointDetails}
                        />
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              
                </div>
              )}

                {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t shrink-0">
                  <Button
                    variant={isRestoring ? "default" : "outline"}
                    size="sm"
                    onClick={(e) => handleRestoreClick(e, false)}
                    disabled={isRestoring}
              className="gap-2 flex-1 sm:flex-initial"
                  >
                    {isRestoring ? (
                      <>
                        <Loader2 className={`${CP_ICON} animate-spin`} />
                  <span className="hidden md:inline">{t('restoring')}</span>
                  <span className="md:hidden">{t('restoring')}...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className={CP_ICON} />
                  <span className="hidden md:inline">{t('restoreThisCheckpoint')}</span>
                  <span className="md:hidden">{t('restore')}</span>
                      </>
                    )}
                  </Button>
                  <ActionButtonWithTooltip
                    tooltipId={`cp-restore-memory-modal-${checkpointMetadata.id}`}
                    tooltip={
                      <div>
                        <div className="font-medium">{t("restoreWithMemory")}</div>
                        <div className="mt-0.5 opacity-80">{t("restoreWithMemoryTooltip")}</div>
                      </div>
                    }
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleRestoreClick(e, true)}
                    disabled={isRestoring}
                    className="gap-2 flex-1 sm:flex-initial"
                    aria-label={t("restoreWithMemory")}
                  >
                    <Brain className={CP_ICON} />
                    <span className="hidden sm:inline">{t("restoreWithMemory")}</span>
                  </ActionButtonWithTooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDetailsModal(false)}
              className="flex-1 sm:flex-initial"
                  >
                    {t('close')}
                  </Button>
                </div>
        </DialogContent>
      </Dialog>

      <RestorePreviewDialog
        open={showRestorePreview}
        checkpointId={checkpointMetadata.id}
        checkpointDescription={checkpointMetadata.description}
        rewindMemory={previewRewindMemory}
        onOpenChange={setShowRestorePreview}
        onRestoringChange={setIsRestoring}
      />
    </>
  );
}
