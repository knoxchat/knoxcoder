import { AsyncLocalStorage } from "node:async_hooks";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Cross-process advisory lock for directories shared by several KnoxCoder
 * windows (checkpoint store, etc.).
 *
 * Acquisition is `mkdir`, which is atomic on every OS and filesystem we ship
 * on. The holder writes `owner.json` and refreshes the lock dir mtime as a
 * heartbeat. A lock is stale when its holder PID is dead (same host) or the
 * heartbeat stopped for `staleMs`. Stale locks are removed by renaming them
 * aside first, so a freshly acquired lock is not deleted by a slow contender.
 *
 * The lock is re-entrant within one async call chain (AsyncLocalStorage), so
 * a locked operation can call another locked operation on the same path.
 */

export interface FileLockOptions {
  /** Give up after this long. Default 15 s. */
  timeoutMs?: number;
  /** Consider a lock abandoned when its heartbeat is older than this. Default 30 s. */
  staleMs?: number;
  /** Heartbeat period. Default staleMs / 3. */
  heartbeatMs?: number;
  /** Poll interval upper bound while waiting. Default 100 ms. */
  pollMs?: number;
}

export class FileLockTimeoutError extends Error {
  constructor(
    readonly lockPath: string,
    readonly waitedMs: number,
  ) {
    super(`Timed out after ${waitedMs} ms waiting for lock ${lockPath}`);
    this.name = "FileLockTimeoutError";
  }
}

interface LockOwner {
  pid: number;
  host: string;
  token: string;
  acquiredAt: number;
}

const OWNER_FILE = "owner.json";
const held = new AsyncLocalStorage<ReadonlySet<string>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(lockPath, OWNER_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(lockPath)).mtimeMs;
  } catch {
    return false; // vanished; next mkdir attempt will win
  }
  const owner = await readOwner(lockPath);
  if (owner && owner.host === os.hostname() && !processAlive(owner.pid)) {
    return true;
  }
  return Date.now() - mtimeMs > staleMs;
}

async function removeStale(lockPath: string): Promise<void> {
  const aside = `${lockPath}.stale-${randomUUID()}`;
  try {
    await fs.rename(lockPath, aside);
  } catch {
    return; // someone else removed or re-acquired it
  }
  await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
}

/**
 * Run `fn` while holding the lock directory at `lockPath`. The parent
 * directory is created if missing.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const normalized = path.resolve(lockPath);
  const already = held.getStore();
  if (already?.has(normalized)) {
    return fn();
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? Math.max(50, Math.floor(staleMs / 3));
  const pollMs = options.pollMs ?? 100;

  await fs.mkdir(path.dirname(normalized), { recursive: true });

  const started = Date.now();
  const token = randomUUID();
  let delay = Math.min(10, pollMs);
  for (;;) {
    try {
      await fs.mkdir(normalized);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        throw e;
      }
    }
    if (await isStale(normalized, staleMs)) {
      await removeStale(normalized);
      continue;
    }
    const waited = Date.now() - started;
    if (waited >= timeoutMs) {
      throw new FileLockTimeoutError(normalized, waited);
    }
    await sleep(delay);
    delay = Math.min(pollMs, delay * 2);
  }

  const owner: LockOwner = {
    pid: process.pid,
    host: os.hostname(),
    token,
    acquiredAt: Date.now(),
  };
  await fs.writeFile(path.join(normalized, OWNER_FILE), JSON.stringify(owner)).catch(() => {});

  const beat = setInterval(() => {
    const now = new Date();
    void fs.utimes(normalized, now, now).catch(() => {});
  }, heartbeatMs);
  beat.unref?.();

  try {
    return await held.run(new Set([...(already ?? []), normalized]), fn);
  } finally {
    clearInterval(beat);
    // Only remove the lock if it is still ours (it may have been declared
    // stale and taken over while we were suspended).
    const current = await readOwner(normalized);
    if (!current || current.token === token) {
      await fs.rm(normalized, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Synchronous variant for code paths that cannot be async (sessions.json).
// Keep critical sections short: the event loop is blocked, so there is no
// heartbeat, and contenders may declare the lock stale after `staleMs`.
// ---------------------------------------------------------------------------

const heldSync = new Set<string>();

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isStaleSync(lockPath: string, staleMs: number): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = fsSync.statSync(lockPath).mtimeMs;
  } catch {
    return false;
  }
  let owner: LockOwner | undefined;
  try {
    owner = JSON.parse(fsSync.readFileSync(path.join(lockPath, OWNER_FILE), "utf8"));
  } catch {}
  if (owner && owner.host === os.hostname() && !processAlive(owner.pid)) {
    return true;
  }
  return Date.now() - mtimeMs > staleMs;
}

export function withFileLockSync<T>(
  lockPath: string,
  fn: () => T,
  options: Pick<FileLockOptions, "timeoutMs" | "staleMs" | "pollMs"> = {},
): T {
  const normalized = path.resolve(lockPath);
  if (heldSync.has(normalized)) {
    return fn();
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 30_000;
  const pollMs = options.pollMs ?? 50;

  fsSync.mkdirSync(path.dirname(normalized), { recursive: true });
  const started = Date.now();
  const token = randomUUID();
  for (;;) {
    try {
      fsSync.mkdirSync(normalized);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        throw e;
      }
    }
    if (isStaleSync(normalized, staleMs)) {
      const aside = `${normalized}.stale-${randomUUID()}`;
      try {
        fsSync.renameSync(normalized, aside);
        fsSync.rmSync(aside, { recursive: true, force: true });
      } catch {}
      continue;
    }
    const waited = Date.now() - started;
    if (waited >= timeoutMs) {
      throw new FileLockTimeoutError(normalized, waited);
    }
    sleepSync(pollMs);
  }

  const owner: LockOwner = { pid: process.pid, host: os.hostname(), token, acquiredAt: Date.now() };
  try {
    fsSync.writeFileSync(path.join(normalized, OWNER_FILE), JSON.stringify(owner));
  } catch {}
  heldSync.add(normalized);
  try {
    return fn();
  } finally {
    heldSync.delete(normalized);
    try {
      const current = JSON.parse(fsSync.readFileSync(path.join(normalized, OWNER_FILE), "utf8"));
      if (current.token === token) {
        fsSync.rmSync(normalized, { recursive: true, force: true });
      }
    } catch {
      fsSync.rmSync(normalized, { recursive: true, force: true });
    }
  }
}
