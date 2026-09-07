export interface MemoryItem {
  id: number;
  category: string;
  title: string;
  content: string;
  keywords: string;
  importance_score: number;
  retrieval_count: number;
  tier: string;
  created_at: string;
  last_accessed_at: string | null;
  source_session_id: string | null;
  pinned?: boolean;
}

export type MemorySortBy = "recent" | "importance" | "accessed";
export type MemoryPinnedFilter = "all" | "pinned" | "unpinned";

export function filterAndSortMemories(
  memories: MemoryItem[],
  opts: {
    category?: string;
    tier?: string;
    pinned?: MemoryPinnedFilter;
    sortBy?: MemorySortBy;
  },
): MemoryItem[] {
  let filtered = memories;
  if (opts.category && opts.category !== "all") {
    filtered = filtered.filter((m) => m.category === opts.category);
  }
  if (opts.tier && opts.tier !== "all") {
    filtered = filtered.filter((m) => m.tier === opts.tier);
  }
  if (opts.pinned === "pinned") {
    filtered = filtered.filter((m) => !!m.pinned);
  } else if (opts.pinned === "unpinned") {
    filtered = filtered.filter((m) => !m.pinned);
  }

  if (opts.sortBy === "importance") {
    return [...filtered].sort(
      (a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0),
    );
  }
  if (opts.sortBy === "accessed") {
    return [...filtered].sort(
      (a, b) => (b.retrieval_count ?? 0) - (a.retrieval_count ?? 0),
    );
  }
  return [...filtered].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export type MemoryDateSection = {
  headerKey: "today" | "thisWeek" | "thisMonth" | "memoryEarlier";
  memories: MemoryItem[];
};

export function groupMemoriesByDate(
  memories: MemoryItem[],
  now = Date.now(),
): MemoryDateSection[] {
  const yesterday = now - 1000 * 60 * 60 * 24;
  const lastWeek = now - 1000 * 60 * 60 * 24 * 7;
  const lastMonth = now - 1000 * 60 * 60 * 24 * 30;

  const sections: MemoryDateSection[] = [];
  let currentKey: MemoryDateSection["headerKey"] | "" = "";
  let current: MemoryItem[] = [];

  const flush = () => {
    if (currentKey && current.length) {
      sections.push({ headerKey: currentKey, memories: current });
    }
  };

  for (const memory of memories) {
    const date = new Date(memory.created_at).getTime();
    let key: MemoryDateSection["headerKey"];
    if (date > yesterday) {
      key = "today";
    } else if (date > lastWeek) {
      key = "thisWeek";
    } else if (date > lastMonth) {
      key = "thisMonth";
    } else {
      key = "memoryEarlier";
    }

    if (key !== currentKey) {
      flush();
      currentKey = key;
      current = [memory];
    } else {
      current.push(memory);
    }
  }
  flush();
  return sections;
}

export function memoriesToExportJson(memories: MemoryItem[]): string {
  return JSON.stringify(
    {
      version: "knox-memories-selected-v1",
      exported_at: new Date().toISOString(),
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        category: m.category,
        title: m.title,
        content: m.content,
        keywords: m.keywords,
        importance_score: m.importance_score,
        retrieval_count: m.retrieval_count,
        tier: m.tier,
        created_at: m.created_at,
        last_accessed_at: m.last_accessed_at,
        source_session_id: m.source_session_id,
        pinned: !!m.pinned,
      })),
    },
    null,
    2,
  );
}

export function memoriesToExportMarkdown(memories: MemoryItem[]): string {
  const lines = [
    `# Memories export (${memories.length})`,
    "",
    `Exported ${new Date().toISOString()}`,
    "",
  ];
  for (const memory of memories) {
    lines.push(`## ${memory.title || "(untitled)"}`);
    lines.push("");
    lines.push(
      `- Category: ${memory.category || "general"} · Tier: ${memory.tier || "—"} · Pin: ${memory.pinned ? "yes" : "no"}`,
    );
    if (memory.keywords) {
      lines.push(`- Keywords: ${memory.keywords}`);
    }
    lines.push(`- Created: ${memory.created_at}`);
    lines.push("");
    lines.push(memory.content || "");
    lines.push("");
  }
  return lines.join("\n");
}

export function rangeSelectIds(
  orderedIds: number[],
  fromId: number | null,
  toId: number,
  current: Set<number>,
): Set<number> {
  if (fromId == null) {
    const next = new Set(current);
    if (next.has(toId)) next.delete(toId);
    else next.add(toId);
    return next;
  }
  const from = orderedIds.indexOf(fromId);
  const to = orderedIds.indexOf(toId);
  if (from < 0 || to < 0) {
    const next = new Set(current);
    if (next.has(toId)) next.delete(toId);
    else next.add(toId);
    return next;
  }
  const [start, end] = from < to ? [from, to] : [to, from];
  const next = new Set(current);
  for (let i = start; i <= end; i++) {
    next.add(orderedIds[i]);
  }
  return next;
}

export function snippet(text: string, max = 96): string {
  const compact = (text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}
