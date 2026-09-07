import React, { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package, X } from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";

interface BatchDiffFile {
  filepath: string;
  numDiffs: number;
  selected: boolean;
}

interface BatchDiffPanelProps {
  onClose?: () => void;
}

export function BatchDiffPanel({ onClose }: BatchDiffPanelProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [files, setFiles] = useState<BatchDiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);

  const loadPendingFiles = useCallback(async () => {
    try {
      const result = await ideMessenger.request("batch/getPendingFiles", undefined);
      if (result.status === "success") {
        setFiles(result.content.files ?? []);
      }
    } catch {
      // Batch diff not available
    }
  }, [ideMessenger]);

  useEffect(() => {
    loadPendingFiles();
  }, [loadPendingFiles]);

  const toggleFile = (filepath: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.filepath === filepath ? { ...f, selected: !f.selected } : f,
      ),
    );
  };

  const selectAll = () =>
    setFiles((prev) => prev.map((f) => ({ ...f, selected: true })));

  const deselectAll = () =>
    setFiles((prev) => prev.map((f) => ({ ...f, selected: false })));

  const selectedFiles = files.filter((f) => f.selected);
  const totalDiffs = files.reduce((sum, f) => sum + f.numDiffs, 0);

  const handleAcceptSelected = async () => {
    setApplyingAll(true);
    try {
      await ideMessenger.request("batch/acceptSelected", {
        fileUris: selectedFiles.map((f) => f.filepath),
      });
      loadPendingFiles();
    } finally {
      setApplyingAll(false);
    }
  };

  const handleRejectSelected = async () => {
    setApplyingAll(true);
    try {
      await ideMessenger.request("batch/rejectSelected", {
        fileUris: selectedFiles.map((f) => f.filepath),
      });
      loadPendingFiles();
    } finally {
      setApplyingAll(false);
    }
  };

  const handleAcceptAll = async () => {
    setApplyingAll(true);
    try {
      await ideMessenger.request("batch/acceptAll", undefined);
      loadPendingFiles();
    } finally {
      setApplyingAll(false);
    }
  };

  const handleRejectAll = async () => {
    setApplyingAll(true);
    try {
      await ideMessenger.request("batch/rejectAll", undefined);
      loadPendingFiles();
    } finally {
      setApplyingAll(false);
    }
  };

  if (files.length === 0) {
    return (
      <div className="p-4 text-center opacity-50 text-sm">
        {t("noPendingDiffs")}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded border"
      style={{
        backgroundColor: "var(--vscode-editor-background)",
        borderColor: "var(--vscode-panel-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <Package size={14} /> {t("batchDiff")}
          </span>
          <span className="text-xs opacity-60">
            {files.length} {t("files")}, {totalDiffs} {t("changes")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={selectAll}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-opacity-20"
            style={{ color: "var(--vscode-textLink-foreground)" }}
          >
            {t("selectAll")}
          </button>
          <button
            onClick={deselectAll}
            className="text-xs px-1.5 py-0.5 rounded opacity-60 hover:opacity-100"
          >
            {t("deselectAll")}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs px-1.5 py-0.5 opacity-40 hover:opacity-100"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="max-h-75 overflow-y-auto">
        {files.map((file) => {
          const fileName = file.filepath.split("/").pop() || file.filepath;
          const dirPath = file.filepath.substring(
            0,
            file.filepath.lastIndexOf("/"),
          );

          return (
            <div
              key={file.filepath}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-opacity-10 cursor-pointer"
              style={{
                backgroundColor: file.selected
                  ? "var(--vscode-list-activeSelectionBackground)"
                  : "transparent",
                opacity: file.selected ? 1 : 0.6,
              }}
              onClick={() => toggleFile(file.filepath)}
            >
              <input
                type="checkbox"
                checked={file.selected}
                onChange={() => toggleFile(file.filepath)}
                className="cursor-pointer"
              />
              <span className="text-sm flex-1 truncate" title={file.filepath}>
                {fileName}
                <span className="text-xs opacity-40 ml-1">{dirPath}</span>
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-opacity-20">
                {file.numDiffs}
              </span>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div
        className="flex items-center justify-between px-3 py-2 border-t gap-2"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <span className="text-xs opacity-50">
          {selectedFiles.length}/{files.length} {t("selected")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleRejectSelected.length > 0 ? handleRejectSelected : handleRejectAll}
            disabled={applyingAll}
            className="text-xs px-3 py-1 rounded"
            style={{
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            {selectedFiles.length > 0 ? t("rejectSelected") : t("rejectAll")}
          </button>
          <button
            onClick={selectedFiles.length > 0 ? handleAcceptSelected : handleAcceptAll}
            disabled={applyingAll}
            className="text-xs px-3 py-1 rounded"
            style={{
              backgroundColor: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            {applyingAll
              ? t("applying")
              : selectedFiles.length > 0
                ? t("acceptSelected")
                : t("acceptAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
