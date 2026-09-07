/**
 * Checkpoint diff viewer powered by @pierre/diffs (Shiki syntax highlighting).
 *
 * Replaces the legacy hljs + custom diff renderer with Pierre's aligned split/unified
 * views, word-level inline highlights, and virtualized rendering.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  parseDiffFromFile,
  type FileContents,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { MultiFileDiff } from "@pierre/diffs/react";
import {
  GitCompare,
  Split,
  FileText,
  Plus,
  Minus,
  CheckCircle2,
  Clock,
  ChevronRight,
  ChevronDown,
  WrapText,
  PanelLeftClose,
  PanelLeftOpen,
  FileWarning,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { cn } from "@/lib/utils";
import FileIcon from "../FileIcon";
import { usePierreDiffOptions } from "./usePierreDiffOptions";

export interface FileSnapshot {
  relativePath: string;
  content: string;
  encoding: string;
  lastModified: Date;
  size: number;
}

export interface PierreDiffViewerProps {
  oldCheckpoint: {
    id: string;
    description: string;
    created: string;
    fileSnapshots: FileSnapshot[];
  };
  newCheckpoint: {
    id: string;
    description: string;
    created: string;
    fileSnapshots: FileSnapshot[];
  };
  onClose?: () => void;
}

type ViewMode = "split" | "unified";

interface FileDiffInfo {
  path: string;
  status: "added" | "deleted" | "modified" | "unchanged";
  additions: number;
  deletions: number;
  isBinary: boolean;
  oldSize?: number;
  newSize?: number;
  oldFile: FileContents | null;
  newFile: FileContents | null;
  fileDiff: FileDiffMetadata;
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function countDiffStats(fileDiff: FileDiffMetadata): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionCount;
    deletions += hunk.deletionCount;
  }
  return { additions, deletions };
}

function buildFileContents(
  checkpointId: string,
  path: string,
  snapshot: FileSnapshot | undefined,
): FileContents | null {
  if (!snapshot) return null;
  return {
    name: path,
    contents: snapshot.content,
    cacheKey: `${checkpointId}:${path}`,
  };
}

function buildFileDiffInfo(
  path: string,
  oldSnapshot: FileSnapshot | undefined,
  newSnapshot: FileSnapshot | undefined,
  oldCheckpointId: string,
  newCheckpointId: string,
): FileDiffInfo | null {
  const isBinary =
    oldSnapshot?.encoding === "base64" ||
    newSnapshot?.encoding === "base64";

  let status: FileDiffInfo["status"];
  if (!oldSnapshot && newSnapshot) {
    status = "added";
  } else if (oldSnapshot && !newSnapshot) {
    status = "deleted";
  } else if (oldSnapshot && newSnapshot) {
    status =
      oldSnapshot.content === newSnapshot.content ? "unchanged" : "modified";
  } else {
    return null;
  }

  const oldFile = buildFileContents(oldCheckpointId, path, oldSnapshot);
  const newFile = buildFileContents(newCheckpointId, path, newSnapshot);

  const fileDiff = parseDiffFromFile(oldFile, newFile);
  const { additions, deletions } = isBinary
    ? { additions: 0, deletions: 0 }
    : countDiffStats(fileDiff);

  return {
    path,
    status,
    additions,
    deletions,
    isBinary,
    oldSize: oldSnapshot?.size,
    newSize: newSnapshot?.size,
    oldFile,
    newFile,
    fileDiff,
  };
}

export function PierreDiffViewer({
  oldCheckpoint,
  newCheckpoint,
}: PierreDiffViewerProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["root"]),
  );
  const [wrapLines, setWrapLines] = useState(false);
  const [isFileTreeExpanded, setIsFileTreeExpanded] = useState(true);

  const pierreOptions = usePierreDiffOptions(
    viewMode,
    wrapLines ? "wrap" : "scroll",
  );

  const fileDiffs = useMemo(() => {
    const diffs = new Map<string, FileDiffInfo>();
    const oldFiles = new Map(
      oldCheckpoint.fileSnapshots.map((f) => [f.relativePath, f]),
    );
    const newFiles = new Map(
      newCheckpoint.fileSnapshots.map((f) => [f.relativePath, f]),
    );
    const allPaths = new Set([...oldFiles.keys(), ...newFiles.keys()]);

    for (const path of allPaths) {
      const info = buildFileDiffInfo(
        path,
        oldFiles.get(path),
        newFiles.get(path),
        oldCheckpoint.id,
        newCheckpoint.id,
      );
      if (info) {
        diffs.set(path, info);
      }
    }
    return diffs;
  }, [oldCheckpoint, newCheckpoint]);

  const changedFiles = useMemo(
    () =>
      Array.from(fileDiffs.values()).filter(
        (diff) => diff.status !== "unchanged",
      ),
    [fileDiffs],
  );

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    changedFiles.forEach((diff) => {
      additions += diff.additions;
      deletions += diff.deletions;
    });
    return { additions, deletions, filesChanged: changedFiles.length };
  }, [changedFiles]);

  const fileTree = useMemo(() => {
    const tree: {
      name: string;
      type: "folder" | "file";
      children: Record<string, unknown>;
      path: string;
      diff?: FileDiffInfo;
    } = { name: "root", type: "folder", children: {}, path: "" };

    changedFiles.forEach((diff) => {
      const parts = diff.path.split("/");
      let current = tree;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        const pathSoFar = parts.slice(0, index + 1).join("/");

        if (isFile) {
          current.children[part] = {
            name: part,
            type: "file",
            path: pathSoFar,
            diff,
            children: {},
          };
        } else {
          if (!current.children[part]) {
            current.children[part] = {
              name: part,
              type: "folder",
              path: pathSoFar,
              children: {},
            };
          }
          current = current.children[part] as typeof tree;
        }
      });
    });

    return tree;
  }, [changedFiles]);

  useEffect(() => {
    const folders = new Set<string>(["root"]);
    changedFiles.forEach((diff) => {
      const parts = diff.path.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        folders.add(parts.slice(0, i + 1).join("/"));
      }
    });
    setExpandedFolders(folders);
  }, [changedFiles]);

  useEffect(() => {
    if (!selectedFile && changedFiles.length > 0) {
      setSelectedFile(changedFiles[0].path);
    }
  }, [changedFiles, selectedFile]);

  const selectedDiff = selectedFile ? fileDiffs.get(selectedFile) : null;

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const renderFileTree = (
    node: {
      name: string;
      type: "folder" | "file";
      children: Record<string, unknown>;
      path: string;
      diff?: FileDiffInfo;
    },
    depth = 0,
  ): React.ReactNode => {
    if (node.type === "file" && node.diff) {
      const isSelected = selectedFile === node.path;
      const { status, additions, deletions, isBinary } = node.diff;

      return (
        <div
          key={node.path}
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50 rounded text-sm transition-colors",
            isSelected &&
              "bg-primary/10 hover:bg-primary/15 border-l-2 border-primary",
          )}
          style={{ paddingLeft: `${(depth + 1) * 12}px` }}
          onClick={() => setSelectedFile(node.path)}
        >
          <FileIcon height="14px" width="14px" filename={node.path} />
          <span className="flex-1 truncate text-foreground">{node.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            {isBinary && (
              <Badge
                variant="outline"
                className="odp-chip odp-chip-yellow h-4 border px-1 py-0 shadow-none"
              >
                BIN
              </Badge>
            )}
            {status === "added" && (
              <Badge
                variant="outline"
                className="odp-chip odp-chip-green h-4 border px-1 py-0 shadow-none"
              >
                A
              </Badge>
            )}
            {status === "deleted" && (
              <Badge
                variant="outline"
                className="odp-chip odp-chip-red h-4 border px-1 py-0 shadow-none"
              >
                D
              </Badge>
            )}
            {status === "modified" && !isBinary && (
              <div className="flex items-center gap-1">
                {additions > 0 && (
                  <span className="odp-text-green text-[10px]">
                    +{additions}
                  </span>
                )}
                {deletions > 0 && (
                  <span className="odp-text-red text-[10px]">-{deletions}</span>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    const isExpanded =
      node.path === ""
        ? expandedFolders.has("root")
        : expandedFolders.has(node.path);
    const childrenArray = Object.values(node.children) as typeof node[];

    if (childrenArray.length === 0) return null;

    return (
      <div key={node.path || "root"}>
        {node.path && (
          <div
            className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-muted/30 rounded text-sm transition-colors"
            style={{ paddingLeft: `${depth * 12}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="text-muted-foreground font-medium truncate">
              {node.name}
            </span>
          </div>
        )}
        {isExpanded &&
          childrenArray.map((child) => renderFileTree(child, depth + 1))}
      </div>
    );
  };

  const renderBinaryPanel = (diff: FileDiffInfo) => {
    const imageExtension =
      diff.path.split(".").pop()?.toLowerCase() || "";
    const imageMime = IMAGE_MIME_BY_EXTENSION[imageExtension];
    const oldContent = diff.oldFile?.contents;
    const newContent = diff.newFile?.contents;

    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
          {diff.status !== "added" && (
            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t("previousVersion")}
              </h4>
              {imageMime && oldContent ? (
                <img
                  src={`data:${imageMime};base64,${oldContent}`}
                  alt={diff.path}
                  className="max-w-full max-h-[50vh] mx-auto rounded border"
                />
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <FileWarning className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t("binaryFileNotice")}</p>
                  {diff.oldSize != null && (
                    <p className="text-xs mt-1">
                      {formatBytes(diff.oldSize)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {diff.status !== "deleted" && (
            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t("currentVersion")}
              </h4>
              {imageMime && newContent ? (
                <img
                  src={`data:${imageMime};base64,${newContent}`}
                  alt={diff.path}
                  className="max-w-full max-h-[50vh] mx-auto rounded border"
                />
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <FileWarning className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t("binaryFileNotice")}</p>
                  {diff.newSize != null && (
                    <p className="text-xs mt-1">
                      {formatBytes(diff.newSize)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (changedFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full border rounded-lg bg-muted/10">
        <div className="text-center text-muted-foreground p-8">
          <CheckCircle2 className="mx-auto mb-3 size-12 opacity-50 odp-text-green" />
          <p className="text-sm font-medium">{t("noChangesDetected")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <GitCompare className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span className="truncate">{oldCheckpoint.description}</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span className="truncate">{newCheckpoint.description}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {stats.filesChanged} {t("filesChanged")}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span className="odp-text-green flex items-center gap-0.5">
              <Plus className="w-3 h-3" />
              {stats.additions}
            </span>
            <span className="odp-text-red flex items-center gap-0.5">
              <Minus className="w-3 h-3" />
              {stats.deletions}
            </span>
          </div>

          <Separator orientation="vertical" className="h-4" />

          <Button
            variant={viewMode === "split" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("split")}
            className="h-7 px-2 text-xs gap-1"
            title={t("splitView")}
          >
            <Split className="w-3.5 h-3.5" />
            {t("split")}
          </Button>
          <Button
            variant={viewMode === "unified" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("unified")}
            className="h-7 px-2 text-xs gap-1"
            title={t("unifiedView")}
          >
            <FileText className="w-3.5 h-3.5" />
            {t("unified")}
          </Button>
          <Button
            variant={wrapLines ? "default" : "outline"}
            size="sm"
            onClick={() => setWrapLines(!wrapLines)}
            className="h-7 px-2"
            title={
              wrapLines ? t("disableTextWrapping") : t("enableTextWrapping")
            }
          >
            <WrapText className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFileTreeExpanded(!isFileTreeExpanded)}
            className="h-7 px-2"
            title={
              isFileTreeExpanded ? t("hideFileTree") : t("showFileTree")
            }
          >
            {isFileTreeExpanded ? (
              <PanelLeftClose className="w-3.5 h-3.5" />
            ) : (
              <PanelLeftOpen className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {isFileTreeExpanded && (
          <div className="w-56 shrink-0 border-r overflow-y-auto p-2 bg-muted/5">
            {renderFileTree(fileTree)}
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {selectedDiff ? (
            selectedDiff.isBinary ? (
              renderBinaryPanel(selectedDiff)
            ) : (
              <div className="flex-1 min-h-0 pierre-diff-container">
                {selectedDiff.oldFile === null ? (
                  <MultiFileDiff
                    key={`${selectedDiff.path}:${viewMode}:${wrapLines}`}
                    oldFile={null}
                    newFile={selectedDiff.newFile!}
                    options={pierreOptions}
                    style={{ height: "100%", width: "100%", overflow: "auto" }}
                  />
                ) : selectedDiff.newFile === null ? (
                  <MultiFileDiff
                    key={`${selectedDiff.path}:${viewMode}:${wrapLines}`}
                    oldFile={selectedDiff.oldFile}
                    newFile={null}
                    options={pierreOptions}
                    style={{ height: "100%", width: "100%", overflow: "auto" }}
                  />
                ) : (
                  <MultiFileDiff
                    key={`${selectedDiff.path}:${viewMode}:${wrapLines}`}
                    oldFile={selectedDiff.oldFile}
                    newFile={selectedDiff.newFile}
                    options={pierreOptions}
                    style={{ height: "100%", width: "100%", overflow: "auto" }}
                  />
                )}
              </div>
            )
          ) : (
            <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
              {t("selectFileToViewDiff")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
