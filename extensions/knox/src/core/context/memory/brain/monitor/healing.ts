import { BrainStore } from "../BrainStore.js";
import { RetrievalFusion } from "../RetrievalFusion.js";
import {
  checkStoreInvariants,
  getInvariantSnapshot,
} from "../invariants.js";
import type { HealthStatus } from "../types.js";
import type { HealingAction, HealingResult, HealingStrategy } from "../PerformanceMonitor.js";

// ── Healing Actions Library ─────────────────────────────────────────────────

export class HealingEngine {
  private strategyStats: Map<HealingAction, HealingStrategy> = new Map();

  /**
   * Run a specific healing action with impact measurement.
   */
  async runAction(action: HealingAction): Promise<HealingResult> {
    const start = performance.now();
    let success = false;
    let details = "";
    let impact = 0;

    // Measure health before
    const healthBefore = await BrainStore.getHealth();

    try {
      switch (action) {
        case "vacuum": {
          const db = await BrainStore.get();
          await db.exec("VACUUM");
          details = "Database compacted via VACUUM";
          success = true;
          break;
        }
        case "reindex": {
          const db = await BrainStore.get();
          await db.exec("REINDEX");
          await db.exec("ANALYZE");
          details = "Indexes rebuilt and statistics updated";
          success = true;
          break;
        }
        case "rebalance_tiers": {
          const result = await HealingEngine.rebalanceTiers();
          details = result;
          success = true;
          break;
        }
        case "clear_stale_sessions": {
          const result = await HealingEngine.clearStaleSessions();
          details = result;
          success = true;
          break;
        }
        case "purge_orphan_associations": {
          const result = await HealingEngine.purgeOrphanAssociations();
          details = result;
          success = true;
          break;
        }
        case "compress_cold": {
          const compressed = await BrainStore.compressColdTier();
          details = `Compressed ${compressed} cold-tier memories`;
          success = true;
          break;
        }
        case "prune_expired": {
          const result = await HealingEngine.pruneExpired();
          details = result;
          success = true;
          break;
        }
        case "repair_counts": {
          const result = await HealingEngine.repairCounts();
          details = result;
          success = true;
          break;
        }
        case "defragment_graph": {
          const result = await HealingEngine.defragmentGraph();
          details = result;
          success = true;
          break;
        }
        case "prune_missing_checkpoints": {
          const pruned = await BrainStore.pruneMissingCheckpointSnapshots();
          details = `Removed ${pruned} checkpoint row${pruned === 1 ? "" : "s"} with missing snapshot files`;
          success = true;
          break;
        }
        case "check_invariants": {
          let report = await checkStoreInvariants({ audit: true });
          let repaired = false;
          if (!report.reachability.met || report.reachability.missing_fts > 0) {
            const db = await BrainStore.get();
            await RetrievalFusion.rebuildFts5(db);
            repaired = true;
            report = await checkStoreInvariants({ audit: true });
          }
          const budget = getInvariantSnapshot().budget;
          const budgetNote = budget.checked
            ? ` last Budget: ${budget.met ? "met" : "failed"} (|C(q)|=${budget.c_use} W=${budget.w})`
            : "";
          details =
            `Reachability: ${report.reachability.met ? "met" : "failed"} ` +
            `(live=${report.reachability.live}, missing=${report.reachability.missing}, ` +
            `fts_gaps=${report.reachability.missing_fts}); ` +
            `Losslessness: ${report.losslessness.met ? "met" : "failed"} ` +
            `(leaves=${report.losslessness.leaves}, dangling=${report.losslessness.dangling})` +
            `${repaired ? "; FTS rebuilt" : ""}.${budgetNote}`;
          success = report.met;
          break;
        }
      }

      // Measure health after and compute impact
      const healthAfter = await BrainStore.getHealth();
      const beforeIssues = healthBefore.issues.length;
      const afterIssues = healthAfter.issues.length;
      impact = beforeIssues > 0 ? Math.max(0, (beforeIssues - afterIssues) / beforeIssues) : 0.1;
      // Fragmentation improvement bonus
      if (healthAfter.fragmentation_ratio < healthBefore.fragmentation_ratio) {
        impact = Math.min(1, impact + (healthBefore.fragmentation_ratio - healthAfter.fragmentation_ratio));
      }
    } catch (err: any) {
      details = `Failed: ${err?.message ?? String(err)}`;
    }

    const duration_ms = performance.now() - start;
    const result: HealingResult = { action, success, duration_ms, details, impact };

    // Update strategy stats
    this.recordStrategy(action, success, impact, duration_ms);

    return result;
  }

  /**
   * Auto-heal: run the most effective healing strategies based on current health.
   * Returns all results.
   */
  async autoHeal(health: HealthStatus): Promise<HealingResult[]> {
    const actions = this.selectActions(health);
    const results: HealingResult[] = [];
    for (const action of actions) {
      results.push(await this.runAction(action));
    }
    return results;
  }

  /**
   * Select healing actions based on health issues and adaptive strategy ranking.
   */
  private selectActions(health: HealthStatus): HealingAction[] {
    const actions: Array<{ action: HealingAction; priority: number }> = [];

    // Map issues to candidate actions
    for (const issue of health.issues) {
      const lower = issue.toLowerCase();
      if (lower.includes("fragmentation")) {
        actions.push({ action: "vacuum", priority: 10 });
      }
      if (lower.includes("hot memories") || lower.includes("too many")) {
        actions.push({ action: "rebalance_tiers", priority: 9 });
      }
      if (lower.includes("haven't been accessed")) {
        actions.push({ action: "prune_expired", priority: 7 });
        actions.push({ action: "clear_stale_sessions", priority: 6 });
      }
      if (lower.includes("exceeds") || lower.includes("100mb")) {
        actions.push({ action: "compress_cold", priority: 8 });
        actions.push({ action: "vacuum", priority: 7 });
      }
      if (lower.includes("checkpoint snapshot")) {
        actions.push({ action: "prune_missing_checkpoints", priority: 9 });
      }
      if (lower.includes("reachability") || lower.includes("losslessness")) {
        actions.push({ action: "check_invariants", priority: 10 });
      }
    }

    // Always consider low-cost maintenance
    if (actions.length === 0) {
      actions.push({ action: "purge_orphan_associations", priority: 3 });
      actions.push({ action: "repair_counts", priority: 2 });
    }

    // Sort by adaptive effectiveness, then by priority
    actions.sort((a, b) => {
      const effA = this.getEffectiveness(a.action);
      const effB = this.getEffectiveness(b.action);
      // Weight effectiveness 60%, priority 40%
      const scoreA = effA * 0.6 + (a.priority / 10) * 0.4;
      const scoreB = effB * 0.6 + (b.priority / 10) * 0.4;
      return scoreB - scoreA;
    });

    // Deduplicate and take top 3
    const seen = new Set<HealingAction>();
    const selected: HealingAction[] = [];
    for (const a of actions) {
      if (!seen.has(a.action)) {
        seen.add(a.action);
        selected.push(a.action);
        if (selected.length >= 3) break;
      }
    }

    return selected;
  }

  /**
   * Get the adaptive effectiveness score for an action (0.0–1.0).
   */
  private getEffectiveness(action: HealingAction): number {
    const stats = this.strategyStats.get(action);
    if (!stats || stats.total_runs === 0) return 0.5; // default for untried
    return stats.effectiveness;
  }

  /**
   * Record outcome of a healing strategy for adaptive learning.
   */
  private recordStrategy(action: HealingAction, success: boolean, impact: number, duration_ms: number): void {
    const existing = this.strategyStats.get(action) ?? {
      action,
      total_runs: 0,
      success_count: 0,
      avg_impact: 0,
      avg_duration_ms: 0,
      last_run_at: 0,
      effectiveness: 0.5,
    };

    existing.total_runs++;
    if (success) existing.success_count++;

    // Running averages
    existing.avg_impact = ((existing.avg_impact * (existing.total_runs - 1)) + impact) / existing.total_runs;
    existing.avg_duration_ms = ((existing.avg_duration_ms * (existing.total_runs - 1)) + duration_ms) / existing.total_runs;
    existing.last_run_at = Date.now();

    // Compute effectiveness: success_rate * avg_impact
    const successRate = existing.success_count / existing.total_runs;
    existing.effectiveness = successRate * existing.avg_impact;

    this.strategyStats.set(action, existing);
  }

  /**
   * Get all strategy statistics (for adaptive strategy selection visibility).
   */
  getStrategies(): HealingStrategy[] {
    return Array.from(this.strategyStats.values()).sort((a, b) => b.effectiveness - a.effectiveness);
  }

  // ── Individual Healing Actions ─────────────────────────────────────────────

  private static async rebalanceTiers(): Promise<string> {
    const db = await BrainStore.get();
    let moved = 0;

    // Force-demote excess hot episodic (keep only last 200 hot)
    const excess = await db.run(
      `UPDATE brain_episodic SET tier = 'warm'
       WHERE tier = 'hot' AND id NOT IN (
         SELECT id FROM brain_episodic WHERE tier = 'hot'
         ORDER BY importance_score DESC, created_at DESC LIMIT 200
       )`,
    );
    moved += excess.changes ?? 0;

    // Force-demote excess hot semantic (keep only top 100 by importance)
    const semExcess = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'hot' AND id NOT IN (
         SELECT id FROM brain_semantic WHERE tier = 'hot'
         ORDER BY importance_score DESC, retrieval_count DESC LIMIT 100
       )`,
    );
    moved += semExcess.changes ?? 0;

    return `Rebalanced tiers: moved ${moved} memories from hot to warm`;
  }

  private static async clearStaleSessions(): Promise<string> {
    const db = await BrainStore.get();

    // Find sessions with no activity in 90+ days and no summary
    const stale = await db.run(
      `UPDATE brain_sessions SET is_active = 0
       WHERE is_active = 1
       AND updated_at < datetime('now', '-90 days')`,
    );

    return `Deactivated ${stale.changes ?? 0} stale sessions`;
  }

  private static async purgeOrphanAssociations(): Promise<string> {
    const db = await BrainStore.get();

    // Delete associations pointing to non-existent memories
    const orphanedSemantic = await db.run(
      `DELETE FROM brain_associations
       WHERE (source_type = 'semantic' AND source_id NOT IN (SELECT id FROM brain_semantic))
       OR (target_type = 'semantic' AND target_id NOT IN (SELECT id FROM brain_semantic))`,
    );

    const orphanedEpisodic = await db.run(
      `DELETE FROM brain_associations
       WHERE (source_type = 'episodic' AND source_id NOT IN (SELECT id FROM brain_episodic))
       OR (target_type = 'episodic' AND target_id NOT IN (SELECT id FROM brain_episodic))`,
    );

    const total = (orphanedSemantic.changes ?? 0) + (orphanedEpisodic.changes ?? 0);
    return `Purged ${total} orphan associations`;
  }

  private static async pruneExpired(): Promise<string> {
    const n = await BrainStore.forgetExpiredTtl();
    return `Tombstoned ${n} expired semantic memories`;
  }

  private static async repairCounts(): Promise<string> {
    const db = await BrainStore.get();

    // Fix session message counts
    const fixed = await db.run(
      `UPDATE brain_sessions SET message_count = (
        SELECT COUNT(*) FROM brain_episodic WHERE brain_episodic.session_id = brain_sessions.id
      ) WHERE message_count != (
        SELECT COUNT(*) FROM brain_episodic WHERE brain_episodic.session_id = brain_sessions.id
      )`,
    );

    // Fix entity mention counts
    const entityFixed = await db.run(
      `UPDATE brain_entities SET mention_count = GREATEST(mention_count, 1)
       WHERE mention_count < 1`,
    );

    return `Repaired ${(fixed.changes ?? 0) + (entityFixed.changes ?? 0)} count mismatches`;
  }

  private static async defragmentGraph(): Promise<string> {
    const db = await BrainStore.get();

    // Remove duplicate edges (same source/target/relationship)
    const dupes = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE id NOT IN (
         SELECT MIN(id) FROM brain_graph_edges
         GROUP BY source_entity_id, target_entity_id, relationship
       )`,
    );

    // Remove self-referential edges
    const selfRef = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE source_entity_id = target_entity_id`,
    );

    // Remove edges pointing to deleted entities
    const orphanEdges = await db.run(
      `DELETE FROM brain_graph_edges
       WHERE source_entity_id NOT IN (SELECT id FROM brain_entities)
       OR target_entity_id NOT IN (SELECT id FROM brain_entities)`,
    );

    const total = (dupes.changes ?? 0) + (selfRef.changes ?? 0) + (orphanEdges.changes ?? 0);
    return `Graph defragmented: removed ${total} invalid edges`;
  }
}
