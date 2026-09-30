/**
 * Node-only disk persistence for the OpenRouter /api/v1/models warm cache.
 *
 * Keep this file out of GUI bundles — register it from VS Code / binary
 * entrypoints via `registerOpenRouterModelsDiskAdapter`.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { KNOX_GLOBAL_DIR_NAME } from "../util/globalDirName.js";

import type { KnoxChatModelsDiskAdapter } from "./knoxChatModels.js";

export const OPENROUTER_MODELS_CACHE_FILENAME = "openrouterModelsCache.json";

function cacheFilePath(): string {
  const dir =
    process.env.KNOX_GLOBAL_DIR ??
    path.join(os.homedir(), KNOX_GLOBAL_DIR_NAME);
  return path.join(dir, OPENROUTER_MODELS_CACHE_FILENAME);
}

export const nodeOpenRouterModelsDiskAdapter: KnoxChatModelsDiskAdapter = {
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
