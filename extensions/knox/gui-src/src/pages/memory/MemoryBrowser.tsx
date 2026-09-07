import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Trash2,
  Lightbulb,
  Target,
  Star,
  Wrench,
  Ruler,
  Folder,
  FileText,
  FileIcon,
  Check,
  AlertTriangle,
  X,
  ChevronDown,
  Pin,
  PinOff,
  CheckSquare,
  Square,
  FileJson,
  Copy,
} from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import {
  filterAndSortMemories,
  groupMemoriesByDate,
  memoriesToExportJson,
  memoriesToExportMarkdown,
  rangeSelectIds,
  snippet,
  type MemoryItem,
  type MemoryPinnedFilter,
  type MemorySortBy,
} from "./memoryBrowserUtils";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  insight: <Lightbulb size={14} />,
  decision: <Target size={14} />,
  preference: <Star size={14} />,
  error_fix: <Wrench size={14} />,
  code_pattern: <Ruler size={14} />,
  project_context: <Folder size={14} />,
  general: <FileText size={14} />,
  convention: <Ruler size={14} />,
};

const TIER_BADGES: Record<string, { bg: string; text: string }> = {
  hot: { bg: "rgba(239, 68, 68, 0.15)", text: "#ef4444" },
  warm: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
  cold: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ToolbarButton({
  onClick,
  title,
  disabled,
  danger,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded border px-2 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
      style={{
        backgroundColor: danger
          ? "rgba(239, 68, 68, 0.12)"
          : active
            ? "var(--vscode-button-background)"
            : "var(--vscode-button-secondaryBackground)",
        color: danger
          ? "#f87171"
          : active
            ? "var(--vscode-button-foreground)"
            : "var(--vscode-button-secondaryForeground)",
        borderColor: danger ? "rgba(239, 68, 68, 0.35)" : "var(--vscode-panel-border)",
      }}
    >
      {children}
    </button>
  );
}

export function MemoryBrowser() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [filterPinned, setFilterPinned] = useState<MemoryPinnedFilter>("all");
  const [sortBy, setSortBy] = useState<MemorySortBy>("recent");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "single" | "bulk"; id?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const memoriesRef = useRef<MemoryItem[]>([]);
  memoriesRef.current = memories;
  const lastClickedIdRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    setTimeout(() => setError(null), 5000);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const loadMemories = useCallback(async (append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const currentOffset = append ? memoriesRef.current.length : 0;
      const limit = pageSize;

      const pinnedFilter =
        filterPinned === "all" ? undefined : filterPinned === "pinned";
      const tierFilter = filterTier === "all" ? undefined : filterTier;

      if (searchQuery.trim()) {
        const result = await ideMessenger.request("brain/searchMemories", {
          query: searchQuery,
          category: filterCategory === "all" ? undefined : filterCategory,
          tier: tierFilter,
          pinned: pinnedFilter,
          limit: currentOffset + limit + 1,
          offset: 0,
        });
        if (result.status === "success") {
          const content = result.content as any;
          const items = Array.isArray(content?.memories) ? content.memories : [];
          const pageItems = items.slice(currentOffset, currentOffset + limit);
          const hasMoreItems = items.length > currentOffset + limit;
          setMemories(append ? [...memoriesRef.current, ...pageItems] : pageItems);
          setHasMore(hasMoreItems);
        }
      } else {
        const result = await ideMessenger.request("brain/searchMemories", {
          query: undefined,
          category: filterCategory === "all" ? undefined : filterCategory,
          tier: tierFilter,
          pinned: pinnedFilter,
          limit: limit + 1,
          offset: currentOffset,
        });
        if (result.status === "success") {
          const content = result.content as any;
          const items = Array.isArray(content?.memories) ? content.memories : [];
          const hasMoreItems = items.length > limit;
          const pageItems = items.slice(0, limit);
          setMemories(append ? [...memoriesRef.current, ...pageItems] : pageItems);
          setHasMore(hasMoreItems);
        }
      }
    } catch (e) {
      showError(t("memoryLoadError"));
      console.error("Failed to load memories:", e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [searchQuery, filterCategory, filterTier, filterPinned, ideMessenger, pageSize, showError, t]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSelectedIds(new Set());
      lastClickedIdRef.current = null;
      void loadMemories(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [loadMemories]);

  const filtered = useMemo(
    () =>
      filterAndSortMemories(memories, {
        category: filterCategory,
        tier: filterTier,
        pinned: filterPinned,
        sortBy,
      }),
    [memories, filterCategory, filterTier, filterPinned, sortBy],
  );

  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id));

  const dateSections = useMemo(
    () => (sortBy === "recent" ? groupMemoriesByDate(filtered) : null),
    [filtered, sortBy],
  );

  const handleDelete = async (id: number) => {
    setError(null);
    setBusy(true);
    try {
      const result = await ideMessenger.request("brain/deleteMemory", { id });
      if (result.status === "success" && (result.content as any)?.success) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        showError(t("memoryDeleteFailed"));
      }
    } catch {
      showError(t("memoryDeleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async (id: number, currentlyPinned: boolean) => {
    setError(null);
    try {
      const result = await ideMessenger.request(
        currentlyPinned ? "brain/unpinMemory" : "brain/pinMemory",
        { id },
      );
      if (result.status === "success" && (result.content as any)?.success) {
        setMemories((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, pinned: !currentlyPinned } : m,
          ),
        );
      } else {
        showError(t("memoryPinFailed"));
      }
    } catch {
      showError(t("memoryPinFailed"));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const result = await ideMessenger.request("brain/deleteMemories", { ids });
      const deleted =
        result.status === "success" ? Number((result.content as any)?.deleted ?? 0) : 0;
      const failCount =
        result.status === "success"
          ? Number((result.content as any)?.failed ?? Math.max(0, ids.length - deleted))
          : ids.length;
      setMemories((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
      setConfirmDelete(null);
      if (failCount > 0) {
        showError(t("memoryBulkDeletePartialFail", { count: failCount }));
      }
    } catch {
      showError(t("memoryDeleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleBulkPin = async (pin: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const result = await ideMessenger.request(
        pin ? "brain/pinMemories" : "brain/unpinMemories",
        { ids },
      );
      if (result.status === "success") {
        const failCount = Number((result.content as any)?.failed ?? 0);
        setMemories((prev) =>
          prev.map((m) => (selectedIds.has(m.id) ? { ...m, pinned: pin } : m)),
        );
        if (failCount > 0) {
          showError(t("memoryBulkPinPartialFail", { count: failCount }));
        } else {
          showNotice(pin ? t("memoryBulkPinned") : t("memoryBulkUnpinned"));
        }
      } else {
        showError(t("memoryPinFailed"));
      }
    } catch {
      showError(t("memoryPinFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleExportSelected = async (format: "json" | "markdown") => {
    const selected = filtered.filter((m) => selectedIds.has(m.id));
    if (selected.length === 0) return;
    const text =
      format === "json"
        ? memoriesToExportJson(selected)
        : memoriesToExportMarkdown(selected);
    try {
      await navigator.clipboard.writeText(text);
      showNotice(t("memoryExportSelectedCopied", { count: selected.length }));
    } catch {
      showError(t("memoryExportSelectedFailed"));
    }
  };

  const toggleSelect = (id: number, shiftKey = false) => {
    setSelectedIds((prev) =>
      rangeSelectIds(filteredIds, shiftKey ? lastClickedIdRef.current : null, id, prev),
    );
    lastClickedIdRef.current = id;
    if (!selectionMode) {
      setSelectionMode(true);
    }
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredIds));
    setSelectionMode(true);
  };

  const handleUnselectAll = () => {
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      handleUnselectAll();
    } else {
      handleSelectAll();
    }
  };

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitSelectionMode();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
          return;
        }
        e.preventDefault();
        handleSelectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, filteredIds]);

  const categories = [...new Set(memories.map((m) => m.category).filter(Boolean))];

  const renderMemoryRow = (memory: MemoryItem) => {
    const selected = selectedIds.has(memory.id);
    return (
      <div
        key={memory.id}
        data-testid={`memory-row-${memory.id}`}
        className={`group rounded-lg border p-2.5 transition-all ${selected ? "ring-1" : ""}`}
        style={{
          borderColor: selected ? "#159994" : "var(--vscode-panel-border)",
          cursor: selectionMode ? "pointer" : "default",
        }}
        onClick={(e) => {
          if (selectionMode) {
            toggleSelect(memory.id, e.shiftKey);
          } else {
            setExpandedId(expandedId === memory.id ? null : memory.id);
          }
        }}
      >
        <div className="flex items-center gap-2">
          {selectionMode && (
            <span
              role="checkbox"
              aria-checked={selected}
              aria-label={t("memorySelectRow", { title: memory.title })}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs"
              style={{
                borderColor: selected ? "#159994" : "var(--vscode-panel-border)",
                backgroundColor: selected ? "#159994" : "transparent",
                color: "#fff",
              }}
            >
              {selected && <Check size={10} />}
            </span>
          )}
          <span className="text-sm">{CATEGORY_ICONS[memory.category] || <FileIcon size={14} />}</span>
          <span
            className="rounded px-1 py-0.5 text-xs"
            style={{
              backgroundColor: "var(--vscode-badge-background)",
              color: "var(--vscode-badge-foreground)",
            }}
          >
            {memory.category}
          </span>
          {memory.tier && TIER_BADGES[memory.tier] && (
            <span
              className="rounded px-1 py-0.5 text-xs"
              style={{
                backgroundColor: TIER_BADGES[memory.tier].bg,
                color: TIER_BADGES[memory.tier].text,
              }}
            >
              {memory.tier}
            </span>
          )}
          <span className="flex-1 truncate text-sm font-medium">
            {memory.pinned ? (
              <Pin
                size={11}
                className="mr-1 inline align-[-1px]"
                style={{ color: "#159994" }}
              />
            ) : null}
            {memory.title}
          </span>
          {!selectionMode && (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-70">
              <button
                title={memory.pinned ? t("memoryUnpin") : t("memoryPin")}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleTogglePin(memory.id, !!memory.pinned);
                }}
                className="text-xs hover:opacity-100"
              >
                {memory.pinned ? (
                  <PinOff size={12} style={{ color: "#159994" }} />
                ) : (
                  <Pin size={12} />
                )}
              </button>
              <button
                title={t("memoryForget")}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete({ type: "single", id: memory.id });
                }}
                className="text-xs hover:opacity-100 hover:text-red-400"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        {expandedId !== memory.id && (
          <div className="mt-1 truncate pl-6 text-xs opacity-55">
            {snippet(memory.content || memory.title)}
          </div>
        )}

        {expandedId === memory.id && !selectionMode && (
          <div
            className="mt-2 space-y-2 border-t pt-2"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <pre className="whitespace-pre-wrap text-xs opacity-80">
              {memory.content}
            </pre>
            <div className="flex flex-wrap gap-3 text-xs opacity-50">
              <span>{t("memoryDetailImportance")}: {(memory.importance_score ?? 0).toFixed(2)}</span>
              <span>{t("memoryDetailUsed")}: {t("memoryDetailUsedTimes", { count: memory.retrieval_count ?? 0 })}</span>
              <span>{t("memoryDetailCreated")}: {formatDate(memory.created_at)}</span>
              {memory.last_accessed_at && (
                <span>{t("memoryDetailLastAccessed")}: {formatDate(memory.last_accessed_at)}</span>
              )}
              {memory.source_session_id && (
                <span>{t("memoryDetailSession")}: {memory.source_session_id.slice(0, 8)}…</span>
              )}
            </div>
            {memory.keywords && (
              <div className="flex flex-wrap gap-1">
                {memory.keywords.split(",").map((kw, i) => (
                  <span
                    key={i}
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{
                      backgroundColor: "var(--vscode-badge-background)",
                      color: "var(--vscode-badge-foreground)",
                    }}
                  >
                    {kw.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 py-4">
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-sm rounded-lg border p-4 shadow-lg"
            style={{
              backgroundColor: "var(--vscode-editor-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: "#f59e0b" }} />
              <h3 className="text-sm font-semibold">{t("memoryConfirmDelete")}</h3>
            </div>
            <p className="mb-2 text-xs opacity-70">
              {confirmDelete.type === "bulk"
                ? t("memoryConfirmBulkDelete", { count: selectedIds.size })
                : t("memoryConfirmDeleteSingle")}
            </p>
            <p className="mb-4 text-xs opacity-50">{t("cannotBeUndone")}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                {t("cancel")}
              </button>
              <button
                data-testid="memory-confirm-delete"
                disabled={busy}
                onClick={() => {
                  if (confirmDelete.type === "bulk") {
                    void handleBulkDelete();
                  } else if (confirmDelete.id != null) {
                    void handleDelete(confirmDelete.id).then(() => setConfirmDelete(null));
                  }
                }}
                className="rounded px-3 py-1.5 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.8)",
                  color: "#fff",
                }}
              >
                {t("deleteAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          className="flex items-center gap-2 rounded-lg border p-2.5 text-xs"
          style={{
            borderColor: "#ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "#ef4444",
          }}
        >
          <X size={14} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      {notice && (
        <div
          className="flex items-center gap-2 rounded-lg border p-2.5 text-xs"
          style={{
            borderColor: "#159994",
            backgroundColor: "rgba(21, 153, 148, 0.1)",
            color: "#159994",
          }}
        >
          <Check size={14} />
          <span className="flex-1">{notice}</span>
        </div>
      )}

      <div className="relative">
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("memorySearchPlaceholder")}
          className="w-full rounded border py-1.5 pl-7 pr-8 text-sm"
          style={{
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            borderColor: "var(--vscode-input-border)",
          }}
        />
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-50" />
        {searchQuery && (
          <button
            type="button"
            aria-label={t("clearSearch")}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
            onClick={() => {
              setSearchQuery("");
              searchInputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded border px-2 py-1"
          style={{
            backgroundColor: "var(--vscode-dropdown-background)",
            color: "var(--vscode-dropdown-foreground)",
            borderColor: "var(--vscode-dropdown-border)",
          }}
        >
          <option value="all">{t("memoryAllCategories")}</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={filterTier}
          onChange={(e) => setFilterTier(e.target.value)}
          className="rounded border px-2 py-1"
          style={{
            backgroundColor: "var(--vscode-dropdown-background)",
            color: "var(--vscode-dropdown-foreground)",
            borderColor: "var(--vscode-dropdown-border)",
          }}
        >
          <option value="all">{t("memoryAllTiers")}</option>
          <option value="hot">{t("memoryTierHot")}</option>
          <option value="warm">{t("memoryTierWarm")}</option>
          <option value="cold">{t("memoryTierCold")}</option>
        </select>

        <select
          value={filterPinned}
          onChange={(e) => setFilterPinned(e.target.value as MemoryPinnedFilter)}
          className="rounded border px-2 py-1"
          aria-label={t("memoryAllPins")}
          style={{
            backgroundColor: "var(--vscode-dropdown-background)",
            color: "var(--vscode-dropdown-foreground)",
            borderColor: "var(--vscode-dropdown-border)",
          }}
        >
          <option value="all">{t("memoryAllPins")}</option>
          <option value="pinned">{t("memoryPinnedOnly")}</option>
          <option value="unpinned">{t("memoryUnpinnedOnly")}</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as MemorySortBy)}
          className="rounded border px-2 py-1"
          style={{
            backgroundColor: "var(--vscode-dropdown-background)",
            color: "var(--vscode-dropdown-foreground)",
            borderColor: "var(--vscode-dropdown-border)",
          }}
        >
          <option value="recent">{t("memorySortRecent")}</option>
          <option value="importance">{t("memorySortImportance")}</option>
          <option value="accessed">{t("memorySortAccessed")}</option>
        </select>
      </div>

      <div
        className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b px-1 py-2"
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          borderColor: "var(--vscode-panel-border)",
        }}
      >
        <div className="flex items-center gap-2 text-xs opacity-70">
          {selectedIds.size > 0 && (
            <span
              data-testid="memory-selected-count"
              className="flex items-center gap-1 rounded px-1.5 py-0.5"
              style={{
                backgroundColor: "var(--vscode-badge-background)",
                color: "var(--vscode-badge-foreground)",
              }}
            >
              <Check size={10} />
              {t("selectedCount", { count: selectedIds.size })}
            </span>
          )}
          <span>
            {filtered.length} {t("memoryMemoriesFound")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {!selectionMode ? (
            <ToolbarButton
              onClick={() => setSelectionMode(true)}
              title={t("memorySelectMultiple")}
            >
              <CheckSquare size={12} />
              <span>{t("select")}</span>
            </ToolbarButton>
          ) : (
            <>
              <ToolbarButton
                onClick={handleSelectAll}
                title={t("memorySelectAllMemories")}
              >
                <CheckSquare size={12} />
                <span>{t("selectAll")}</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={handleUnselectAll}
                title={t("clearAllSelections")}
              >
                <Square size={12} />
                <span>{t("clear")}</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void handleBulkPin(true)}
                disabled={selectedIds.size === 0 || busy}
                title={t("memoryPinSelected")}
              >
                <Pin size={12} />
                <span className="hidden sm:inline">{t("memoryPin")}</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void handleBulkPin(false)}
                disabled={selectedIds.size === 0 || busy}
                title={t("memoryUnpinSelected")}
              >
                <PinOff size={12} />
                <span className="hidden sm:inline">{t("memoryUnpin")}</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void handleExportSelected("json")}
                disabled={selectedIds.size === 0}
                title={t("memoryExportSelectedJson")}
              >
                <FileJson size={12} />
                JSON
              </ToolbarButton>
              <ToolbarButton
                onClick={() => void handleExportSelected("markdown")}
                disabled={selectedIds.size === 0}
                title={t("memoryExportSelectedMarkdown")}
              >
                <Copy size={12} />
                MD
              </ToolbarButton>
              <ToolbarButton
                onClick={() => setConfirmDelete({ type: "bulk" })}
                disabled={selectedIds.size === 0 || busy}
                danger
                title={t("memoryDeleteSelected")}
              >
                <Trash2 size={12} />
                <span>{t("deleteCount", { count: selectedIds.size })}</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={exitSelectionMode}
                title={t("exitSelectionMode")}
              >
                <X size={12} />
                <span>{t("exit")}</span>
              </ToolbarButton>
            </>
          )}
        </div>
      </div>

      {selectionMode && filtered.length > 0 && (
        <button
          type="button"
          data-testid="memory-select-all-header"
          onClick={toggleSelectAllFiltered}
          className="flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-left text-xs"
          style={{
            borderColor: "var(--vscode-panel-border)",
            backgroundColor: "var(--vscode-input-background)",
          }}
        >
          <span
            role="checkbox"
            aria-checked={allFilteredSelected ? true : someFilteredSelected ? "mixed" : false}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
            style={{
              borderColor: someFilteredSelected ? "#159994" : "var(--vscode-panel-border)",
              backgroundColor: allFilteredSelected ? "#159994" : "transparent",
              color: "#fff",
            }}
          >
            {allFilteredSelected && <Check size={10} />}
            {!allFilteredSelected && someFilteredSelected && (
              <span className="block h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: "#159994" }} />
            )}
          </span>
          {allFilteredSelected ? t("clear") : t("selectAll")}
        </button>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-center">
            <div
              className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "#159994", borderTopColor: "transparent" }}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm opacity-50">
            {searchQuery || filterPinned !== "all" || filterTier !== "all"
              ? t("memoryNoResults")
              : t("memoryNoMemoriesStored")}
          </div>
        ) : dateSections ? (
          dateSections.map((section) => (
            <div key={section.headerKey} className="space-y-2">
              <div className="flex items-center justify-between pt-1">
                <h2 className="text-xs font-semibold opacity-70">{t(section.headerKey)}</h2>
                <span className="text-[10px] opacity-50">
                  {t("itemsCount", { count: section.memories.length })}
                </span>
              </div>
              {section.memories.map(renderMemoryRow)}
            </div>
          ))
        ) : (
          filtered.map(renderMemoryRow)
        )}
      </div>

      {hasMore && !loading && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => loadMemories(true)}
            disabled={loadingMore}
            className="flex items-center gap-1.5 rounded border px-4 py-2 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            {loadingMore ? (
              <div
                className="h-3 w-3 animate-spin rounded-full border border-t-transparent"
                style={{ borderColor: "#159994", borderTopColor: "transparent" }}
              />
            ) : (
              <ChevronDown size={14} />
            )}
            {t("memoryLoadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
