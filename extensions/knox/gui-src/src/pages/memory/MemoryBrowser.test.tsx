import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { MemoryBrowser } from "./MemoryBrowser";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "count" in opts) return `${key}(${opts.count})`;
      if (opts && "title" in opts) return `${key}(${opts.title})`;
      return key;
    },
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const sampleMemories = [
  {
    id: 1,
    category: "decision",
    title: "Chose minifb",
    content: "Chose minifb for lightweight window rendering",
    keywords: "minifb,rust",
    importance_score: 0.8,
    retrieval_count: 3,
    tier: "hot",
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    source_session_id: "sess-1",
    pinned: false,
  },
  {
    id: 2,
    category: "code_pattern",
    title: "xorshift RNG",
    content: "Used xorshift RNG for deterministic piece generation",
    keywords: "rng",
    importance_score: 0.6,
    retrieval_count: 1,
    tier: "warm",
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    source_session_id: null,
    pinned: true,
  },
  {
    id: 3,
    category: "fact",
    title: "Tetris board",
    content: "10x20 playfield",
    keywords: "tetris",
    importance_score: 0.4,
    retrieval_count: 0,
    tier: "cold",
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    source_session_id: null,
    pinned: false,
  },
];

function renderBrowser(requestImpl?: (msg: string, data?: any) => Promise<any>) {
  const request = vi.fn(async (msg: string, data?: any) => {
    if (requestImpl) {
      const override = await requestImpl(msg, data);
      if (override !== undefined) return override;
    }
    if (msg === "brain/searchMemories") {
      return { status: "success", content: { memories: sampleMemories } };
    }
    if (msg === "brain/deleteMemories") {
      return { status: "success", content: { deleted: data.ids.length, failed: 0, errors: [] } };
    }
    if (msg === "brain/pinMemories" || msg === "brain/unpinMemories") {
      return { status: "success", content: { updated: data.ids.length, failed: 0 } };
    }
    return { status: "success", content: { success: true } };
  });

  const messenger = {
    request,
    post: vi.fn(),
    respond: vi.fn(),
    streamRequest: vi.fn(),
    llmStreamChat: vi.fn(),
    ide: {} as any,
  } as any;

  render(
    <IdeMessengerContext.Provider value={messenger}>
      <MemoryBrowser />
    </IdeMessengerContext.Provider>,
  );

  return { request };
}

describe("MemoryBrowser mass manage", () => {
  it("selects all visible memories and bulk-deletes them in one request", async () => {
    const { request } = renderBrowser();

    await screen.findByText("Chose minifb");

    fireEvent.click(screen.getByTitle("memorySelectMultiple"));
    fireEvent.click(screen.getByTitle("memorySelectAllMemories"));

    expect(screen.getByTestId("memory-selected-count").textContent).toContain("selectedCount(3)");

    fireEvent.click(screen.getByTitle("memoryDeleteSelected"));
    fireEvent.click(screen.getByTestId("memory-confirm-delete"));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("brain/deleteMemories", {
        ids: expect.arrayContaining([1, 2, 3]),
      });
    });
  });

  it("clears and exits selection mode like checkpoints", async () => {
    renderBrowser();
    await screen.findByText("xorshift RNG");

    fireEvent.click(screen.getByTitle("memorySelectMultiple"));
    fireEvent.click(screen.getByTitle("memorySelectAllMemories"));
    expect(screen.getByTestId("memory-selected-count")).toBeTruthy();

    fireEvent.click(screen.getByTitle("clearAllSelections"));
    expect(screen.queryByTestId("memory-selected-count")).toBeNull();

    fireEvent.click(screen.getByTitle("exitSelectionMode"));
    expect(screen.queryByTitle("memorySelectAllMemories")).toBeNull();
    expect(screen.getByTitle("memorySelectMultiple")).toBeTruthy();
  });

  it("pins selected memories through the batch endpoint", async () => {
    const { request } = renderBrowser();
    await screen.findByText("Tetris board");

    fireEvent.click(screen.getByTitle("memorySelectMultiple"));
    fireEvent.click(screen.getByTestId("memory-row-1"));
    fireEvent.click(screen.getByTitle("memoryPinSelected"));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("brain/pinMemories", { ids: [1] });
    });
  });

  it("copies selected memories as JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBrowser();
    await screen.findByText("Chose minifb");

    fireEvent.click(screen.getByTitle("memorySelectMultiple"));
    fireEvent.click(screen.getByTitle("memorySelectAllMemories"));
    fireEvent.click(screen.getByTitle("memoryExportSelectedJson"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload.count).toBe(3);
    expect(payload.version).toBe("knox-memories-selected-v1");
  });

  it("header checkbox selects and clears the filtered list", async () => {
    renderBrowser();
    await screen.findByText("Chose minifb");

    fireEvent.click(screen.getByTitle("memorySelectMultiple"));
    fireEvent.click(screen.getByTestId("memory-select-all-header"));
    expect(screen.getByTestId("memory-selected-count").textContent).toContain("selectedCount(3)");

    fireEvent.click(screen.getByTestId("memory-select-all-header"));
    expect(screen.queryByTestId("memory-selected-count")).toBeNull();
  });
});
