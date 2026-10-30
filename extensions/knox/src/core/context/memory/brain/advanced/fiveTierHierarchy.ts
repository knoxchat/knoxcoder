import { BrainStore } from "../BrainStore.js";
import {
  TIER_R_COLD,
  TIER_R_HOT,
  TIER_R_WARM,
  type StoredMemoryTier,
} from "../Tiers.js";
import { decompressLiveTiers, recomputeMemoryTiers } from "../store/tiers.js";

// ══════════════════════════════════════════════════════════════════════════════
// 23. 5-Tier Memory Hierarchy
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tiers from R and Value only (MEM-15):
 *
 *   1. "active"  — in current session working memory
 *   2. "hot"     — R ≥ 0.9
 *   3. "warm"    — 0.7 ≤ R < 0.9
 *   4. "cold"    — 0.3 ≤ R < 0.7
 *   5. "frozen"  — R < 0.3 or Value < θ_arch
 *
 * Deleted is a tombstone (MEM-06), not a clock prune. `max_age_hours` and the
 * leftover importance/retrieval thresholds are unused for one release.
 */

export type ExtendedMemoryTier = StoredMemoryTier;

export interface TierConfig {
  tier: ExtendedMemoryTier;
  /** Unused leftover clock (MEM-15). */
  max_age_hours: number;
  /** Inclusive lower bound on R for this ranked tier. Active is WM, not R. */
  r_min: number;
  /** Exclusive upper bound on R. Frozen also triggers when Value < θ_arch. */
  r_max: number;
  /** Unused leftover. */
  importance_threshold: number;
  /** Unused leftover. */
  retrieval_threshold: number;
  compress: boolean;
}

const DEFAULT_TIER_CONFIGS: TierConfig[] = [
  { tier: "active",  max_age_hours: 0,    r_min: 0,          r_max: 1,          importance_threshold: 0,   retrieval_threshold: 0,  compress: false },
  { tier: "hot",     max_age_hours: 24,   r_min: TIER_R_HOT, r_max: 1,          importance_threshold: 0.7, retrieval_threshold: 0,  compress: false },
  { tier: "warm",    max_age_hours: 168,  r_min: TIER_R_WARM,r_max: TIER_R_HOT, importance_threshold: 0.5, retrieval_threshold: 2,  compress: false },
  { tier: "cold",    max_age_hours: 2160, r_min: TIER_R_COLD,r_max: TIER_R_WARM,importance_threshold: 0.3, retrieval_threshold: 3,  compress: true },
  { tier: "frozen",  max_age_hours: 8760, r_min: 0,          r_max: TIER_R_COLD,importance_threshold: 0.1, retrieval_threshold: 5,  compress: true },
];

export class FiveTierHierarchy {
  private static configs: TierConfig[] = [...DEFAULT_TIER_CONFIGS];

  static getConfigs(): TierConfig[] {
    return FiveTierHierarchy.configs.map((c) => ({ ...c }));
  }

  static updateConfig(tier: ExtendedMemoryTier, update: Partial<Omit<TierConfig, "tier">>): void {
    const cfg = FiveTierHierarchy.configs.find((c) => c.tier === tier);
    if (cfg) Object.assign(cfg, update);
  }

  /**
   * Recompute every live leaf from R and Value. Does not tombstone.
   */
  static async consolidate(): Promise<{
    promoted: number;
    demoted: number;
    pruned: number;
    compressed: number;
  }> {
    const tiers = await recomputeMemoryTiers();
    const compressed = await BrainStore.writeCompressionPointers(["cold", "frozen"]);
    if (tiers.promoted > 0) {
      await decompressLiveTiers();
    }

    return {
      promoted: tiers.promoted,
      demoted: tiers.demoted,
      pruned: 0,
      compressed,
    };
  }

  /**
   * Get tier distribution counts.
   */
  static async getTierDistribution(): Promise<Record<ExtendedMemoryTier, { semantic: number; episodic: number }>> {
    const db = await BrainStore.get();

    const semRows = await db.all(
      `SELECT tier, COUNT(*) as c FROM brain_semantic GROUP BY tier`,
    );
    const epRows = await db.all(
      `SELECT tier, COUNT(*) as c FROM brain_episodic GROUP BY tier`,
    );

    const dist: Record<string, { semantic: number; episodic: number }> = {
      active: { semantic: 0, episodic: 0 },
      hot: { semantic: 0, episodic: 0 },
      warm: { semantic: 0, episodic: 0 },
      cold: { semantic: 0, episodic: 0 },
      frozen: { semantic: 0, episodic: 0 },
    };

    for (const r of semRows) {
      const tier = (r as any).tier;
      if (dist[tier]) dist[tier].semantic = (r as any).c;
    }
    for (const r of epRows) {
      const tier = (r as any).tier;
      if (dist[tier]) dist[tier].episodic = (r as any).c;
    }

    return dist as Record<ExtendedMemoryTier, { semantic: number; episodic: number }>;
  }
}
