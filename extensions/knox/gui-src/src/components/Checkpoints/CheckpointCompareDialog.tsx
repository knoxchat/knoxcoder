import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCompare } from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { PierreDiffViewer } from "./PierreDiffViewer";

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

export interface CheckpointCompareDialogProps {
  open: boolean;
  leftId: string | null;
  rightId: string | null;
  leftLabel?: string;
  rightLabel?: string;
  onOpenChange: (open: boolean) => void;
}

export function CheckpointCompareDialog({
  open,
  leftId,
  rightId,
  leftLabel,
  rightLabel,
  onOpenChange,
}: CheckpointCompareDialogProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffPair, setDiffPair] = useState<{ old: DiffSideCheckpoint; new: DiffSideCheckpoint } | null>(null);

  useEffect(() => {
    if (!open || !leftId || !rightId || leftId === rightId) {
      setDiffPair(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setDiffPair(null);

    void (async () => {
      try {
        const response = await ideMessenger.request("computeCheckpointDiff", {
          checkpointId: rightId,
          compareToCheckpointId: leftId,
        });
        if (cancelled) {
          return;
        }
        if (response.status !== "success" || !response.content.success || !response.content.diff) {
          setError(t("failedToCompareCheckpoints"));
          return;
        }
        const diff = response.content.diff;
        if (!diff.oldCheckpoint) {
          setError(t("noPreviousCheckpoint"));
          return;
        }
        const toSnapshot = (relativePath: string, content: string, encoding?: string) => ({
          relativePath,
          content,
          encoding: encoding || "utf8",
          lastModified: new Date(),
          size: encoding === "base64" ? Math.round(content.length * 0.75) : content.length,
        });
        setDiffPair({
          old: {
            id: diff.oldCheckpoint.id,
            description: diff.oldCheckpoint.description,
            created: diff.oldCheckpoint.created,
            fileSnapshots: diff.files
              .filter((file) => file.oldContent !== null)
              .map((file) => toSnapshot(file.relativePath, file.oldContent as string, file.oldEncoding)),
          },
          new: {
            id: diff.newCheckpoint.id,
            description: diff.newCheckpoint.description,
            created: diff.newCheckpoint.created,
            fileSnapshots: diff.files
              .filter((file) => file.newContent !== null)
              .map((file) => toSnapshot(file.relativePath, file.newContent as string, file.newEncoding)),
          },
        });
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to compare checkpoints:", err);
          setError(t("failedToCompareCheckpoints"));
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
  }, [open, leftId, rightId, ideMessenger, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[80vh] max-w-6xl flex-col gap-3"
        data-testid="checkpoint-compare-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            {t("compareTwoCheckpoints")}
          </DialogTitle>
          <DialogDescription>
            {(leftLabel || leftId)?.slice(0, 48)} → {(rightLabel || rightId)?.slice(0, 48)}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("loadingPreviousCheckpoint")}
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {error}
            </div>
          ) : diffPair ? (
            <PierreDiffViewer oldCheckpoint={diffPair.old} newCheckpoint={diffPair.new} />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
