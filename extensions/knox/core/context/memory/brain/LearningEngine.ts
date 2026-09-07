import { BrainStore } from "./BrainStore.js";
import type {
  LearningPattern,
  GoalType,
  LearnPatternInput,
  PatternSuggestion,
} from "./types.js";

/**
 * LearningEngine — Pattern learning & suggestion for the Memory Brain.
 *
 * Mirrors Knox-MS learning system:
 * - Record success/failure patterns for different goal types
 * - Jaccard similarity for pattern matching
 * - Confidence decay over time (0.95 factor)
 * - Min 3 successful uses before suggesting a pattern
 * - UCB1-inspired selection for exploration vs exploitation
 *
 * Goal types match Knox-MS classification:
 *   coding, analysis, research, creative, debugging,
 *   documentation, explanation, planning, conversation, other
 */
export class LearningEngine {
  // ── Pattern Recording ──────────────────────────────────────────────────────

  /**
   * Record a pattern observation (success or failure).
   * If pattern_signature already exists for the goal_type, update its stats.
   */
  static async learnPattern(input: LearnPatternInput): Promise<number> {
    const existing = await BrainStore.findPattern(input.goal_type, input.pattern_signature);

    if (existing) {
      await BrainStore.updatePatternStats(
        existing.id,
        input.success,
        input.tokens_used ?? 0,
      );
      return existing.id;
    }

    return BrainStore.addPattern({
      goal_type: input.goal_type,
      pattern_signature: input.pattern_signature,
      description: input.description,
      success: input.success,
      tokens_used: input.tokens_used ?? 0,
      metadata: input.metadata ?? {},
    });
  }

  /**
   * Get learned patterns, optionally filtered by goal type.
   */
  static async getPatterns(goalType?: GoalType, limit = 20): Promise<LearningPattern[]> {
    return BrainStore.getPatterns(goalType, limit);
  }

  // ── Suggestion Engine ──────────────────────────────────────────────────────

  /**
   * Suggest approaches based on learned patterns.
   * Uses Jaccard similarity to match the query against known pattern signatures.
   * Only suggests patterns with >= 3 successes and confidence >= 0.5.
   *
   * @param query - Description of the current goal
   * @param goalType - Optional goal classification for filtering
   * @param limit - Max suggestions to return
   */
  static async suggestApproach(
    query: string,
    goalType?: GoalType,
    limit: number = 5,
  ): Promise<PatternSuggestion[]> {
    const patterns = await BrainStore.getPatterns(goalType, 100);

    // Filter to patterns with minimum success threshold
    const qualified = patterns.filter(
      (p) => p.success_count >= 3 && p.confidence >= 0.5,
    );

    if (qualified.length === 0) {
      return [];
    }

    const queryTokens = LearningEngine.tokenize(query);

    const scored: PatternSuggestion[] = qualified.map((pattern) => {
      const patternTokens = LearningEngine.tokenize(
        pattern.pattern_signature + " " + pattern.description,
      );
      const jaccardSim = LearningEngine.jaccardSimilarity(queryTokens, patternTokens);

      // UCB1-inspired score: exploitation (confidence) + exploration (less-used patterns)
      const totalUses = pattern.success_count + pattern.failure_count;
      const explorationBonus = Math.sqrt(Math.log(totalUses + 1) / (totalUses + 1)) * 0.1;

      // Age decay: prefer recently used patterns
      const daysSinceUsed = (Date.now() - new Date(pattern.last_used_at).getTime()) / 86400000;
      const ageDecay = Math.pow(0.95, Math.min(daysSinceUsed, 90));

      const relevanceScore = jaccardSim * 0.5 + pattern.confidence * 0.3 + ageDecay * 0.1 + explorationBonus;

      return {
        pattern,
        relevance_score: relevanceScore,
        reason: LearningEngine.generateReason(pattern, jaccardSim),
      };
    });

    return scored
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit);
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  static formatPatternList(patterns: LearningPattern[]): string {
    if (patterns.length === 0) return "No learning patterns recorded yet.";
    const parts = [`Learning Patterns (${patterns.length}):`];
    for (const p of patterns) {
      const winRate = p.success_count + p.failure_count > 0
        ? ((p.success_count / (p.success_count + p.failure_count)) * 100).toFixed(0)
        : "N/A";
      parts.push(`  [#${p.id}] [${p.goal_type}] ${p.pattern_signature}`);
      parts.push(`    ${p.description}`);
      parts.push(`    Success: ${p.success_count} | Failures: ${p.failure_count} | Win rate: ${winRate}% | Confidence: ${p.confidence.toFixed(2)}`);
      parts.push(`    Avg tokens: ${p.avg_tokens_used.toFixed(0)} | Last used: ${p.last_used_at}`);
    }
    return parts.join("\n");
  }

  static formatSuggestions(suggestions: PatternSuggestion[]): string {
    if (suggestions.length === 0) return "No pattern suggestions available. Build more experience by using learn_pattern to record successful approaches.";
    const parts = [`Approach Suggestions (${suggestions.length}):`];
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      parts.push(`  ${i + 1}. [${s.pattern.goal_type}] ${s.pattern.pattern_signature} (relevance: ${s.relevance_score.toFixed(2)})`);
      parts.push(`     ${s.pattern.description}`);
      parts.push(`     ${s.reason}`);
    }
    return parts.join("\n");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  }

  private static jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const token of a) {
      if (b.has(token)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private static generateReason(pattern: LearningPattern, similarity: number): string {
    const parts: string[] = [];
    if (similarity > 0.5) {
      parts.push("High similarity to your goal.");
    } else if (similarity > 0.2) {
      parts.push("Moderate similarity to your goal.");
    }

    if (pattern.confidence > 0.8) {
      parts.push(`Very reliable pattern (${(pattern.confidence * 100).toFixed(0)}% confidence).`);
    }

    const winRate = pattern.success_count / Math.max(1, pattern.success_count + pattern.failure_count);
    parts.push(`Win rate: ${(winRate * 100).toFixed(0)}% across ${pattern.success_count + pattern.failure_count} uses.`);

    if (pattern.avg_tokens_used > 0) {
      parts.push(`Avg cost: ~${pattern.avg_tokens_used.toFixed(0)} tokens.`);
    }

    return parts.join(" ");
  }
}
