import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileLockTimeoutError, withFileLock } from "./fileLock";

describe("withFileLock", () => {
  let dir: string;
  let lock: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "knox-lock-"));
    lock = path.join(dir, ".store.lock");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("serializes concurrent critical sections", async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        withFileLock(lock, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 15));
          order.push(n);
          active--;
        }),
      ),
    );
    expect(maxActive).toBe(1);
    expect(order).toHaveLength(5);
    await expect(fs.stat(lock)).rejects.toThrow();
  });

  it("is re-entrant inside one call chain", async () => {
    const result = await withFileLock(lock, () =>
      withFileLock(lock, async () => "inner", { timeoutMs: 200 }),
    );
    expect(result).toBe("inner");
  });

  it("releases the lock when the callback throws", async () => {
    await expect(
      withFileLock(lock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withFileLock(lock, async () => 1, { timeoutMs: 200 })).resolves.toBe(1);
  });

  it("times out while another holder is alive", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = withFileLock(lock, () => gate);
    await new Promise((r) => setTimeout(r, 20));
    // Break re-entrancy by running outside the holder's async context.
    await expect(
      withFileLock(lock, async () => 1, { timeoutMs: 120, pollMs: 20 }),
    ).rejects.toBeInstanceOf(FileLockTimeoutError);
    release();
    await holder;
  });

  it("steals a lock whose owner process is dead", async () => {
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), token: "x", acquiredAt: 0 }),
    );
    await expect(withFileLock(lock, async () => "ok", { timeoutMs: 500 })).resolves.toBe("ok");
  });

  it("steals a lock whose heartbeat is older than staleMs", async () => {
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, host: "other-host", token: "x", acquiredAt: 0 }),
    );
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    await expect(
      withFileLock(lock, async () => "ok", { timeoutMs: 500, staleMs: 1_000 }),
    ).resolves.toBe("ok");
  });

  it("does not steal a fresh lock held by another live host", async () => {
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, host: "other-host", token: "x", acquiredAt: Date.now() }),
    );
    await expect(
      withFileLock(lock, async () => 1, { timeoutMs: 100, pollMs: 20, staleMs: 60_000 }),
    ).rejects.toBeInstanceOf(FileLockTimeoutError);
  });
});
