/**
 * Node-only disk persistence for the KnoxChat /v1/models warm cache.
 *
 * Keep this file out of GUI bundles — register it from VS Code / binary
 * entrypoints via `registerKnoxChatModelsDiskAdapter`.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { KnoxChatModelsDiskAdapter } from "./knoxChatModels.js";

export const KNOX_CHAT_MODELS_CACHE_FILENAME = "knoxChatModelsCache.json";

function cacheFilePath(): string {
  const dir = process.env.KNOX_GLOBAL_DIR ?? path.join(os.homedir(), ".knox");
  return path.join(dir, KNOX_CHAT_MODELS_CACHE_FILENAME);
}

export const nodeKnoxChatModelsDiskAdapter: KnoxChatModelsDiskAdapter = {
  readSync(): string | null {
    const filePath = cacheFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf8");
  },

  async write(serialized: string): Promise<void> {
    const filePath = cacheFilePath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, serialized, "utf8");
  },
};
