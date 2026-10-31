/**
 * MemoryHierarchy — revised Knox-MS stores vs buffers.
 *
 * C_addr = |M₃| + |M₄| + |M₅|  (raw stored tokens, no / rᵢ)
 *
 * | Level | Store                         | In C_addr |
 * | M₁    | Sensory buffer (this turn)    | no        |
 * | M₂    | Working memory (this call)    | no        |
 * | M₃    | Session + summary-tree nodes  | yes       |
 * | M₄    | Semantic / episodic leaves    | yes       |
 * | M₅    | Live recipes (leftover procs if uncovered) | yes |
 *
 * Graph / BM25 / ripgrep / tree walk are channels over the same rows, not
 * extra capacity. Recipe blob bytes and checkpoint trees are not C_addr.
 * MEM-38 checkpoint leaves are pointer text (`checkpoint_id=…`), never `|blobs|/rᵢ`.
 * M₅ counts a linked live workflow row **or** the recipe title/intent, not
 * both (MEM-09). Leftover `brain_procedures` count only when no live recipe
 * owns the same fingerprint (MEM-37).
 * IMP-04 (MEM-11) asserts this sum — never Σ |Mᵢ|/rᵢ and never M₁/M₂.
 */

import { BrainStore } from "./BrainStore.js";
import {
  leftoverCoveredByFingerprints,
  leftoverFingerprints,
  leftoverIntentFingerprint,
} from "./m5Surface.js";
import { getCompressionRatios, normalizeCompressionRatio } from "./memoryConfigAccess.js";
import { SensoryBuffer } from "./SensoryBuffer.js";
import type { CompressionRatios } from "./memoryConfigAccess.js";

export type MemoryLevelId = "M1" | "M2" | "M3" | "M4" | "M5";

/** M₁/M₂ are per-turn / per-call buffers. M₃–M₅ are stored rows in C_addr. */
export type MemoryLevelRole = "buffer" | "store";
/** M₁ turn, M₂ call, M₃ session, M₄/M₅ stored (MEM-33). */
export type MemoryLevelLifetime = "turn" | "call" | "session" | "stored";

export interface MemoryLevelSpec {
  id: MemoryLevelId;
  name: string;
  knox_label: string;
  ratio: number;
  retention: string;
  lifetime: MemoryLevelLifetime;
  capacity: string;
  role: MemoryLevelRole;
  in_c_addr: boolean;
}

export interface MemoryLevelMetrics {
  id: MemoryLevelId;
  name: string;
  tokens: number;
  /** Leftover rᵢ display. Not a C_addr factor (MEM-11). */
  ratio: number;
  /** Raw tokens (same as `tokens`). Leftover field name; never tokens/rᵢ. */
  effective_tokens: number;
  role: MemoryLevelRole;
  /** False for M₁/M₂ buffer gauges. */
  in_c_addr: boolean;
  lifetime: MemoryLevelLifetime;
}

export interface AddressableMemoryResult {
  levels: MemoryLevelMetrics[];
  /** |M₃| + |M₄| + |M₅| raw stored tokens. */
  c_addr: number;
  m3_tokens: number;
  m4_tokens: number;
  m5_tokens: number;
  /** SQLite tier token counts (active/hot/warm/cold/frozen), live rows only. */
  tier_tokens: Record<string, number>;
  compression_ratios: CompressionRatios;
}

/** Level labels. Compression ratios are leftover display until MEM-15. */
export function getMemoryLevelSpecs(ratios?: CompressionRatios): MemoryLevelSpec[] {
  const r = ratios ?? getCompressionRatios();
  return [
    {
      id: "M1",
      name: "sensory",
      knox_label: "Sensory Buffer",
      ratio: 1.0,
      retention: "one turn",
      lifetime: "turn",
      capacity: "buffer",
      role: "buffer",
      in_c_addr: false,
    },
    {
      id: "M2",
      name: "working",
      knox_label: "Working Memory",
      ratio: 0.5,
      retention: "one call",
      lifetime: "call",
      capacity: "buffer",
      role: "buffer",
      in_c_addr: false,
    },
    {
      id: "M3",
      name: "session",
      knox_label: "Session + tree",
      ratio: normalizeCompressionRatio(r.warm),
      retention: "session",
      lifetime: "session",
      capacity: "unbounded",
      role: "store",
      in_c_addr: true,
    },
    {
      id: "M4",
      name: "knowledge",
      knox_label: "Semantic / episodic",
      ratio: normalizeCompressionRatio(r.cold),
      retention: "stored",
      lifetime: "stored",
      capacity: "unbounded",
      role: "store",
      in_c_addr: true,
    },
    {
      id: "M5",
      name: "procedural",
      knox_label: "Recipes",
      ratio: normalizeCompressionRatio(r.frozen),
      retention: "stored",
      lifetime: "stored",
      capacity: "unbounded",
      role: "store",
      in_c_addr: true,
    },
  ];
}

function asTokens(row: { tokens?: number } | undefined): number {
  const n = Number(row?.tokens ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const LIVE = "(tombstoned_at IS NULL OR tombstoned_at = '')";
/** Candidate / verified / quarantined — retired recipes are not M₅. */
const LIVE_RECIPE = "status IN ('candidate', 'verified', 'quarantined')";

async function getSessionAndTreeTokens(): Promise<number> {
  const db = await BrainStore.get();
  const session = await db.get(`
    SELECT SUM(
      CAST((
        LENGTH(COALESCE(title, '')) +
        CASE
          WHEN summary_node_id IS NULL THEN LENGTH(COALESCE(summary, ''))
          ELSE 0
        END
      ) / 4 AS INTEGER)
    ) AS tokens
    FROM brain_sessions
  `);
  const tree = await db.get(`
    SELECT SUM(
      CASE WHEN token_count > 0 THEN token_count
           ELSE CAST(LENGTH(COALESCE(text, '')) / 4 AS INTEGER) END
    ) AS tokens
    FROM brain_summary_tree
    WHERE kind = 'node'
  `);
  return asTokens(session as { tokens?: number }) + asTokens(tree as { tokens?: number });
}

function recipeIndexTokens(title: string, intent: string): number {
  return Math.floor((title.length + intent.length) / 4);
}

async function getLiveKnowledgeTokens(excludeSemanticIds: number[]): Promise<number> {
  const db = await BrainStore.get();
  const exclude =
    excludeSemanticIds.length > 0
      ? `AND id NOT IN (${excludeSemanticIds.map(() => "?").join(",")})`
      : "";
  const semantic = await db.get(
    `
    SELECT SUM(
      CAST((LENGTH(COALESCE(title, '')) + LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(keywords, ''))) / 4 AS INTEGER)
    ) AS tokens
    FROM brain_semantic
    WHERE ${LIVE} ${exclude}
    `,
    excludeSemanticIds,
  );
  const episodic = await db.get(`
    SELECT SUM(
      CASE WHEN token_count > 0 THEN token_count
           ELSE CAST(LENGTH(COALESCE(content, '')) / 4 AS INTEGER) END
    ) AS tokens
    FROM brain_episodic
    WHERE ${LIVE}
  `);
  return asTokens(semantic as { tokens?: number }) + asTokens(episodic as { tokens?: number });
}

function procedureRowTokens(row: {
  name?: string | null;
  description?: string | null;
  steps?: string | null;
  trigger_pattern?: string | null;
}): number {
  return Math.floor(
    (
      String(row.name ?? "").length +
      String(row.description ?? "").length +
      String(row.steps ?? "").length +
      String(row.trigger_pattern ?? "").length
    ) / 4,
  );
}

/** Leftover procedures whose fingerprint a live recipe already owns are not M₅. */
async function getUncoveredProcedureTokens(recipeFingerprints: Set<string>): Promise<number> {
  const db = await BrainStore.get();
  try {
    const rows = (await db.all(
      `SELECT name, description, steps, trigger_pattern FROM brain_procedures`,
    )) as {
      name?: string | null;
      description?: string | null;
      steps?: string | null;
      trigger_pattern?: string | null;
    }[];
    let tokens = 0;
    for (const row of rows) {
      if (
        leftoverCoveredByFingerprints(
          leftoverFingerprints([row.name, row.trigger_pattern, row.description]),
          recipeFingerprints,
        )
      ) {
        continue;
      }
      tokens += procedureRowTokens(row);
    }
    return tokens;
  } catch {
    return 0;
  }
}

interface M5Contribution {
  /** Title/intent **or** live linked workflow, plus uncovered leftover procedures. */
  tokens: number;
  /** Live semantic ids counted in M₅ — exclude them from M₄. */
  linkedWorkflowIds: number[];
}

/**
 * Product M₅ is live recipes. A linked live workflow is the stored handle:
 * count that row once and skip the recipe title/intent. Unlinked or
 * tombstoned links fall back to title/intent. Leftover `brain_procedures`
 * count only when no live recipe owns the same fingerprint (MEM-37).
 */
async function getM5Contribution(): Promise<M5Contribution> {
  const db = await BrainStore.get();
  type RecipeRow = {
    title: string | null;
    intent_text: string | null;
    intent_fingerprint: string | null;
    memory_id: number | null;
  };
  let recipes: RecipeRow[] = [];
  try {
    recipes = (await db.all(`
      SELECT title, intent_text, intent_fingerprint, memory_id
      FROM brain_recipes
      WHERE ${LIVE_RECIPE}
    `)) as RecipeRow[];
  } catch {
    try {
      recipes = (await db.all(`
        SELECT title, intent_text, memory_id
        FROM brain_recipes
        WHERE ${LIVE_RECIPE}
      `)) as RecipeRow[];
    } catch {
      recipes = [];
    }
  }

  const candidateIds = [
    ...new Set(
      recipes
        .map((row) => Math.trunc(Number(row.memory_id)))
        .filter((id) => id > 0),
    ),
  ];

  const liveWorkflowTokens = new Map<number, number>();
  if (candidateIds.length > 0) {
    const rows = (await db.all(
      `
      SELECT id,
        CAST((LENGTH(COALESCE(title, '')) + LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(keywords, ''))) / 4 AS INTEGER) AS tokens
      FROM brain_semantic
      WHERE ${LIVE} AND id IN (${candidateIds.map(() => "?").join(",")})
      `,
      candidateIds,
    )) as { id: number; tokens?: number }[];
    for (const row of rows) {
      const id = Math.trunc(Number(row.id));
      if (id > 0) liveWorkflowTokens.set(id, asTokens(row));
    }
  }

  let recipeOrWorkflow = 0;
  const countedWorkflows = new Set<number>();
  for (const recipe of recipes) {
    const memoryId = Math.trunc(Number(recipe.memory_id));
    if (memoryId > 0 && liveWorkflowTokens.has(memoryId)) {
      if (!countedWorkflows.has(memoryId)) {
        countedWorkflows.add(memoryId);
        recipeOrWorkflow += liveWorkflowTokens.get(memoryId) ?? 0;
      }
    } else {
      recipeOrWorkflow += recipeIndexTokens(recipe.title ?? "", recipe.intent_text ?? "");
    }
  }

  const fingerprints = new Set<string>();
  for (const recipe of recipes) {
    const stored = String(recipe.intent_fingerprint ?? "").trim();
    if (stored) fingerprints.add(stored);
    const derived = leftoverIntentFingerprint(recipe.title, recipe.intent_text);
    if (derived) fingerprints.add(derived);
  }
  return {
    tokens: recipeOrWorkflow + (await getUncoveredProcedureTokens(fingerprints)),
    linkedWorkflowIds: [...countedWorkflows],
  };
}

/**
 * Addressable stored memory: raw |M₃| + |M₄| + |M₅|.
 * `options` only fill M₁ / M₂ **buffer gauges** — they never change `c_addr`.
 */
export async function calculateAddressableMemory(options?: {
  activeSessionId?: string | null;
  workingMemoryTokens?: number;
}): Promise<AddressableMemoryResult> {
  const ratios = getCompressionRatios();
  const tierTokens = await BrainStore.getTierTokenCounts();

  const m5 = await getM5Contribution();
  const m3Tokens = await getSessionAndTreeTokens();
  const m4Tokens = await getLiveKnowledgeTokens(m5.linkedWorkflowIds);
  const m5Tokens = m5.tokens;
  const c_addr = m3Tokens + m4Tokens + m5Tokens;

  const tokenByLevel: Record<MemoryLevelId, number> = {
    M1: SensoryBuffer.estimateBufferedTokens(options?.activeSessionId ?? undefined),
    M2: options?.workingMemoryTokens ?? 0,
    M3: m3Tokens,
    M4: m4Tokens,
    M5: m5Tokens,
  };

  const levels: MemoryLevelMetrics[] = getMemoryLevelSpecs(ratios).map((spec) => {
    const tokens = tokenByLevel[spec.id];
    return {
      id: spec.id,
      name: spec.knox_label,
      tokens,
      ratio: spec.ratio,
      effective_tokens: tokens,
      role: spec.role,
      in_c_addr: spec.in_c_addr,
      lifetime: spec.lifetime,
    };
  });

  return {
    levels,
    c_addr,
    m3_tokens: m3Tokens,
    m4_tokens: m4Tokens,
    m5_tokens: m5Tokens,
    tier_tokens: tierTokens,
    compression_ratios: ratios,
  };
}
