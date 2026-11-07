/**
 * SQLite bind-list chunking.
 *
 * `SQLITE_MAX_VARIABLE_NUMBER` is 999 on many node-sqlite3 builds (32766 on
 * newer). A single `WHERE id IN (?,?,…)` over every live leaf during
 * consolidate hits that ceiling (`SQLITE_ERROR: too many SQL variables`) and
 * stalls the extension host. Keep each statement well under 999 so extra
 * prefix binds (tier, reason, type) still fit.
 */

export const SQLITE_BIND_CHUNK = 500;

export function bindChunkSize(extraBinds = 0, chunk = SQLITE_BIND_CHUNK): number {
  const extra = Math.max(0, Math.floor(extraBinds));
  const size = Math.floor(chunk) - extra;
  return size > 0 ? size : 1;
}

export function sqlPlaceholders(n: number): string {
  if (n <= 0) return "";
  return Array.from({ length: n }, () => "?").join(",");
}

export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n) as T[]);
  return out;
}

/** Let the extension host drain other messages between bind chunks. */
export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

export async function forBindChunks<T>(
  ids: readonly T[],
  extraBinds: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  for (const chunk of chunkList(ids, bindChunkSize(extraBinds))) {
    await fn(chunk);
    await yieldEventLoop();
  }
}

export async function collectBindChunks<T, R>(
  ids: readonly T[],
  extraBinds: number,
  fn: (chunk: T[]) => Promise<R[] | undefined | null>,
): Promise<R[]> {
  const out: R[] = [];
  await forBindChunks(ids, extraBinds, async (chunk) => {
    const rows = await fn(chunk);
    if (rows && rows.length > 0) out.push(...rows);
  });
  return out;
}
