/** In-memory config overlay on brain_config rows. */

import type { MemoryConfig } from "../types.js";
import { brainState } from "./state.js";

// ── Configuration ──────────────────────────────────────────────────────────

export function getConfig(): MemoryConfig {
  return { ...brainState.config };
}

/** Reset in-memory config to defaults, then overlay brain_config rows. */
export async function reloadConfig(): Promise<void> {
  await loadConfig();
}

export function getDefaultConfig(): MemoryConfig {
  if (!brainState.defaultConfigSnapshot) {
    brainState.defaultConfigSnapshot = { ...brainState.config };
  }
  return { ...brainState.defaultConfigSnapshot };
}

export async function saveConfig(key: string, value: string): Promise<void> {
  const { get } = await import("./connection.js");
  const db = await get();
  await db.run(
    `INSERT INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
    [key, value, value],
  );

  // Update in-memory config
  if (key in brainState.config) {
    const cfg = brainState.config as any;
    if (typeof cfg[key] === "boolean") {
      cfg[key] = value === "true";
    } else if (typeof cfg[key] === "number") {
      cfg[key] = Number(value);
    } else {
      cfg[key] = value;
    }
  }
}

export async function loadConfig(): Promise<void> {
  brainState.config = getDefaultConfig();
  try {
    const db = brainState.db!;
    const rows = await db.all("SELECT key, value FROM brain_config");
    for (const row of rows) {
      const key = (row as any).key;
      const value = (row as any).value;
      if (key in brainState.config) {
        const cfg = brainState.config as any;
        if (typeof cfg[key] === "boolean") {
          cfg[key] = value === "true";
        } else if (typeof cfg[key] === "number") {
          cfg[key] = Number(value);
        } else {
          cfg[key] = value;
        }
      }
    }
  } catch {
    // Config table might not exist yet on first run
  }
}
