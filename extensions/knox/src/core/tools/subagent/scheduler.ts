/**
 * Bounded-concurrency scheduler for subagent fan-out (K-025).
 */

/** Hard ceiling on children per `task` call. */
export const MAX_SUBAGENT_FANOUT = 8;
export const DEFAULT_SUBAGENT_CONCURRENCY = 3;
export const MAX_SUBAGENT_CONCURRENCY = 8;

let configuredConcurrency: number | undefined;

/** Override the default concurrency (e.g. from a setting). `undefined` resets. */
export function setSubagentConcurrency(value: number | undefined): void {
  configuredConcurrency = value;
}

export function resolveSubagentConcurrency(requested?: unknown): number {
  const pick = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 1
      ? Math.floor(v)
      : undefined;
  const fromEnv = pick(Number(process.env.KNOX_SUBAGENT_CONCURRENCY));
  const value =
    pick(requested) ??
    configuredConcurrency ??
    fromEnv ??
    DEFAULT_SUBAGENT_CONCURRENCY;
  return Math.min(Math.max(1, value), MAX_SUBAGENT_CONCURRENCY);
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input
 * order. Items not yet started when `signal` aborts are skipped (`skipped`).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: { signal?: AbortSignal; skipped?: (item: T, index: number) => R },
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      if (opts?.signal?.aborted && opts.skipped) {
        results[index] = opts.skipped(items[index], index);
        continue;
      }
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

/** Serialises async critical sections (used for merge-back into the workspace). */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
