import MiniSearch from "minisearch";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppSelector } from "../../redux/hooks";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Archive, Search, X, CheckSquare, Square, Trash2, Info, Check, GitCompare, Loader2 } from "lucide-react";
import Shortcut from "../gui/Shortcut";
import { CP_ICON, CP_ICON_EMPTY, CP_ICON_META } from "./checkpointUi";
import { parseDate } from "../History/parseDate";

import { CheckpointTableRow } from "./CheckpointTableRow";
import { CheckpointCompareDialog } from "./CheckpointCompareDialog";
import { RestorePreviewDialog } from "./RestorePreviewDialog";
import type { CheckpointMetadata } from "./checkpointTypes";
import {
  CHECKPOINT_LIST_PAGE_SIZE,
  buildCheckpointSearchDocument,
  chronologicalCheckpointPair,
  selectCheckpointIdRange,
} from "./checkpointListQuery";

export type { CheckpointMetadata } from "./checkpointTypes";

export function Checkpoints() {
  const { t } = useTranslation();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);
  const loadingRef = useRef(false);
  const checkpointListRef = useRef<CheckpointMetadata[]>([]);
  const sessionId = useAppSelector((state) => state.session.id);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [thisSessionOnly, setThisSessionOnly] = useState(true);
  const [selectedCheckpoints, setSelectedCheckpoints] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [checkpointList, setCheckpointList] = useState<CheckpointMetadata[]>([]);
  const [compareCatalog, setCompareCatalog] = useState<Array<{ id: string; description: string; dateCreated: string }>>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  const [workspaceFolders, setWorkspaceFolders] = useState<Array<{ path: string; name: string }>>([]);
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(null);
  const [keyboardRestoreId, setKeyboardRestoreId] = useState<string | null>(null);

  const minisearch = useRef<MiniSearch>(
    new MiniSearch({
      fields: ["description", "id", "tags", "sessionId", "paths"],
      storeFields: ["description", "id", "tags", "sessionId", "paths"],
    }),
  ).current;

  checkpointListRef.current = checkpointList;

  const applyListResponse = (
    content: {
      checkpoints: CheckpointMetadata[];
      total?: number;
      hasMore?: boolean;
      compareCatalog?: Array<{ id: string; description: string; dateCreated: string }>;
      workspaceFolders?: Array<{ path: string; name: string }>;
      activeWorkspacePath?: string;
    },
    append: boolean,
  ) => {
    setCheckpointList((previous) => {
      if (!append) {
        return content.checkpoints;
      }
      const seen = new Set(previous.map((checkpoint) => checkpoint.id));
      return [...previous, ...content.checkpoints.filter((checkpoint) => !seen.has(checkpoint.id))];
    });
    setTotalCount(content.total ?? content.checkpoints.length);
    setHasMore(content.hasMore === true);
    if (!append && content.compareCatalog) {
      setCompareCatalog(content.compareCatalog);
    }
    setWorkspaceFolders(content.workspaceFolders ?? []);
    setActiveWorkspacePath(content.activeWorkspacePath ?? null);
    if (content.activeWorkspacePath) {
      setCurrentWorkspace(content.activeWorkspacePath);
    }
  };

  const loadCheckpoints = useCallback(async (options?: { append?: boolean }) => {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    const append = options?.append === true;
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    try {
      const offset = append ? checkpointListRef.current.length : 0;
      const response = await ideMessenger.request("listCheckpoints", {
        query: debouncedQuery.trim() || undefined,
        offset,
        limit: CHECKPOINT_LIST_PAGE_SIZE,
        sessionId: thisSessionOnly ? sessionId : undefined,
        thisSessionOnly,
      });
      if (response.status === "success" && response.content.checkpoints) {
        applyListResponse(response.content, append);
      } else if (!append) {
        setCheckpointList([]);
        setTotalCount(0);
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load checkpoints:", error);
      if (!append) {
        setCheckpointList([]);
        setTotalCount(0);
        setHasMore(false);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      loadingRef.current = false;
    }
  }, [ideMessenger, debouncedQuery, thisSessionOnly, sessionId]);

  const workspacePathsSignature = (window.workspacePaths ?? []).join("|");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchTerm), 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    void loadCheckpoints();
  }, [workspacePathsSignature, loadCheckpoints]);

  useWebviewListener(
    "checkpointListUpdated",
    async () => {
      if (loadingRef.current) {
        return undefined;
      }
      await loadCheckpoints();
      return undefined;
    },
    [loadCheckpoints],
  );

  useEffect(() => {
    try {
      minisearch.removeAll();
      minisearch.addAll(checkpointList.map(buildCheckpointSearchDocument));
    } catch (e) {
      console.log("Error adding checkpoints to minisearch", e);
    }
  }, [checkpointList, minisearch]);

  const filteredAndSortedCheckpoints = useMemo(() => {
    // Host already filtered by session + query. MiniSearch refines the loaded page
    // by description, id, tag, path, and session without snapshots.
    if (searchTerm === "") {
      return checkpointList;
    }

    const searchResults = new Set(
      minisearch.search(searchTerm, { fuzzy: 0.1 }).map((result) => result.id),
    );
    const needle = searchTerm.toLowerCase();

    return checkpointList.filter((checkpoint) => {
      if (searchResults.has(checkpoint.id)) {
        return true;
      }
      if (checkpoint.id.toLowerCase().startsWith(needle)) {
        return true;
      }
      if (checkpoint.description.toLowerCase().includes(needle)) {
        return true;
      }
      if (checkpoint.tags?.some((tag) => tag.toLowerCase().includes(needle))) {
        return true;
      }
      const session = checkpoint.sessionId ?? checkpoint.conversationContext?.sessionId;
      if (session?.toLowerCase().includes(needle)) {
        return true;
      }
      if (checkpoint.changedPaths?.some((path) => path.toLowerCase().includes(needle))) {
        return true;
      }
      return false;
    });
  }, [checkpointList, searchTerm, minisearch]);

  const handleWorkspaceFolderChange = async (workspacePath: string) => {
    if (!workspacePath || workspacePath === activeWorkspacePath) {
      return;
    }
    try {
      const switched = await ideMessenger.request("setActiveCheckpointWorkspace", {
        workspacePath,
      });
      if (switched.status === "success" && switched.content.success) {
        setActiveWorkspacePath(workspacePath);
        setCurrentWorkspace(workspacePath);
        await loadCheckpoints();
      }
    } catch (error) {
      console.error("Failed to switch checkpoint workspace:", error);
    }
  };

  const orderedIds = useMemo(
    () => filteredAndSortedCheckpoints.map((checkpoint) => checkpoint.id),
    [filteredAndSortedCheckpoints],
  );

  const handleSelectCheckpoint = (
    checkpointId: string,
    selected: boolean,
    options?: { shiftKey?: boolean },
  ) => {
    setFocusedId(checkpointId);
    if (options?.shiftKey && selectionAnchorId) {
      setIsSelectionMode(true);
      setSelectedCheckpoints(new Set(selectCheckpointIdRange(orderedIds, selectionAnchorId, checkpointId)));
      return;
    }
    setSelectionAnchorId(checkpointId);
    const newSelection = new Set(selectedCheckpoints);
    if (selected) {
      newSelection.add(checkpointId);
    } else {
      newSelection.delete(checkpointId);
    }
    setSelectedCheckpoints(newSelection);
  };

  const handleSelectAll = () => {
    const newSelection = new Set<string>();
    filteredAndSortedCheckpoints.forEach(checkpoint => {
      newSelection.add(checkpoint.id);
    });
    setSelectedCheckpoints(newSelection);
  };
  
  const handleUnselectAll = () => {
    setSelectedCheckpoints(new Set());
  };
  
  const handleDeleteSelected = async () => {
    if (selectedCheckpoints.size === 0 && focusedId) {
      setSelectedCheckpoints(new Set([focusedId]));
      setIsSelectionMode(true);
    }
    setShowDeleteConfirmation(true);
  };

  const openCompareForSelection = () => {
    const selected = Array.from(selectedCheckpoints);
    if (selected.length !== 2) {
      return;
    }
    const left = compareCatalog.find((item) => item.id === selected[0])
      ?? checkpointList.find((item) => item.id === selected[0]);
    const right = compareCatalog.find((item) => item.id === selected[1])
      ?? checkpointList.find((item) => item.id === selected[1]);
    if (!left || !right) {
      setComparePair({ leftId: selected[0], rightId: selected[1] });
      return;
    }
    const [older, newer] = chronologicalCheckpointPair(left, right);
    setComparePair({ leftId: older.id, rightId: newer.id });
  };
  
  const confirmDeleteSelected = async () => {
    try {
      const checkpointIds = Array.from(selectedCheckpoints);
      const response = await ideMessenger.request("deleteCheckpoints", { checkpointIds });
      
      if (response.status === "success" && response.content.success) {
        console.log('Successfully deleted checkpoints:', checkpointIds);
      } else {
        const failedResults = response.status === "success"
          ? response.content.results?.filter((result: any) => !result.success)
          : undefined;
        console.error('Failed to delete some checkpoints', failedResults);
      }
    } catch (error) {
      console.error('Error deleting checkpoints:', error);
    }
    
    setSelectedCheckpoints(new Set());
    setIsSelectionMode(false);
    setShowDeleteConfirmation(false);
    
    await loadCheckpoints();
  };
  
  const cancelDelete = () => {
    setShowDeleteConfirmation(false);
  };

  const moveFocus = (delta: number, shiftKey: boolean) => {
    if (orderedIds.length === 0) {
      return;
    }
    const currentIndex = focusedId ? orderedIds.indexOf(focusedId) : -1;
    const nextIndex = currentIndex < 0
      ? (delta >= 0 ? 0 : orderedIds.length - 1)
      : Math.max(0, Math.min(orderedIds.length - 1, currentIndex + delta));
    const nextId = orderedIds[nextIndex];
    setFocusedId(nextId);
    if (shiftKey) {
      setIsSelectionMode(true);
      const anchor = selectionAnchorId ?? focusedId ?? nextId;
      setSelectionAnchorId(anchor);
      setSelectedCheckpoints(new Set(selectCheckpointIdRange(orderedIds, anchor, nextId)));
    }
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector(`[data-checkpoint-id="${nextId}"]`);
      if (row && typeof (row as HTMLElement).scrollIntoView === "function") {
        (row as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    });
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1, event.shiftKey);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1, event.shiftKey);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedCheckpoints.size > 0 || focusedId) {
        event.preventDefault();
        void handleDeleteSelected();
      }
    } else if (event.key === "Enter" && focusedId) {
      event.preventDefault();
      setKeyboardRestoreId(focusedId);
    } else if (event.key === "Escape") {
      setIsSelectionMode(false);
      setSelectedCheckpoints(new Set());
      setFocusedId(null);
    }
  };

  const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24);
  const lastWeek = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
  const lastMonth = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="ml-auto h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
        <Skeleton className="h-8 w-full" />
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className={`${CP_ICON} animate-spin`} />
          {t('loadingCheckpoints')}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="min-w-0 space-y-2 overflow-x-hidden p-2"
      tabIndex={0}
      onKeyDown={handleListKeyDown}
      data-testid="checkpoint-list"
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h1 className="text-base font-semibold leading-none text-foreground">{t('checkpoints')}</h1>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              variant={thisSessionOnly ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setThisSessionOnly((prev) => !prev)}
              title={t("thisSession")}
            >
              {t("thisSession")}
            </Button>
            <Badge variant="secondary" className="h-7 truncate px-2 text-xs font-normal">
              {t('showingCheckpoints', { shown: filteredAndSortedCheckpoints.length, total: totalCount })}
            </Badge>
          </div>
        </div>
        
        <div className="relative w-full">
          <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground ${CP_ICON}`} />
          <Input
            ref={searchInputRef}
            placeholder={t('searchByDescriptionOrId')}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 pl-8 pr-8 text-sm"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => {
                setSearchTerm("");
                if (searchInputRef.current) {
                  searchInputRef.current.focus();
                }
              }}
            >
              <X className={CP_ICON} />
            </Button>
          )}
        </div>
        {workspaceFolders.length > 1 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="checkpoint-workspace-folder" className="text-xs text-muted-foreground whitespace-nowrap">
              {t("checkpointWorkspaceFolder")}
            </Label>
            <Select
              value={activeWorkspacePath ?? workspaceFolders[0]?.path ?? ""}
              onValueChange={(value) => {
                void handleWorkspaceFolderChange(value);
              }}
            >
              <SelectTrigger id="checkpoint-workspace-folder" className="h-8 min-w-0 flex-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaceFolders.map((folder) => (
                  <SelectItem key={folder.path} value={folder.path}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {filteredAndSortedCheckpoints.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Archive className={CP_ICON_EMPTY} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">{t('noCheckpointsFound')}</h3>
              <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
                {currentWorkspace 
                  ? t('noCheckpointsForWorkspace')
                  : t('checkpointsAutoCreated')
                }
                {" "}
                <Shortcut>shift + cmd/ctrl + p</Shortcut> → "{t('createCheckpoint')}"
              </p>
              {currentWorkspace && (
                <p className="text-muted-foreground text-xs">
                  {t('currentWorkspace')}: {currentWorkspace.split('/').pop()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Sticky Actions Bar */}
          <div className="sticky top-0 z-10 -mx-2 mb-2 border-b border-border/40 bg-background/95 p-1.5 backdrop-blur supports-backdrop-filter:bg-background/60">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                {selectedCheckpoints.size > 0 && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                    <Check className={CP_ICON_META} />
                    <span>{selectedCheckpoints.size}</span>
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                {!isSelectionMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSelectionMode(true)}
                    className="h-7 gap-1 px-2 text-xs"
                    title={t('selectMultipleCheckpoints')}
                  >
                    <CheckSquare className={CP_ICON} />
                    <span className="hidden sm:inline">{t('select')}</span>
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                      className="h-7 gap-1 px-2 text-xs"
                      title={t('selectAllCheckpoints')}
                    >
                      <CheckSquare className={CP_ICON} />
                      <span className="hidden md:inline">{t('selectAll')}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnselectAll}
                      className="h-7 gap-1 px-2 text-xs"
                      title={t('clearAllSelections')}
                    >
                      <Square className={CP_ICON} />
                      <span className="hidden md:inline">{t('clear')}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openCompareForSelection}
                      disabled={selectedCheckpoints.size !== 2}
                      className="h-7 gap-1 px-2 text-xs"
                      title={t('compareTwoCheckpoints')}
                    >
                      <GitCompare className={CP_ICON} />
                      <span className="hidden sm:inline">{t('compare')}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteSelected}
                      disabled={selectedCheckpoints.size === 0}
                      className="h-7 gap-1 px-2 text-xs text-red hover:bg-destructive/10 hover:text-red"
                      title={t('deleteSelectedCheckpoints', { count: selectedCheckpoints.size })}
                    >
                      <Trash2 className={CP_ICON} />
                      <span className="hidden sm:inline">{t('deleteCount', { count: selectedCheckpoints.size })}</span>
                      <span className="sm:hidden">({selectedCheckpoints.size})</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsSelectionMode(false);
                        setSelectedCheckpoints(new Set());
                      }}
                      className="h-7 gap-1 px-2 text-xs"
                      title={t('exitSelectionMode')}
                    >
                      <X className={CP_ICON} />
                      <span className="hidden sm:inline">{t('exit')}</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Grouped checkpoints by date */}
          <div className="space-y-2">
            {(() => {
              let sections: {
                header: string;
                checkpoints: typeof filteredAndSortedCheckpoints;
              }[] = [];
              let currentSection = "";
              let currentCheckpoints: typeof filteredAndSortedCheckpoints = [];

              filteredAndSortedCheckpoints.forEach((checkpoint, index) => {
                const date = parseDate(checkpoint.dateCreated);
                let section = "";

                if (date > yesterday) {
                  section = t('today');
                } else if (date > lastWeek) {
                  section = t('thisWeek');
                } else if (date > lastMonth) {
                  section = t('thisMonth');
                } else {
                  section = t('earlierCheckpoints');
                }

                if (section !== currentSection) {
                  if (currentSection) {
                    sections.push({
                      header: currentSection,
                      checkpoints: currentCheckpoints,
                    });
                  }
                  currentSection = section;
                  currentCheckpoints = [checkpoint];
                } else {
                  currentCheckpoints.push(checkpoint);
                }

                // Handle the last checkpoint
                if (index === filteredAndSortedCheckpoints.length - 1) {
                  sections.push({
                    header: currentSection,
                    checkpoints: currentCheckpoints,
                  });
                }
              });

              return sections.map(({ header, checkpoints }) => (
                <div key={header} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{header}</h2>
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {checkpoints.length === 1 ? t('itemCount', { count: checkpoints.length }) : t('itemsCount', { count: checkpoints.length })}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="space-y-1.5">
                    {checkpoints.map((checkpoint, idx) => (
                      <CheckpointTableRow
                        key={checkpoint.id}
                        checkpointMetadata={checkpoint}
                        date={parseDate(checkpoint.dateCreated)}
                        index={idx}
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedCheckpoints.has(checkpoint.id)}
                        isFocused={focusedId === checkpoint.id}
                        onSelect={(selected, event) =>
                          handleSelectCheckpoint(checkpoint.id, selected, { shiftKey: event?.shiftKey })
                        }
                        onDelete={(checkpointId) => {
                          setSelectedCheckpoints(new Set([checkpointId]));
                          setIsSelectionMode(true);
                          setShowDeleteConfirmation(true);
                        }}
                        allCheckpoints={compareCatalog.length > 0 ? compareCatalog : checkpointList}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}
            {hasMore && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isLoadingMore}
                  onClick={() => void loadCheckpoints({ append: true })}
                >
                  {isLoadingMore ? t('loadingCheckpoints') : t('loadMoreCheckpoints')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Footer Info */}
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className={`${CP_ICON} mt-0.5`} />
        <span>{t('checkpointDataSavedIn')}</span>
      </div>

      <AlertDialog
        open={showDeleteConfirmation}
        onOpenChange={(open) => {
          if (!open) {
            cancelDelete();
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteCheckpoints')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmation', { count: selectedCheckpoints.size })}{" "}
              {selectedCheckpoints.size === 1 ? t('checkpoint') : t('checkpointsPlural')}?
              {" "}
              {t('cannotBeUndone')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDelete}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void confirmDeleteSelected();
              }}
            >
              {t('deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CheckpointCompareDialog
        open={comparePair !== null}
        leftId={comparePair?.leftId ?? null}
        rightId={comparePair?.rightId ?? null}
        leftLabel={compareCatalog.find((item) => item.id === comparePair?.leftId)?.description}
        rightLabel={compareCatalog.find((item) => item.id === comparePair?.rightId)?.description}
        onOpenChange={(open) => {
          if (!open) {
            setComparePair(null);
          }
        }}
      />
      {keyboardRestoreId && (
        <RestorePreviewDialog
          open={true}
          checkpointId={keyboardRestoreId}
          checkpointDescription={
            checkpointList.find((item) => item.id === keyboardRestoreId)?.description
          }
          onOpenChange={(open) => {
            if (!open) {
              setKeyboardRestoreId(null);
            }
          }}
        />
      )}
    </div>
  );
}
