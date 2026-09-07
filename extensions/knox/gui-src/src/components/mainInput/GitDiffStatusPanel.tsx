import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppSelector } from "../../redux/hooks";
import {
  getLocalStorageSync,
  LocalStorageKey,
  setLocalStorageSync,
} from "../../util/localStorage";

const CYAN = "#159994";

type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

interface FileDiffInfo {
  filename: string;
  filepath: string;
  displayPath: string;
  uri: string;
  additions: number;
  deletions: number;
  fileType: string;
  isBinary: boolean;
  status: FileStatus;
}

function getFileType(filename: string): string {
  const base = filename.split("/").pop() || filename;
  if (base === "go.mod") return "MOD";
  if (base === "go.sum") return "SUM";
  if (base.startsWith(".env")) return "ENV";
  if (base === ".gitignore" || base === ".gitattributes") return "GIT";

  const ext = base.includes(".")
    ? base.split(".").pop()?.toLowerCase() || ""
    : "";
  const map: Record<string, string> = {
    ts: "TS",
    tsx: "TSX",
    js: "JS",
    jsx: "JSX",
    py: "PY",
    rs: "RS",
    go: "GO",
    java: "JAVA",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    json: "JSON",
    md: "MD",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    sql: "SQL",
    sh: "SH",
    bash: "SH",
    vue: "VUE",
    svelte: "SVEL",
    node: "BIN",
    wasm: "BIN",
    so: "BIN",
    dll: "BIN",
    exe: "BIN",
  };
  if (map[ext]) return map[ext];
  if (!ext) return "FILE";
  return ext.slice(0, 4).toUpperCase();
}

function getFileTypeColor(fileType: string): string {
  const colors: Record<string, string> = {
    TS: "#3178c6",
    TSX: "#3178c6",
    JS: "#f7df1e",
    JSX: "#f7df1e",
    PY: "#3776ab",
    RS: "#dea584",
    GO: "#00add8",
    MOD: "#00add8",
    SUM: "#00add8",
    ENV: "#6e6e77",
    GIT: "#6e6e77",
    FILE: "#6e6e77",
    CSS: "#264de4",
    SCSS: "#cc6699",
    HTML: "#e34c26",
    JSON: "#cbcb41",
    MD: "#083fa1",
    YAML: "#cb171e",
    SQL: "#e38c00",
    VUE: "#42b883",
    SVEL: "#ff3e00",
    BIN: "#6e6e77",
  };
  return colors[fileType] || "#6e6e77";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathsMatch(changedPath: string, diffPath: string): boolean {
  const left = normalizePath(changedPath);
  const right = normalizePath(diffPath);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function parseDiffStats(diffString: string): FileDiffInfo | null {
  const headerMatch = diffString.match(/^diff --git a\/(.*?) b\/(.*)/m);
  if (!headerMatch) return null;

  const filepath = normalizePath(headerMatch[2]);
  const filename = filepath.split("/").pop() || filepath;
  const isBinary = /Binary files/.test(diffString);

  let additions = 0;
  let deletions = 0;

  if (!isBinary) {
    const lines = diffString.split("\n");
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
  }

  return {
    filename,
    filepath,
    displayPath: filepath,
    uri: filepath,
    additions,
    deletions,
    fileType: getFileType(filename),
    isBinary,
    status: additions > 0 && deletions === 0 ? "added" : "modified",
  };
}

function mergeDiffEntry(
  map: Map<string, FileDiffInfo>,
  parsed: FileDiffInfo,
) {
  const existing = map.get(parsed.filepath);
  if (!existing) {
    map.set(parsed.filepath, parsed);
    return;
  }
  map.set(parsed.filepath, {
    ...existing,
    additions: existing.additions + parsed.additions,
    deletions: existing.deletions + parsed.deletions,
    isBinary: existing.isBinary || parsed.isBinary,
  });
}

function buildDisplayPaths(files: FileDiffInfo[]): FileDiffInfo[] {
  const basenameCounts = new Map<string, number>();
  for (const file of files) {
    const count = basenameCounts.get(file.filename) ?? 0;
    basenameCounts.set(file.filename, count + 1);
  }

  return files.map((file) => {
    if ((basenameCounts.get(file.filename) ?? 0) <= 1) {
      return { ...file, displayPath: file.filepath };
    }

    const parts = file.filepath.split("/");
    if (parts.length >= 2) {
      return {
        ...file,
        displayPath: parts.slice(-2).join("/"),
      };
    }

    return file;
  });
}

function sortFiles(files: FileDiffInfo[]): FileDiffInfo[] {
  return [...files].sort((a, b) => {
    const aDelta = a.additions + a.deletions;
    const bDelta = b.additions + b.deletions;
    if (bDelta !== aDelta) {
      return bDelta - aDelta;
    }
    return a.filepath.localeCompare(b.filepath);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function FileTypeIcon({ type }: { type: string }) {
  const color = getFileTypeColor(type);
  const isConfig = ["JSON", "YAML", "TOML", "ENV"].includes(type);

  if (isConfig) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }

  return (
    <span
      className="inline-flex h-3 w-5 items-center justify-center overflow-hidden text-[9px] font-semibold leading-none shrink-0"
      style={{ color }}
    >
      {type}
    </span>
  );
}

function FileRow({
  file,
  onOpen,
}: {
  file: FileDiffInfo;
  onOpen: (file: FileDiffInfo) => void;
}) {
  const { t } = useTranslation();
  const showStats = file.additions > 0 || file.deletions > 0;

  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 py-1 px-2 text-xs text-left cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--vscode-foreground)_6%,transparent)]"
      style={{ background: "transparent", border: "none" }}
      onClick={() => onOpen(file)}
      title={file.filepath}
    >
      <FileTypeIcon type={file.fileType} />
      <span
        className="flex-1 truncate"
        style={{ color: "var(--vscode-foreground)" }}
      >
        {file.displayPath}
      </span>
      <span className="shrink-0 tabular-nums flex items-center gap-1.5">
        {file.isBinary && !showStats ? (
          <span className="text-[10px]" style={{ color: "#6e6e77" }}>
            {t("gitDiffBinary")}
          </span>
        ) : showStats ? (
          <>
            {file.additions > 0 && (
              <span style={{ color: "#4ade80" }}>+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span style={{ color: "#f87171" }}>-{file.deletions}</span>
            )}
          </>
        ) : null}
      </span>
    </button>
  );
}

export function GitDiffStatusPanel() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [files, setFiles] = useState<FileDiffInfo[]>([]);
  const [isExpanded, setIsExpanded] = useState(
    () => getLocalStorageSync(LocalStorageKey.GitDiffPanelExpanded) ?? true,
  );
  const [hasFetched, setHasFetched] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const wasStreamingRef = useRef(false);
  /** When true, git refreshes and remounts must not override the user's toggle */
  const expandedPinnedByUserRef = useRef(
    getLocalStorageSync(LocalStorageKey.GitDiffPanelExpanded) !== undefined,
  );

  const handleToggleExpanded = useCallback(() => {
    expandedPinnedByUserRef.current = true;
    setIsExpanded((prev) => {
      const next = !prev;
      setLocalStorageSync(LocalStorageKey.GitDiffPanelExpanded, next);
      return next;
    });
  }, []);

  const fetchChangedFiles = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 1500) return;
    lastFetchRef.current = now;

    try {
      let fileList: FileDiffInfo[] = [];

      const changedFilesResult = await withTimeout(
        ideMessenger.request("getGitChangedFiles", undefined),
        5000,
      );

      const hasServerFiles =
        changedFilesResult &&
        changedFilesResult.status === "success" &&
        changedFilesResult.content.length > 0;

      let diffStatsMap = new Map<string, FileDiffInfo>();
      if (!hasServerFiles) {
        const diffResult = await withTimeout(
          ideMessenger.request("getDiff", { includeUnstaged: true }),
          5000,
        );
        if (diffResult && diffResult.status === "success") {
          for (const diffStr of diffResult.content) {
            const parsed = parseDiffStats(diffStr);
            if (parsed) {
              mergeDiffEntry(diffStatsMap, parsed);
            }
          }
        }
      }

      if (hasServerFiles) {
        for (const changedFile of changedFilesResult.content) {
          const filepath = normalizePath(changedFile.filepath);
          const filename = filepath.split("/").pop() || filepath;
          const fileType = getFileType(filename);

          fileList.push({
            filename,
            filepath,
            displayPath: filepath,
            uri: changedFile.uri || filepath,
            additions: changedFile.additions ?? 0,
            deletions: changedFile.deletions ?? 0,
            fileType,
            isBinary:
              changedFile.isBinary ??
              (fileType === "BIN" &&
                (changedFile.additions ?? 0) === 0 &&
                (changedFile.deletions ?? 0) === 0),
            status: changedFile.status,
          });
        }
      } else if (diffStatsMap.size > 0) {
        fileList = Array.from(diffStatsMap.values());
      }

      if (!mountedRef.current) return;

      const nextFiles = sortFiles(buildDisplayPaths(fileList));
      let shouldExpandFresh = false;
      setFiles((prevFiles) => {
        if (
          prevFiles.length === 0 &&
          nextFiles.length > 0 &&
          !expandedPinnedByUserRef.current
        ) {
          shouldExpandFresh = true;
        }
        return nextFiles;
      });
      if (shouldExpandFresh) {
        setIsExpanded(true);
      }
      setHasFetched(true);
    } catch (e) {
      console.warn("[GitDiffStatusPanel] fetch failed:", e);
      if (mountedRef.current) {
        setHasFetched(true);
      }
    }
  }, [ideMessenger]);

  const handleOpenFile = useCallback(
    async (file: FileDiffInfo) => {
      try {
        if (file.status === "deleted") {
          await ideMessenger.request("openGitChange", { uri: file.uri });
          return;
        }
        await ideMessenger.ide.openFile(file.uri);
      } catch (e) {
        try {
          await ideMessenger.request("openGitChange", { uri: file.uri });
        } catch (fallbackError) {
          console.warn("[GitDiffStatusPanel] open file failed:", e, fallbackError);
        }
      }
    },
    [ideMessenger],
  );

  useWebviewListener("gitStateChanged", async () => {
    await fetchChangedFiles(true);
    return undefined;
  }, [fetchChangedFiles]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = setTimeout(() => fetchChangedFiles(), 500);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, [fetchChangedFiles]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const timer = setTimeout(() => fetchChangedFiles(true), 400);
      wasStreamingRef.current = isStreaming;
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, fetchChangedFiles]);

  useEffect(() => {
    const interval = setInterval(
      () => fetchChangedFiles(isStreaming),
      isStreaming ? 5000 : 15000,
    );
    return () => clearInterval(interval);
  }, [fetchChangedFiles, isStreaming]);

  if (!hasFetched || files.length === 0) return null;

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="attached-input-panel mx-0.5 mb-0 overflow-hidden transition-all duration-300">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 min-h-7 px-2.5 cursor-pointer transition-opacity hover:opacity-80"
        style={{ background: "transparent", border: "none" }}
        onClick={handleToggleExpanded}
      >
        <span className="shrink-0 flex items-center" style={{ color: CYAN }}>
          {isExpanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
        </span>

        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {t("filesChanged", { count: files.length })}
        </span>

        {(totalAdditions > 0 || totalDeletions > 0) && (
          <span className="text-[10px] tabular-nums flex items-center gap-1 ml-1">
            {totalAdditions > 0 && (
              <span style={{ color: "#4ade80" }}>+{totalAdditions}</span>
            )}
            {totalDeletions > 0 && (
              <span style={{ color: "#f87171" }}>-{totalDeletions}</span>
            )}
          </span>
        )}
      </button>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "40vh" : 0,
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div
          className="overflow-y-auto max-h-[38vh] pb-1"
          style={{
            borderTop: `1px solid color-mix(in srgb, ${CYAN} 10%, transparent)`,
          }}
        >
          {files.map((file) => (
            <FileRow
              key={file.filepath}
              file={file}
              onOpen={handleOpenFile}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
