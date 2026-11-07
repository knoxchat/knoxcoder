/**
 * MEM-67 — per-channel cost accounting.
 *
 * Hard limits live in each channel. This module is the report the bench reads:
 * latency and visited counts, plus timeout / truncated flags.
 */

export type CostChannel = "lexical" | "ripgrep" | "graph" | "tree";

export interface ChannelCost {
  channel: CostChannel;
  latency_ms: number;
  visited: number;
  timed_out?: boolean;
  truncated?: boolean;
}

export interface FusionSearchMeta {
  channels: ChannelCost[];
  asOf?: string;
  reservedTreeKept: number;
  hops: number;
  gwOverBeam: boolean;
}

let lastMeta: FusionSearchMeta | null = null;

export function emptyChannelCost(channel: CostChannel): ChannelCost {
  return { channel, latency_ms: 0, visited: 0 };
}

export function timed<T>(
  channel: CostChannel,
  fn: () => Promise<T>,
  visitedOf: (result: T) => number,
): Promise<{ result: T; cost: ChannelCost }> {
  const started = Date.now();
  return fn().then((result) => ({
    result,
    cost: { channel, latency_ms: Math.max(0, Date.now() - started), visited: visitedOf(result) },
  }));
}

export function setLastSearchMeta(meta: FusionSearchMeta): void {
  lastMeta = meta;
}

export function getLastSearchMeta(): FusionSearchMeta | null {
  return lastMeta;
}

export function resetSearchMetaForTests(): void {
  lastMeta = null;
}
