import React, { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, GitCompare, RotateCcw } from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { CP_ICON } from "./checkpointUi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "@/lib/utils";
import { PierreDiffViewer } from "./PierreDiffViewer";

type RestorePreviewAction = "overwrite" | "create" | "delete";

interface RestorePreviewFile {
  relativePath: string;
  action: RestorePreviewAction;
  additions: number;
  deletions: number;
  hunkCount: number;
}

interface RestorePreview {
  checkpointId: string;
  description: string;
  modified: number;
  added: number;
  deleted: number;
  files: RestorePreviewFile[];
  writePaths: string[];
  extraPaths: string[];
  skippedFiles: Array<{ path: string; reason: string }>;
}

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

export interface RestorePreviewDialogProps {
  open: boolean;
  checkpointId: string;
  checkpointDescription?: string;
  rewindMemory?: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoringChange?: (restoring: boolean) => void;
}

export function RestorePreviewDialog({
  open,
  checkpointId,
  checkpointDescription,
  rewindMemory = false,
  onOpenChange,
  onRestoringChange,
}: RestorePreviewDialogProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isRestoring, setIsRestoring] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffPair, setDiffPair] = useState<{ old: DiffSideCheckpoint; new: DiffSideCheckpoint } | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      setShowDiff(false);
      setDiffPair(null);
      setSelectedPaths(new Set());
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await ideMessenger.request("previewRestore", { checkpointId });
        if (cancelled) {
          return;
        }
        if (response.status === "success" && response.content.success && response.content.preview) {
          const next = response.content.preview;
          setPreview(next);
          setSelectedPaths(new Set(next.writePaths));
        } else {
          setPreview(null);
          setError(response.status === "success" ? response.content.message ?? t("restorePreviewFailed") : t("restorePreviewFailed"));
        }
      } catch {
        if (!cancelled) {
          setPreview(null);
          setError(t("restorePreviewFailed"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, checkpointId, ideMessenger]);

  const selectedCount = selectedPaths.size;
  const allSelected = preview ? selectedCount === preview.files.length && preview.files.length > 0 : false;

  const togglePath = (relativePath: string, checked: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(relativePath);
      } else {
        next.delete(relativePath);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!preview) {
      return;
    }
    setSelectedPaths(checked ? new Set(preview.files.map((file) => file.relativePath)) : new Set());
  };

  const loadDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    setIsLoadingDiff(true);
    try {
      const response = await ideMessenger.request("computeCheckpointDiff", {
        checkpointId,
        compareToWorkspace: true,
      });
      if (response.status === "success" && response.content.success && response.content.diff) {
        const diff = response.content.diff;
        if (!diff.oldCheckpoint) {
          return;
        }
        const oldCheckpoint = diff.oldCheckpoint;
        const toSnapshot = (relativePath: string, content: string, encoding?: string) => ({
          relativePath,
          content,
          encoding: encoding || "utf8",
          lastModified: new Date(),
          size: encoding === "base64" ? Math.round(content.length * 0.75) : content.length,
        });
        setDiffPair({
          old: {
            id: oldCheckpoint.id,
            description: oldCheckpoint.description,
            created: oldCheckpoint.created,
            fileSnapshots: diff.files
              .filter((file) => file.oldContent !== null)
              .map((file) => toSnapshot(file.relativePath, file.oldContent as string, file.oldEncoding)),
          },
          new: {
            id: diff.newCheckpoint.id,
            description: t("currentWorkspaceOption"),
            created: diff.newCheckpoint.created,
            fileSnapshots: diff.files
              .filter((file) => file.newContent !== null)
              .map((file) => toSnapshot(file.relativePath, file.newContent as string, file.newEncoding)),
          },
        });
        setShowDiff(true);
      }
    } catch (loadError) {
      console.error("Failed to load restore preview diff:", loadError);
    } finally {
      setIsLoadingDiff(false);
    }
  };

  const finishRestore = (restoring: boolean) => {
    setIsRestoring(restoring);
    onRestoringChange?.(restoring);
  };

  const restoreAll = async () => {
    finishRestore(true);
    try {
      await ideMessenger.request("restoreCheckpoint", { checkpointId, rewindMemory });
      onOpenChange(false);
    } catch (restoreError) {
      console.error("Failed to restore checkpoint:", restoreError);
    } finally {
      setTimeout(() => finishRestore(false), 1500);
    }
  };

  const restoreSelected = async () => {
    if (selectedCount === 0) {
      return;
    }
    finishRestore(true);
    try {
      await ideMessenger.request("restoreCheckpointFiles", {
        checkpointId,
        relativePaths: Array.from(selectedPaths),
      });
      onOpenChange(false);
    } catch (restoreError) {
      console.error("Failed to restore selected checkpoint files:", restoreError);
    } finally {
      setTimeout(() => finishRestore(false), 1500);
    }
  };

  const actionLabel = (action: RestorePreviewAction) => {
    if (action === "overwrite") {
      return t("restorePreviewWillOverwrite");
    }
    if (action === "create") {
      return t("restorePreviewWillCreate");
    }
    return t("restorePreviewWillDelete");
  };

  const summary = useMemo(() => {
    if (!preview) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="odp-chip odp-chip-yellow border text-xs font-normal shadow-none">
          {t("modified")}: {preview.modified}
        </Badge>
        <Badge variant="outline" className="odp-chip odp-chip-green border text-xs font-normal shadow-none">
          {t("added")}: {preview.added}
        </Badge>
        <Badge variant="outline" className="odp-chip odp-chip-red border text-xs font-normal shadow-none">
          {t("deleted")}: {preview.deleted}
        </Badge>
      </div>
    );
  }, [preview, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        data-testid="restore-preview-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className={CP_ICON} />
            {t("restorePreviewTitle")}
          </DialogTitle>
          <DialogDescription>
            {checkpointDescription || preview?.description || t("restorePreviewSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            {t("restorePreviewLoading")}
          </div>
        ) : error ? (
          <div className="text-sm text-red">{error}</div>
        ) : preview && preview.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("restorePreviewEmpty")}</p>
        ) : preview ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {summary}
            <p className="text-xs text-muted-foreground">{t("restorePreviewExtrasHint")}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => toggleAll(checked === true)}
                aria-label={t("selectAll")}
              />
              <span className="text-xs text-muted-foreground">{t("selectAll")}</span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded border">
              <ul className="divide-y">
                {preview.files.map((file) => (
                  <li key={file.relativePath} className="flex items-start gap-2 px-2 py-1.5">
                    <Checkbox
                      checked={selectedPaths.has(file.relativePath)}
                      onCheckedChange={(checked) => togglePath(file.relativePath, checked === true)}
                      className="mt-0.5"
                      aria-label={file.relativePath}
                    />
                    <File className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{file.relativePath}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            file.action === "create" && "odp-text-green",
                            file.action === "delete" && "odp-text-red",
                          )}
                        >
                          {actionLabel(file.action)}
                        </span>
                        <span>+{file.additions}/-{file.deletions}</span>
                        <span>{t("restorePreviewHunks", { count: file.hunkCount })}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {preview.skippedFiles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("restorePreviewSkipped")}: {preview.skippedFiles.map((file) => `${file.path} (${file.reason})`).join(", ")}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="self-start gap-1"
              onClick={() => void loadDiff()}
              disabled={isLoadingDiff}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {showDiff ? t("restorePreviewHideDiff") : t("restorePreviewShowDiff")}
            </Button>
            {showDiff && diffPair && (
              <div className="h-64 overflow-hidden rounded border">
                <PierreDiffViewer oldCheckpoint={diffPair.old} newCheckpoint={diffPair.new} />
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isRestoring}>
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void restoreSelected()}
            disabled={isRestoring || isLoading || selectedCount === 0}
          >
            {t("restoreSelectedCount", { count: selectedCount })}
          </Button>
          <Button onClick={() => void restoreAll()} disabled={isRestoring || isLoading || !!error}>
            {preview && preview.files.length === 0 ? t("restoreAnyway") : t("restoreAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
