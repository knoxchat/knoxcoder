/**
 * Wipe Memory Brain: backup sqlite, drop the live files, reopen empty.
 */

import fs from "fs";
import path from "path";

import { getMemoryBrainSqlitePath } from "../../../../util/paths.js";
import { close, get } from "./connection.js";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function wipeAll(): Promise<{ backup?: string; recreated: boolean }> {
  const dbPath = getMemoryBrainSqlitePath();
  await close();
  let backup: string | undefined;
  if (fs.existsSync(dbPath)) {
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    backup = path.join(dir, `wipe-${stamp()}.sqlite`);
    fs.copyFileSync(dbPath, backup);
  }
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + ext);
    } catch {
      // already gone
    }
  }
  await get();
  return { backup, recreated: true };
}
