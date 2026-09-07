import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { File as PierreFile } from "@pierre/diffs/react";
import { Copy, Check, WrapText, Type, RotateCcw, FileWarning } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import FileIcon from "../FileIcon";
import { usePierreFileOptions } from "./usePierreDiffOptions";

interface FileSnapshot {
  relativePath: string;
  content: string;
  encoding: string;
  lastModified: string;
  size: number;
}

interface CodeViewerProps {
  file: FileSnapshot;
  className?: string;
  /** When provided, shows a per-file restore button in the header */
  onRestoreFile?: (relativePath: string) => void;
  isRestoringFile?: boolean;
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function CodeViewer({
  file,
  className,
  onRestoreFile,
  isRestoringFile,
}: CodeViewerProps) {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);
  const [isWrapped, setIsWrapped] = useState(false);

  const pierreOptions = usePierreFileOptions(isWrapped ? "wrap" : "scroll");

  const isBinary = file.encoding === "base64";
  const imageExtension = file.relativePath.split(".").pop()?.toLowerCase() || "";
  const imageMime = isBinary ? IMAGE_MIME_BY_EXTENSION[imageExtension] : undefined;
  const language = file.relativePath.split(".").pop()?.toLowerCase() || "plaintext";

  const pierreFile = useMemo(
    () => ({
      name: file.relativePath,
      contents: file.content,
      cacheKey: `snapshot:${file.relativePath}:${file.size}`,
    }),
    [file.relativePath, file.content, file.size],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <div
      className={cn(
        "border bg-background overflow-hidden h-full flex flex-col code-viewer-container",
        className,
      )}
    >
      {/* File Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileIcon height="16px" width="16px" filename={file.relativePath} />
          <span className="font-mono text-sm font-medium truncate">
            {file.relativePath}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {onRestoreFile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRestoreFile(file.relativePath)}
              disabled={isRestoringFile}
              className="h-6 px-2 transition-all duration-200"
              title={t("restoreThisFile")}
            >
              {isRestoringFile ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
            </Button>
          )}
          {!isBinary && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsWrapped(!isWrapped)}
                className={cn(
                  "h-6 px-2 transition-all duration-200",
                  isWrapped &&
                    "odp-chip-blue hover:odp-chip-blue",
                )}
                title={
                  isWrapped ? t("disableTextWrapping") : t("enableTextWrapping")
                }
              >
                {isWrapped ? (
                  <Type className="w-3 h-3" />
                ) : (
                  <WrapText className="w-3 h-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className={cn(
                  "h-6 px-2 transition-all duration-200",
                  isCopied &&
                    "odp-chip-green hover:odp-chip-green",
                )}
                title={isCopied ? t("copiedToClipboard") : t("copyToClipboard")}
              >
                {isCopied ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {isBinary ? (
        <div className="flex-1 overflow-auto flex items-center justify-center p-6">
          {imageMime ? (
            <div className="text-center space-y-3 max-w-full">
              <img
                src={`data:${imageMime};base64,${file.content}`}
                alt={file.relativePath}
                className="max-w-full max-h-[60vh] mx-auto rounded border border-border/60 bg-background/50"
              />
              <p className="text-xs text-muted-foreground">
                {t("binaryImagePreview", { size: formatFileSize(file.size) })}
              </p>
            </div>
          ) : (
            <div className="text-center text-muted-foreground space-y-2">
              <FileWarning className="w-10 h-10 mx-auto opacity-50" />
              <p className="text-sm font-medium">{t("binaryFileNotice")}</p>
              <p className="text-xs">
                {t("binaryFileSize", { size: formatFileSize(file.size) })}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 pierre-file-container">
          <PierreFile
            key={`${file.relativePath}:${isWrapped}`}
            file={pierreFile}
            options={pierreOptions}
            style={{ height: "100%", width: "100%", overflow: "auto" }}
          />
        </div>
      )}

      {/* Footer with stats and metadata */}
      <div className="px-3 py-1.5 border-t bg-muted/20 text-xs text-muted-foreground shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span>{isBinary ? t("binaryLabel") : language}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] mt-0.5">
            <span className="flex items-center gap-1">
              <span>{t("size")}:</span>
              <span className="font-mono">{formatFileSize(file.size)}</span>
            </span>
            <span className="flex items-center gap-1">
              <span>{t("modifiedLabel")}:</span>
              <span className="font-mono">
                {new Date(file.lastModified).toLocaleDateString()}{" "}
                {new Date(file.lastModified).toLocaleTimeString(undefined, {
                  hour12: false,
                })}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
