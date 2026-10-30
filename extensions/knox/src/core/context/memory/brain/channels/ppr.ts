/**
 * MEM-25 — Hub-damped Personalized PageRank.
 *
 *   π_q = α e_q + (1 − α) π_q P,  α = 0.15
 *   P_uv = (φ_E(u,v) / log(2 + deg v)) / Σ_{v′} (φ_E(u,v′) / log(2 + deg v′))
 *
 * e_q is the normalized indicator of query entities. High-degree hubs are
 * damped so a generic node does not activate the whole graph. Approximate
 * push-PPR with residual tolerance ε touches O(1/(αε)) nodes, independent
 * of |V|. Graph scores are a probability distribution in [0, 1].
 *
 *   S_graph(m, q) = max_{e ∈ ent(m)} π_q(e)
 *
 * Lexical only — no embeddings or neural rerank. This is a channel over the
 * same rows, not extra C_addr capacity.
 */

export const PPR_ALPHA_DEFAULT = 0.15;
export const PPR_EPSILON_DEFAULT = 1e-4;
export const PPR_MAX_PUSHES_DEFAULT = 20_000;

export interface GraphNeighbor {
  id: number;
  weight: number;
}

export interface PprOptions {
  alpha?: number;
  epsilon?: number;
  maxPushes?: number;
}

export interface PprResult {
  scores: Map<number, number>;
  depths: Map<number, number>;
  pushes: number;
  alpha: number;
  epsilon: number;
}

export interface InMemoryGraphView {
  neighbors: (id: number) => GraphNeighbor[];
  degree: (id: number) => number;
}

export function resolvePprAlpha(value?: number): number {
  if (Number.isFinite(value) && (value as number) > 0 && (value as number) < 1) {
    return value as number;
  }
  return PPR_ALPHA_DEFAULT;
}

export function resolvePprEpsilon(value?: number): number {
  if (Number.isFinite(value) && (value as number) > 0 && (value as number) < 1) {
    return value as number;
  }
  return PPR_EPSILON_DEFAULT;
}

export function resolvePprMaxPushes(value?: number): number {
  if (Number.isFinite(value) && (value as number) >= 1) {
    return Math.floor(value as number);
  }
  return PPR_MAX_PUSHES_DEFAULT;
}

/** Normalized seed mass (e_q). Empty input → empty map. */
export function normalizeSeedMass(
  seeds: Iterable<number> | Map<number, number>,
): Map<number, number> {
  const raw = new Map<number, number>();
  if (seeds instanceof Map) {
    for (const [id, weight] of seeds) {
      if (!Number.isFinite(id) || !Number.isFinite(weight) || weight <= 0) continue;
      raw.set(id, (raw.get(id) ?? 0) + weight);
    }
  } else {
    for (const id of seeds) {
      if (!Number.isFinite(id)) continue;
      raw.set(id, (raw.get(id) ?? 0) + 1);
    }
  }
  let sum = 0;
  for (const weight of raw.values()) sum += weight;
  const out = new Map<number, number>();
  if (sum <= 0) return out;
  for (const [id, weight] of raw) out.set(id, weight / sum);
  return out;
}

/**
 * Hub-damped row of P: destination degree shrinks the raw edge weight
 * before the row is normalized.
 */
export function hubDampedTransitions(
  neighbors: GraphNeighbor[],
  degreeOf: (id: number) => number,
): Array<{ id: number; probability: number }> {
  const scored: Array<{ id: number; raw: number }> = [];
  let denom = 0;
  for (const neighbor of neighbors) {
    if (!(neighbor.weight > 0)) continue;
    const deg = Math.max(0, degreeOf(neighbor.id));
    const raw = neighbor.weight / Math.log(2 + deg);
    if (!(raw > 0) || !Number.isFinite(raw)) continue;
    scored.push({ id: neighbor.id, raw });
    denom += raw;
  }
  if (denom <= 0) return [];
  return scored.map((row) => ({ id: row.id, probability: row.raw / denom }));
}

/**
 * Undirected in-memory view. Parallel edges sum; self-loops are dropped.
 * Degree is the number of unique neighbors after aggregation.
 */
export function graphViewFromEdges(
  edges: Array<{ source: number; target: number; weight?: number }>,
): InMemoryGraphView {
  const adj = new Map<number, Map<number, number>>();
  const add = (from: number, to: number, weight: number) => {
    if (from === to || !(weight > 0)) return;
    let row = adj.get(from);
    if (!row) {
      row = new Map();
      adj.set(from, row);
    }
    row.set(to, (row.get(to) ?? 0) + weight);
  };
  for (const edge of edges) {
    const weight = Number.isFinite(edge.weight) ? Math.max(0, edge.weight as number) : 1;
    add(edge.source, edge.target, weight);
    add(edge.target, edge.source, weight);
  }
  const cache = new Map<number, GraphNeighbor[]>();
  const neighbors = (id: number): GraphNeighbor[] => {
    let list = cache.get(id);
    if (!list) {
      const row = adj.get(id);
      list = row
        ? [...row.entries()].map(([nid, weight]) => ({ id: nid, weight }))
        : [];
      cache.set(id, list);
    }
    return list;
  };
  return {
    neighbors,
    degree: (id: number) => neighbors(id).length,
  };
}

/**
 * Push-based approximate PPR (Andersen–Chung–Lang style).
 * Push while some residual ≥ ε. Cost is O(1/(αε)) pushes, independent of |V|.
 * Dangling nodes teleport leftover mass back onto e_q.
 */
export async function pushPersonalizedPageRank(
  seeds: Iterable<number> | Map<number, number>,
  getNeighbors: (id: number) => GraphNeighbor[] | Promise<GraphNeighbor[]>,
  getDegree: (id: number) => number | Promise<number>,
  options: PprOptions = {},
): Promise<PprResult> {
  const alpha = resolvePprAlpha(options.alpha);
  const epsilon = resolvePprEpsilon(options.epsilon);
  const maxPushes = resolvePprMaxPushes(options.maxPushes);
  const e = normalizeSeedMass(seeds);
  const scores = new Map<number, number>();
  const residual = new Map<number, number>();
  const depths = new Map<number, number>();
  const queued = new Set<number>();
  const queue: number[] = [];

  const enqueue = (id: number) => {
    if ((residual.get(id) ?? 0) >= epsilon && !queued.has(id)) {
      queued.add(id);
      queue.push(id);
    }
  };

  const addResidual = (id: number, amount: number, fromId: number | null) => {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    residual.set(id, (residual.get(id) ?? 0) + amount);
    if (!depths.has(id)) {
      depths.set(id, fromId == null ? 0 : (depths.get(fromId) ?? 0) + 1);
    }
    enqueue(id);
  };

  for (const [id, mass] of e) addResidual(id, mass, null);

  let pushes = 0;
  while (queue.length > 0 && pushes < maxPushes) {
    const u = queue.shift()!;
    queued.delete(u);
    const ru = residual.get(u) ?? 0;
    if (ru < epsilon) continue;

    residual.set(u, 0);
    scores.set(u, (scores.get(u) ?? 0) + alpha * ru);
    const leftover = (1 - alpha) * ru;
    const neighbors = await getNeighbors(u);
    const degCache = new Map<number, number>();
    for (const neighbor of neighbors) {
      if (!degCache.has(neighbor.id)) {
        degCache.set(neighbor.id, await getDegree(neighbor.id));
      }
    }
    const transitions = hubDampedTransitions(neighbors, (id) => degCache.get(id) ?? 0);
    if (transitions.length === 0) {
      for (const [seedId, mass] of e) addResidual(seedId, leftover * mass, u);
    } else {
      for (const step of transitions) {
        addResidual(step.id, leftover * step.probability, u);
      }
    }
    pushes++;
  }

  return { scores, depths, pushes, alpha, epsilon };
}

export function pushPersonalizedPageRankSync(
  seeds: Iterable<number> | Map<number, number>,
  view: InMemoryGraphView,
  options: PprOptions = {},
): PprResult {
  const alpha = resolvePprAlpha(options.alpha);
  const epsilon = resolvePprEpsilon(options.epsilon);
  const maxPushes = resolvePprMaxPushes(options.maxPushes);
  const e = normalizeSeedMass(seeds);
  const scores = new Map<number, number>();
  const residual = new Map<number, number>();
  const depths = new Map<number, number>();
  const queued = new Set<number>();
  const queue: number[] = [];

  const enqueue = (id: number) => {
    if ((residual.get(id) ?? 0) >= epsilon && !queued.has(id)) {
      queued.add(id);
      queue.push(id);
    }
  };

  const addResidual = (id: number, amount: number, fromId: number | null) => {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    residual.set(id, (residual.get(id) ?? 0) + amount);
    if (!depths.has(id)) {
      depths.set(id, fromId == null ? 0 : (depths.get(fromId) ?? 0) + 1);
    }
    enqueue(id);
  };

  for (const [id, mass] of e) addResidual(id, mass, null);

  let pushes = 0;
  while (queue.length > 0 && pushes < maxPushes) {
    const u = queue.shift()!;
    queued.delete(u);
    const ru = residual.get(u) ?? 0;
    if (ru < epsilon) continue;

    residual.set(u, 0);
    scores.set(u, (scores.get(u) ?? 0) + alpha * ru);
    const leftover = (1 - alpha) * ru;
    const transitions = hubDampedTransitions(view.neighbors(u), view.degree);
    if (transitions.length === 0) {
      for (const [seedId, mass] of e) addResidual(seedId, leftover * mass, u);
    } else {
      for (const step of transitions) {
        addResidual(step.id, leftover * step.probability, u);
      }
    }
    pushes++;
  }

  return { scores, depths, pushes, alpha, epsilon };
}

/**
 * Power-iteration PPR on a finite component. Used to check the push
 * approximation; not the live retrieve path.
 */
export function exactPersonalizedPageRank(
  seeds: Iterable<number> | Map<number, number>,
  view: InMemoryGraphView,
  options: { alpha?: number; iterations?: number; tolerance?: number } = {},
): Map<number, number> {
  const alpha = resolvePprAlpha(options.alpha);
  const e = normalizeSeedMass(seeds);
  const nodes = new Set<number>(e.keys());
  const stack = [...nodes];
  while (stack.length > 0) {
    const u = stack.pop()!;
    for (const neighbor of view.neighbors(u)) {
      if (!nodes.has(neighbor.id)) {
        nodes.add(neighbor.id);
        stack.push(neighbor.id);
      }
    }
  }
  const ids = [...nodes];
  const trans = new Map<number, Array<{ id: number; probability: number }>>();
  for (const u of ids) {
    trans.set(u, hubDampedTransitions(view.neighbors(u), view.degree));
  }

  let pi = new Map<number, number>();
  for (const id of ids) pi.set(id, e.get(id) ?? 0);

  const iterations = Number.isFinite(options.iterations) ? Math.max(1, options.iterations as number) : 200;
  const tolerance = Number.isFinite(options.tolerance) ? Math.max(0, options.tolerance as number) : 1e-12;

  for (let i = 0; i < iterations; i++) {
    const next = new Map<number, number>();
    for (const v of ids) next.set(v, alpha * (e.get(v) ?? 0));
    for (const u of ids) {
      const mass = (1 - alpha) * (pi.get(u) ?? 0);
      if (!(mass > 0)) continue;
      const row = trans.get(u) ?? [];
      if (row.length === 0) {
        for (const [seedId, seedMass] of e) {
          next.set(seedId, (next.get(seedId) ?? 0) + mass * seedMass);
        }
      } else {
        for (const step of row) {
          next.set(step.id, (next.get(step.id) ?? 0) + mass * step.probability);
        }
      }
    }
    let delta = 0;
    for (const v of ids) delta += Math.abs((next.get(v) ?? 0) - (pi.get(v) ?? 0));
    pi = next;
    if (delta < tolerance) break;
  }
  return pi;
}

/** S_graph(m, q) = max_{e ∈ ent(m)} π_q(e). */
export function graphChannelScore(
  ppr: Map<number, number>,
  entityIds: Iterable<number>,
): number {
  let max = 0;
  for (const id of entityIds) {
    const score = ppr.get(id) ?? 0;
    if (score > max) max = score;
  }
  return max;
}

export function topPprEntities(
  ppr: Map<number, number>,
  limit: number,
  minScore = 0,
): Array<{ id: number; score: number }> {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return [...ppr.entries()]
    .filter(([, score]) => score > minScore)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, cap)
    .map(([id, score]) => ({ id, score }));
}

export function pprMass(ppr: Map<number, number>): number {
  let sum = 0;
  for (const score of ppr.values()) sum += score;
  return sum;
}
