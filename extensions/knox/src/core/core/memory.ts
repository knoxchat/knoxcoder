import { MemoryManager } from "../context/memory/MemoryManager";
import type { MemoryCreateInput, MemoryQuery } from "../context/memory/types";

import type { CoreRuntime } from "./runtime";

export function registerMemoryHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // ── Memory Management Handlers ──
  on("memory/create", async (msg) => {
    const id = await MemoryManager.remember(msg.data as MemoryCreateInput);
    return { id };
  });

  on("memory/search", async (msg) => {
    const items = await MemoryManager.recall(msg.data as MemoryQuery);
    return { items };
  });

  on("memory/delete", async (msg) => {
    const success = await MemoryManager.forget(msg.data.id);
    return { success };
  });

  on("memory/list", async () => {
    const items = await MemoryManager.listAll();
    return { items };
  });

  on("memory/cleanup", async () => {
    const removed = await MemoryManager.cleanup();
    return { removed };
  });
}
