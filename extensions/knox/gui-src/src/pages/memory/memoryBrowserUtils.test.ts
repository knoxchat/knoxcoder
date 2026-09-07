import { describe, expect, it } from "vitest";

import {
  filterAndSortMemories,
  groupMemoriesByDate,
  memoriesToExportJson,
  memoriesToExportMarkdown,
  rangeSelectIds,
  snippet,
  type MemoryItem,
} from "./memoryBrowserUtils";

function mem(partial: Partial<MemoryItem> & Pick<MemoryItem, "id" | "title">): MemoryItem {
  return {
    category: "fact",
    content: partial.content ?? partial.title,
    keywords: "",
    importance_score: 0.5,
    retrieval_count: 0,
    tier: "warm",
    created_at: "2026-08-16T00:00:00.000Z",
    last_accessed_at: null,
    source_session_id: null,
    ...partial,
  };
}

describe("memoryBrowserUtils", () => {
  it("filters by category, tier, and pin, then sorts", () => {
    const items = [
      mem({ id: 1, title: "A", category: "decision", tier: "hot", pinned: true, importance_score: 0.2, retrieval_count: 9 }),
      mem({ id: 2, title: "B", category: "fact", tier: "cold", pinned: false, importance_score: 0.9, retrieval_count: 1 }),
      mem({ id: 3, title: "C", category: "fact", tier: "hot", pinned: true, importance_score: 0.7, retrieval_count: 4 }),
    ];

    expect(filterAndSortMemories(items, { category: "fact" }).map((m) => m.id).sort()).toEqual([2, 3]);
    expect(filterAndSortMemories(items, { tier: "hot" }).map((m) => m.id).sort()).toEqual([1, 3]);
    expect(filterAndSortMemories(items, { pinned: "pinned" }).map((m) => m.id).sort()).toEqual([1, 3]);
    expect(filterAndSortMemories(items, { sortBy: "importance" }).map((m) => m.id)).toEqual([2, 3, 1]);
    expect(filterAndSortMemories(items, { sortBy: "accessed" }).map((m) => m.id)).toEqual([1, 3, 2]);
  });

  it("groups memories into today / week / month / earlier", () => {
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    const items = [
      mem({ id: 1, title: "today", created_at: "2026-08-16T10:00:00.000Z" }),
      mem({ id: 2, title: "week", created_at: "2026-08-12T10:00:00.000Z" }),
      mem({ id: 3, title: "month", created_at: "2026-07-25T10:00:00.000Z" }),
      mem({ id: 4, title: "old", created_at: "2026-01-01T10:00:00.000Z" }),
    ];
    const sections = groupMemoriesByDate(items, now);
    expect(sections.map((s) => [s.headerKey, s.memories.map((m) => m.id)])).toEqual([
      ["today", [1]],
      ["thisWeek", [2]],
      ["thisMonth", [3]],
      ["memoryEarlier", [4]],
    ]);
  });

  it("exports JSON and Markdown for selected memories", () => {
    const items = [mem({ id: 7, title: "RNG", content: "xorshift", category: "decision", pinned: true })];
    const json = JSON.parse(memoriesToExportJson(items));
    expect(json.version).toBe("knox-memories-selected-v1");
    expect(json.count).toBe(1);
    expect(json.memories[0].title).toBe("RNG");
    expect(json.memories[0].pinned).toBe(true);

    const md = memoriesToExportMarkdown(items);
    expect(md).toContain("# Memories export (1)");
    expect(md).toContain("## RNG");
    expect(md).toContain("xorshift");
    expect(md).toContain("Pin: yes");
  });

  it("range-selects inclusive ids and toggles without an anchor", () => {
    const ordered = [1, 2, 3, 4];
    expect([...rangeSelectIds(ordered, null, 2, new Set())]).toEqual([2]);
    expect([...rangeSelectIds(ordered, 1, 3, new Set([1]))].sort()).toEqual([1, 2, 3]);
  });

  it("truncates snippets", () => {
    expect(snippet("short")).toBe("short");
    expect(snippet("a".repeat(120)).endsWith("…")).toBe(true);
    expect(snippet("a".repeat(120)).length).toBe(96);
  });
});
