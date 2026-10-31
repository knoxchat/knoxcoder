/**
 * RecipeStore (MC-11): create, dedupe by canonical hash, status transitions.
 *
 * Operates on `brain_recipes` / `brain_recipe_steps` (MC-10). Stores blob
 * hashes and checkpoint ids only, never file bytes. Free text is passed
 * through `redactSecrets` before hashing and storing, so the id describes
 * exactly what is persisted.
 */

import { createHash } from "crypto";

import { redactSecrets } from "../../../util/redactSecrets.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import {
  mergeUserPreconditions,
  sanitizeRecipeNotes,
  sanitizeRecipeTitle,
  sanitizeUserSlots,
} from "./inspector.js";
import { buildFts5Query } from "../brain/RetrievalQuery.js";
import { computeIntentFingerprint } from "./intentFingerprint.js";
import { recipeFtsReady } from "./recipeFts.js";
import type {
  NewRecipeInput,
  Recipe,
  RecipeListFilter,
  RecipeOracle,
  RecipePrecondition,
  RecipeSearchFilter,
  RecipeSlot,
  RecipeStatus,
  RecipeStep,
} from "./types.js";
import { RECIPE_CHANNEL_CANDIDATE_CAP } from "./types.js";

/** Allowed status moves. `retired` is terminal. */
const TRANSITIONS: Record<RecipeStatus, readonly RecipeStatus[]> = {
  candidate: ["verified", "quarantined", "retired"],
  verified: ["quarantined", "retired"],
  // Re-prove from scratch instead of jumping straight back to verified.
  quarantined: ["candidate", "retired"],
  retired: [],
};

export function canTransition(from: RecipeStatus, to: RecipeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class RecipeTransitionError extends Error {
  constructor(
    readonly recipeId: string,
    readonly from: RecipeStatus,
    readonly to: RecipeStatus,
    reason?: string,
  ) {
    super(reason ?? `Illegal recipe transition ${from} -> ${to} (${recipeId})`);
    this.name = "RecipeTransitionError";
  }
}

export type ReplayOutcome = "ok" | "reverted" | "failedVerify";

export interface CreateRecipeResult {
  recipe: Recipe;
  /** false when an identical recipe already existed (returned unchanged). */
  created: boolean;
}

// ── Canonical form ─────────────────────────────────────────────────────────

function cleanStep(step: RecipeStep): Required<RecipeStep> {
  return {
    kind: step.kind,
    path: step.path ?? "",
    blobHash: step.blobHash ?? "",
    baseBlobHash: step.baseBlobHash ?? "",
    checkpointId: step.checkpointId ?? "",
    command: redactSecrets(step.command ?? ""),
  };
}

/**
 * Hash of what makes two recipes "the same work": project, scope, intent
 * fingerprint, slots, preconditions and the ordered steps (by content blob,
 * not by which checkpoint happened to hold it). Oracle, stats, titles and
 * checkpoint ids are excluded so re-capturing the same work dedupes.
 */
export function canonicalRecipeId(input: NewRecipeInput): string {
  const canonical = {
    p: input.projectId ?? "",
    s: input.scope ?? "project",
    f: input.intentFingerprint,
    slots: [...(input.slots ?? [])]
      .map((s) => ({ name: s.name, kind: s.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    pre: [...(input.preconditions ?? [])]
      .map((p) => ({ kind: p.kind, value: p.value }))
      .sort((a, b) => `${a.kind}\0${a.value}`.localeCompare(`${b.kind}\0${b.value}`)),
    steps: input.steps.map((step) => {
      const c = cleanStep(step);
      return { k: c.kind, p: c.path, b: c.blobHash, base: c.baseBlobHash, c: c.command };
    }),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function validate(input: NewRecipeInput): void {
  if (!input.intentFingerprint.trim()) throw new Error("Recipe needs an intentFingerprint");
  if (input.steps.length === 0) throw new Error("Recipe needs at least one step");
  for (const step of input.steps) {
    if (step.kind === "command") {
      if (!step.command?.trim()) throw new Error("Command step needs a command");
    } else {
      if (!step.path) throw new Error(`${step.kind} step needs a path`);
      if (step.kind === "write_file" && !step.blobHash) {
        throw new Error("write_file step needs a blobHash (recipes never store bytes)");
      }
    }
  }
}

// ── Row mapping ────────────────────────────────────────────────────────────

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function optionalCount(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

function rowToRecipe(row: any, stepRows: any[]): Recipe {
  const steps: RecipeStep[] = stepRows.map((s) => ({
    kind: s.kind,
    ...(s.path ? { path: s.path } : {}),
    ...(s.blob_hash ? { blobHash: s.blob_hash } : {}),
    ...(s.base_blob_hash ? { baseBlobHash: s.base_blob_hash } : {}),
    ...(s.checkpoint_id ? { checkpointId: s.checkpoint_id } : {}),
    ...(s.command ? { command: s.command } : {}),
  }));
  const sourceCheckpointIds = [...new Set(steps.map((s) => s.checkpointId).filter((x): x is string => !!x))];
  const hintH = optionalCount(row.helpful_count);
  const hintU = optionalCount(row.unhelpful_count);
  const oracle: RecipeOracle | undefined =
    row.oracle_kind && row.oracle_passed_at
      ? {
          kind: row.oracle_kind,
          passedAt: row.oracle_passed_at,
          ...(row.oracle_command ? { command: row.oracle_command } : {}),
        }
      : undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    status: row.status,
    title: row.title,
    intentText: row.intent_text,
    intentFingerprint: row.intent_fingerprint,
    ...(row.family_id ? { familyId: row.family_id as string } : {}),
    slots: parseJson<RecipeSlot[]>(row.slots, []),
    slotValues: parseJson<Record<string, string>>(row.slot_values, {}),
    preconditions: parseJson<RecipePrecondition[]>(row.preconditions, []),
    steps,
    sourceCheckpointIds,
    ...(oracle ? { oracle } : {}),
    stats: {
      replays: row.replay_count,
      ok: row.ok_count,
      reverted: row.reverted_count,
      failedVerify: row.failed_verify_count,
    },
    captureCount: row.capture_count ?? 1,
    ...(row.user_accepted_at ? { userAcceptedAt: row.user_accepted_at } : {}),
    ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
    ...(row.memory_id != null ? { memoryId: row.memory_id } : {}),
    pinned: Number(row.pinned) === 1,
    notes: typeof row.notes === "string" ? row.notes : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_replayed_at ? { lastReplayedAt: row.last_replayed_at } : {}),
    ...(hintH != null ? { helpfulCount: hintH } : {}),
    ...(hintU != null ? { unhelpfulCount: hintU } : {}),
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

export class RecipeStore {
  constructor(private readonly db: DatabaseConnection) {}

  /** Same sqlite the recipe rows live in. Replay attribution must hit this file. */
  get connection(): DatabaseConnection {
    return this.db;
  }

  /**
   * Insert a `candidate` recipe, or return the existing one when the canonical
   * hash matches (no fields are overwritten, whatever its status: a retired or
   * quarantined recipe is not silently revived by re-capture).
   */
  async create(input: NewRecipeInput): Promise<CreateRecipeResult> {
    validate(input);
    const safe: NewRecipeInput = {
      ...input,
      title: redactSecrets(input.title ?? ""),
      intentText: redactSecrets(input.intentText ?? ""),
      intentFingerprint: redactSecrets(input.intentFingerprint),
    };
    const id = canonicalRecipeId(safe);

    const existing = await this.get(id);
    if (existing) return { recipe: existing, created: false };

    const now = new Date().toISOString();
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = await this.db.run(
        `INSERT OR IGNORE INTO brain_recipes
           (id, project_id, scope, status, title, intent_text, intent_fingerprint, family_id, slots, slot_values, preconditions,
            oracle_kind, oracle_command, oracle_passed_at, source_session_id, memory_id, created_at, updated_at)
         VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          safe.projectId ?? "",
          safe.scope ?? "project",
          safe.title,
          safe.intentText,
          safe.intentFingerprint,
          safe.familyId ?? "",
          JSON.stringify(safe.slots ?? []),
          JSON.stringify(safe.slotValues ?? {}),
          JSON.stringify(safe.preconditions ?? []),
          safe.oracle?.kind ?? "",
          redactSecrets(safe.oracle?.command ?? ""),
          safe.oracle?.passedAt ?? null,
          safe.sourceSessionId ?? null,
          safe.memoryId ?? null,
          now,
          now,
        ],
      );
      if (res.changes) {
        let seq = 0;
        for (const step of safe.steps) {
          const c = cleanStep(step);
          await this.db.run(
            `INSERT INTO brain_recipe_steps
               (recipe_id, seq, kind, path, blob_hash, base_blob_hash, checkpoint_id, command)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, seq++, c.kind, c.path, c.blobHash, c.baseBlobHash, c.checkpointId, c.command],
          );
        }
      }
      await this.db.exec("COMMIT");
    } catch (err) {
      await this.db.exec("ROLLBACK").catch(() => {});
      throw err;
    }

    const recipe = (await this.get(id))!;
    return { recipe, created: true };
  }

  async get(id: string): Promise<Recipe | null> {
    const row = await this.db.get("SELECT * FROM brain_recipes WHERE id = ?", [id]);
    if (!row) return null;
    const steps = await this.db.all("SELECT * FROM brain_recipe_steps WHERE recipe_id = ? ORDER BY seq", [id]);
    return rowToRecipe(row, steps);
  }

  private async hydrate(rows: any[]): Promise<Recipe[]> {
    if (rows.length === 0) return [];
    // One query for every recipe's steps, not one per recipe. Recall pages are
    // the channel cap (50); inventory list is still bounded at 1000.
    const stepRows = await this.db.all(
      `SELECT * FROM brain_recipe_steps WHERE recipe_id IN (${rows.map(() => "?").join(", ")}) ORDER BY recipe_id, seq`,
      rows.map((r) => r.id),
    );
    const byRecipe = new Map<string, any[]>();
    for (const s of stepRows) {
      const list = byRecipe.get(s.recipe_id);
      if (list) list.push(s);
      else byRecipe.set(s.recipe_id, [s]);
    }
    return rows.map((row) => rowToRecipe(row, byRecipe.get(row.id) ?? []));
  }

  private async query(where: string[], params: unknown[], limit: number): Promise<Recipe[]> {
    const rows = await this.db.all(
      `SELECT * FROM brain_recipes ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, id LIMIT ${limit}`,
      params,
    );
    return this.hydrate(rows);
  }

  private listWhere(filter: RecipeListFilter): { where: string[]; params: unknown[] } | null {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId !== undefined) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.intentFingerprint !== undefined) {
      where.push("intent_fingerprint = ?");
      params.push(filter.intentFingerprint);
    }
    if (filter.familyId !== undefined) {
      where.push("family_id = ?");
      params.push(filter.familyId);
    }
    if (filter.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (statuses.length === 0) return null;
      where.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    return { where, params };
  }

  /**
   * Inventory page (dashboard, soak). Recency-ordered, capped at 1000.
   * Not the recall path — use `search` / `searchVisibleTo` (MEM-34).
   * Not Value / disk maintenance — use `listLive` (MEM-35).
   */
  async list(filter: RecipeListFilter = {}): Promise<Recipe[]> {
    const parsed = this.listWhere(filter);
    if (!parsed) return [];
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    return this.query(parsed.where, parsed.params, limit);
  }

  /**
   * All live recipes for Value archive / disk / family pin budget (MEM-35).
   * Uncapped so old unused rows stay visible to `shouldRetireRecipeByValue`.
   */
  async listLive(filter: Omit<RecipeListFilter, "limit"> = {}): Promise<Recipe[]> {
    const parsed = this.listWhere({
      ...filter,
      status: filter.status ?? ["candidate", "verified", "quarantined"],
    });
    if (!parsed) return [];
    return this.query(parsed.where, parsed.params, 1_000_000);
  }

  /**
   * MEM-34: Ω(q) recipe channel. FTS on title/intent/paths, plus exact
   * fingerprint and linked `memory_id`. Never scans the inventory page.
   */
  async search(filter: RecipeSearchFilter = {}): Promise<Recipe[]> {
    const scope = this.searchScope(filter);
    if (!scope) return [];
    return this.searchScoped(scope.where, scope.params, filter);
  }

  /**
   * Project-visible Ω(q): this project's recipes plus promoted global ones.
   */
  async searchVisibleTo(projectId: string, filter: Omit<RecipeSearchFilter, "projectId"> = {}): Promise<Recipe[]> {
    const scope = this.searchScope(filter);
    if (!scope) return [];
    scope.where.unshift("(project_id = ? OR scope = 'global')");
    scope.params.unshift(projectId);
    return this.searchScoped(scope.where, scope.params, filter);
  }

  private searchScope(filter: RecipeSearchFilter): { where: string[]; params: unknown[] } | null {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId !== undefined) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    const statuses = filter.status === undefined
      ? (["candidate", "verified"] as RecipeStatus[])
      : Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
    if (statuses.length === 0) return null;
    where.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
    return { where, params };
  }

  private async searchScoped(
    scopeWhere: string[],
    scopeParams: unknown[],
    filter: RecipeSearchFilter,
  ): Promise<Recipe[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? RECIPE_CHANNEL_CANDIDATE_CAP, RECIPE_CHANNEL_CANDIDATE_CAP));
    const query = (filter.query ?? "").trim();
    const memoryIds = [...new Set((filter.memoryIds ?? []).filter((id) => Number.isFinite(id) && id > 0))];
    const fp = query ? computeIntentFingerprint(query) : { key: "", tokens: [] as string[] };
    const extraOrTerms = [...fp.tokens, ...(filter.mentionedPaths ?? [])];
    const ftsQuery = query ? buildFts5Query(query, { useAnd: false, extraOrTerms }) : null;

    const unions: string[] = [];
    const unionParams: unknown[] = [];

    if (ftsQuery && (await recipeFtsReady(this.db))) {
      unions.push(`
        SELECT lex.recipe_id AS id, -bm25(brain_recipes_fts, 0, 4.0, 3.0, 2.0, 2.0) AS score
          FROM brain_recipes_fts
          JOIN brain_recipe_lex lex ON lex.id = brain_recipes_fts.rowid
         WHERE brain_recipes_fts MATCH ?
      `);
      unionParams.push(ftsQuery);
    }
    if (fp.key) {
      unions.push(`SELECT id, 1.0 AS score FROM brain_recipes WHERE intent_fingerprint = ?`);
      unionParams.push(fp.key);
    }
    if (memoryIds.length > 0) {
      unions.push(
        `SELECT id, 0.5 AS score FROM brain_recipes WHERE memory_id IN (${memoryIds.map(() => "?").join(", ")})`,
      );
      unionParams.push(...memoryIds);
    }
    if (unions.length === 0) return [];

    const scopeSql = scopeWhere.join(" AND ").replace(/\b(project_id|status|scope)\b/g, "r.$1");
    const sql = `
      WITH cand AS (
        ${unions.join(" UNION ALL ")}
      )
      SELECT r.*, MAX(cand.score) AS channel_score
        FROM cand
        JOIN brain_recipes r ON r.id = cand.id
       WHERE ${scopeSql}
       GROUP BY r.id
       ORDER BY channel_score DESC, r.updated_at DESC, r.id
       LIMIT ${limit}
    `;
    try {
      const rows = await this.db.all(sql, [...unionParams, ...scopeParams]);
      return this.hydrate(rows);
    } catch {
      return this.searchWithoutFts(scopeWhere, scopeParams, { fpKey: fp.key, memoryIds, limit });
    }
  }

  private async searchWithoutFts(
    scopeWhere: string[],
    scopeParams: unknown[],
    args: { fpKey: string; memoryIds: number[]; limit: number },
  ): Promise<Recipe[]> {
    const where = [...scopeWhere];
    const params = [...scopeParams];
    const idClauses: string[] = [];
    if (args.fpKey) {
      idClauses.push("intent_fingerprint = ?");
      params.push(args.fpKey);
    }
    if (args.memoryIds.length > 0) {
      idClauses.push(`memory_id IN (${args.memoryIds.map(() => "?").join(", ")})`);
      params.push(...args.memoryIds);
    }
    if (idClauses.length === 0) return [];
    where.push(`(${idClauses.join(" OR ")})`);
    return this.query(where, params, args.limit);
  }

  /**
   * Move a recipe along the state machine. `verified` requires a recorded
   * oracle pass (README rule 1). Returns the updated recipe.
   */
  async transition(id: string, to: RecipeStatus): Promise<Recipe> {
    const current = await this.get(id);
    if (!current) throw new Error(`Recipe not found: ${id}`);
    if (!canTransition(current.status, to)) throw new RecipeTransitionError(id, current.status, to);
    if (to === "verified" && !current.oracle) {
      throw new RecipeTransitionError(id, current.status, to, `Recipe ${id} cannot be verified without an oracle pass`);
    }
    // Compare-and-set so concurrent transitions cannot both succeed.
    const res = await this.db.run(
      "UPDATE brain_recipes SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
      [to, new Date().toISOString(), id, current.status],
    );
    if (!res.changes) throw new RecipeTransitionError(id, current.status, to, `Recipe ${id} changed concurrently`);
    return (await this.get(id))!;
  }

  verify(id: string): Promise<Recipe> {
    return this.transition(id, "verified");
  }
  quarantine(id: string): Promise<Recipe> {
    return this.transition(id, "quarantined");
  }
  retire(id: string): Promise<Recipe> {
    return this.transition(id, "retired");
  }

  /** Record an oracle pass (e.g. a later build/test/user accept). */
  async recordOracle(id: string, oracle: RecipeOracle): Promise<Recipe> {
    const res = await this.db.run(
      `UPDATE brain_recipes SET oracle_kind = ?, oracle_command = ?, oracle_passed_at = ?, updated_at = ?
       WHERE id = ? AND status != 'retired'`,
      [oracle.kind, redactSecrets(oracle.command ?? ""), oracle.passedAt, new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or retired: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * The same work was captured again after a passing oracle. Only live
   * (candidate/verified) recipes count; quarantined and retired ones are not
   * revived by re-capture.
   */
  async recordCapture(id: string, oracle: RecipeOracle): Promise<Recipe> {
    const res = await this.db.run(
      `UPDATE brain_recipes SET capture_count = capture_count + 1, oracle_kind = ?, oracle_command = ?,
         oracle_passed_at = ?, updated_at = ? WHERE id = ? AND status IN ('candidate', 'verified')`,
      [oracle.kind, redactSecrets(oracle.command ?? ""), oracle.passedAt, new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or not live: ${id}`);
    return (await this.get(id))!;
  }

  /** Point the recipe at the semantic memory that describes it (MC-17). */
  async setMemoryId(id: string, memoryId: number | null): Promise<Recipe> {
    const res = await this.db.run("UPDATE brain_recipes SET memory_id = ?, updated_at = ? WHERE id = ?", [
      memoryId,
      new Date().toISOString(),
      id,
    ]);
    if (!res.changes) throw new Error(`Recipe not found: ${id}`);
    return (await this.get(id))!;
  }

  /** The user accepted the diff behind this recipe. Does not change status by itself. */
  async recordUserAccept(id: string, at: Date = new Date()): Promise<Recipe> {
    const res = await this.db.run(
      `UPDATE brain_recipes SET user_accepted_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('candidate', 'verified')`,
      [at.toISOString(), new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or not live: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * Successful captures of this recipe's intent in its project, across live
   * recipes that carry an oracle pass. Quarantined/retired work is not evidence.
   */
  async countIntentSuccesses(recipe: Pick<Recipe, "projectId" | "intentFingerprint" | "familyId">): Promise<number> {
    if (recipe.familyId) {
      const byFamily = await this.db.get<{ n: number | null }>(
        `SELECT SUM(capture_count) AS n FROM brain_recipes
         WHERE project_id = ? AND family_id = ? AND family_id != '' AND status IN ('candidate', 'verified')
           AND oracle_kind != '' AND oracle_passed_at IS NOT NULL`,
        [recipe.projectId, recipe.familyId],
      );
      if (byFamily?.n) return byFamily.n;
    }
    const row = await this.db.get<{ n: number | null }>(
      `SELECT SUM(capture_count) AS n FROM brain_recipes
       WHERE project_id = ? AND intent_fingerprint = ? AND status IN ('candidate', 'verified')
         AND oracle_kind != '' AND oracle_passed_at IS NOT NULL`,
      [recipe.projectId, recipe.intentFingerprint],
    );
    return row?.n ?? 0;
  }

  /**
   * Attach a recipe to a family and persist slots / captured values. Does not
   * change `id` (the snapshot hash) or status.
   */
  async setFamily(
    id: string,
    patch: { familyId: string; slots: RecipeSlot[]; slotValues?: Record<string, string> },
  ): Promise<Recipe> {
    const slots = patch.slots.map((s) => ({
      name: s.name,
      kind: s.kind,
      ...(s.examples?.length ? { examples: s.examples.map((v) => redactSecrets(v)) } : {}),
    }));
    const slotValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.slotValues ?? {})) {
      slotValues[k] = redactSecrets(v);
    }
    const res = await this.db.run(
      `UPDATE brain_recipes SET family_id = ?, slots = ?, slot_values = ?, updated_at = ?
       WHERE id = ? AND status != 'retired'`,
      [patch.familyId, JSON.stringify(slots), JSON.stringify(slotValues), new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or retired: ${id}`);
    return (await this.get(id))!;
  }

  /** Bump replay counters after a replay finished (used by replay/feedback tasks). */
  async recordReplay(id: string, outcome: ReplayOutcome): Promise<Recipe> {
    const column = { ok: "ok_count", reverted: "reverted_count", failedVerify: "failed_verify_count" }[outcome];
    const now = new Date().toISOString();
    const res = await this.db.run(
      `UPDATE brain_recipes SET replay_count = replay_count + 1, ${column} = ${column} + 1,
         last_replayed_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id],
    );
    if (!res.changes) throw new Error(`Recipe not found: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * The user undid a replay that had been counted `ok` (MC-34): the success
   * becomes a revert. Does not add a replay.
   */
  async recordRevert(id: string): Promise<Recipe> {
    const res = await this.db.run(
      `UPDATE brain_recipes SET reverted_count = reverted_count + 1, ok_count = MAX(ok_count - 1, 0),
         updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * Refcount of checkpoint blobs wanted by live recipes (MC-12): one count per
   * step that names the hash (as content or as drift baseline). Retired
   * recipes do not count; candidate, verified and quarantined ones do, since
   * a quarantined recipe can still be re-proved.
   */
  async pinnedBlobRefCounts(): Promise<Map<string, number>> {
    const rows = await this.db.all<{ hash: string; n: number }[]>(
      `SELECT hash, COUNT(*) AS n FROM (
         SELECT s.blob_hash AS hash FROM brain_recipe_steps s
           JOIN brain_recipes r ON r.id = s.recipe_id
           WHERE r.status != 'retired' AND s.blob_hash != ''
         UNION ALL
         SELECT s.base_blob_hash AS hash FROM brain_recipe_steps s
           JOIN brain_recipes r ON r.id = s.recipe_id
           WHERE r.status != 'retired' AND s.base_blob_hash != ''
       ) GROUP BY hash`,
    );
    return new Map(rows.map((r) => [r.hash, r.n]));
  }

  /**
   * P5 inspector: rename, pin, or attach a redacted note. Does not change identity or status.
   */
  async updateInspector(
    id: string,
    patch: { title?: string; notes?: string; pinned?: boolean },
  ): Promise<Recipe> {
    const current = await this.get(id);
    if (!current) throw new Error(`Recipe not found: ${id}`);
    if (current.status === "retired") throw new Error(`Recipe ${id} is retired`);
    const title = patch.title !== undefined ? sanitizeRecipeTitle(patch.title) : current.title;
    const notes = patch.notes !== undefined ? sanitizeRecipeNotes(patch.notes) : (current.notes ?? "");
    const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned ? 1 : 0;
    const res = await this.db.run(
      `UPDATE brain_recipes SET title = ?, notes = ?, pinned = ?, updated_at = ?
       WHERE id = ? AND status != 'retired'`,
      [title, notes, pinned, new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or retired: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * P5.6: replace slots and user-editable preconditions (`file_exists` / `file_absent` /
   * `dependency`). Language/framework checks captured at save time are kept.
   */
  async updateProcedure(
    id: string,
    patch: { slots?: RecipeSlot[]; userPreconditions?: RecipePrecondition[] },
  ): Promise<Recipe> {
    const current = await this.get(id);
    if (!current) throw new Error(`Recipe not found: ${id}`);
    if (current.status === "retired") throw new Error(`Recipe ${id} is retired`);
    const slots = patch.slots !== undefined ? sanitizeUserSlots(patch.slots) : current.slots;
    const preconditions =
      patch.userPreconditions !== undefined
        ? mergeUserPreconditions(current.preconditions, patch.userPreconditions)
        : current.preconditions;
    const res = await this.db.run(
      `UPDATE brain_recipes SET slots = ?, preconditions = ?, updated_at = ?
       WHERE id = ? AND status != 'retired'`,
      [JSON.stringify(slots), JSON.stringify(preconditions), new Date().toISOString(), id],
    );
    if (!res.changes) throw new Error(`Recipe not found or retired: ${id}`);
    return (await this.get(id))!;
  }

  /**
   * MC-53: explicit promotion to `global`. Requires the caller to pass `consent: true` (the user
   * said yes), a verified recipe, and at least one precondition so every other project re-checks
   * something before replay. Demotion back to `project` needs no consent.
   */
  async promoteToGlobal(id: string, opts: { consent: boolean }): Promise<Recipe> {
    if (opts.consent !== true) throw new Error("Promoting a recipe to global scope needs explicit user consent");
    const recipe = await this.get(id);
    if (!recipe) throw new Error(`Recipe not found: ${id}`);
    if (recipe.status !== "verified") throw new Error(`Only verified recipes can become global (${id} is ${recipe.status})`);
    if (recipe.preconditions.length === 0) throw new Error("A global recipe needs at least one precondition");
    await this.db.run("UPDATE brain_recipes SET scope = 'global', updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    return (await this.get(id))!;
  }

  async demoteToProject(id: string): Promise<Recipe> {
    const res = await this.db.run("UPDATE brain_recipes SET scope = 'project', updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      id,
    ]);
    if (!res.changes) throw new Error(`Recipe not found: ${id}`);
    return (await this.get(id))!;
  }

  /** Recipes a project may see: its own, plus promoted global ones. Nothing else. */
  async listVisibleTo(projectId: string, filter: Omit<RecipeListFilter, "projectId"> = {}): Promise<Recipe[]> {
    const parsed = this.listWhere(filter);
    if (!parsed) return [];
    parsed.where.unshift("(project_id = ? OR scope = 'global')");
    parsed.params.unshift(projectId);
    const limit = Math.max(1, Math.min(filter.limit ?? 1000, 1000));
    return this.query(parsed.where, parsed.params, limit);
  }

  /**
   * Merge duplicate recipes (MC-41): the survivor takes the summed counters, the others are retired
   * (which frees their blob pins). The survivor's own status and steps are unchanged. Returns the
   * survivor; ids that are missing or already retired are skipped.
   */
  async absorb(keepId: string, dropIds: readonly string[]): Promise<Recipe> {
    const keep = await this.get(keepId);
    if (!keep) throw new Error(`Recipe not found: ${keepId}`);
    if (keep.status === "retired") throw new Error(`Recipe ${keepId} is retired and cannot absorb others`);
    const sum = { ...keep.stats };
    const dropped: Recipe[] = [];
    for (const id of dropIds) {
      if (id === keepId) continue;
      const r = await this.get(id);
      if (!r || r.status === "retired") continue;
      dropped.push(r);
    }
    for (const r of dropped) {
      sum.replays += r.stats.replays;
      sum.ok += r.stats.ok;
      sum.reverted += r.stats.reverted;
      sum.failedVerify += r.stats.failedVerify;
    }
    for (const r of dropped) await this.retire(r.id);
    await this.db.run(
      `UPDATE brain_recipes SET replay_count = ?, ok_count = ?, reverted_count = ?, failed_verify_count = ?, updated_at = ? WHERE id = ?`,
      [sum.replays, sum.ok, sum.reverted, sum.failedVerify, new Date().toISOString(), keepId],
    );
    return (await this.get(keepId))!;
  }

  /** Hard delete (steps cascade). Prefer `retire` unless wiping. */
  async delete(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM brain_recipe_steps WHERE recipe_id = ?", [id]);
    const res = await this.db.run("DELETE FROM brain_recipes WHERE id = ?", [id]);
    return (res.changes ?? 0) > 0;
  }

  /**
   * Drop retired/quarantined rows older than N days (P2.5). Live recipes keep
   * their stats; this only reclaims ~1 KB leftover rows.
   */
  async purgeStale(opts?: {
    retiredDays?: number;
    quarantinedDays?: number;
  }): Promise<number> {
    const retiredDays = opts?.retiredDays ?? 30;
    const quarantinedDays = opts?.quarantinedDays ?? 90;
    const rows = await this.list({
      status: ["retired", "quarantined"],
      limit: 1000,
    });
    const now = Date.now();
    let n = 0;
    for (const recipe of rows) {
      const age = now - Date.parse(recipe.updatedAt);
      const limitDays = recipe.status === "retired" ? retiredDays : quarantinedDays;
      if (!Number.isFinite(age) || age < limitDays * 86_400_000) {
        continue;
      }
      if (await this.delete(recipe.id)) {
        n += 1;
      }
    }
    return n;
  }
}
