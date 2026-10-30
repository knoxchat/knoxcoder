/**
 * Wipe Memory Brain: tombstone every leaf (deleted-by-policy), backup sqlite,
 * drop the live files, reopen empty. Destructive. forget/TTL stay reversible.
 */

import fs from "fs";
import path from "path";

import { getMemoryBrainSqlitePath } from "../../../../util/paths.js";
import { close, get } from "./connection.js";
import { tombstoneAllForPrivacyWipe } from "./tombstone.js";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function wipeAll(): Promise<{ backup?: string; recreated: boolean }> {
  const dbPath = getMemoryBrainSqlitePath();
  try {
    await tombstoneAllForPrivacyWipe();
    const db = await get();
    await db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // Still wipe — backup + unlink is the destructive step.
  }
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
