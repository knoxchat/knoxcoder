import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  FileText,
  Link,
  Globe,
  RefreshCw,
  BarChart3,
  ClipboardList,
  HardDrive,
  FolderOpen,
  Tag,
  AlertTriangle,
  Lightbulb,
  MessageSquare,
  Zap,
  Loader2,
  Target,
  Star,
  Wrench,
  Ruler,
  FileIcon,
  ArrowRight,
  Layers,
  Minimize2,
  Compass,
} from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";

interface EffectiveContextData {
  active_window_tokens: number;
  context_max_tokens?: number;
  last_context_tokens_used?: number;
  last_context_max_tokens?: number;
  window_utilization?: number;
  tier_tokens: Record<string, number>;
  hierarchy_effective_tokens: number;
  memory_levels?: Array<{
    id: string;
    name: string;
    tokens: number;
    ratio: number;
    effective_tokens: number;
  }>;
  working_memory_tokens?: number;
  working_memory_budget?: number;
  sensory_buffer_tokens?: number;
  sensory_buffer_ms?: number;
  graph_entity_count: number;
  graph_max_entities?: number;
  graph_max_depth?: number;
  graph_depth_decay_gamma?: number;
  graph_cap_utilization?: number;
  total_effective: number;
  compression_ratios: Record<string, number>;
  memory_tokens_saved?: number;
  last_compression_tokens_saved?: number;
  compression_events?: number;
}

interface DashboardData {
  stats: {
    total_sessions: number;
    total_episodic: number;
    total_semantic: number;
    total_associations: number;
    total_entities: number;
    total_edges: number;
    total_patterns: number;
    total_procedures: number;
    total_tags: number;
    total_collections: number;
    tier_counts: { hot: number; warm: number; cold: number };
    category_counts: Record<string, number>;
    entity_type_counts: Record<string, number>;
    oldest_memory: string | null;
    newest_memory: string | null;
    db_size_bytes: number;
  } | null;
  health: {
    status: string;
    db_size_bytes: number;
    total_memories: number;
    fragmentation_ratio: number;
    oldest_unaccessed_days: number;
    issues: string[];
    recommendations: string[];
  } | null;
  graphStats: {
    total_entities: number;
    total_edges: number;
    entity_types: Record<string, number>;
    entity_type_counts?: Record<string, number>;
    max_entities?: number;
    cap_utilization?: number;
    at_cap?: boolean;
    max_depth?: number;
    depth_decay_gamma?: number;
  } | null;
  sessions: any[];
  healthScore: { overall: number; grade: string; score?: number; dimensions?: Record<string, number> } | null;
  consolidation: {
    total_runs: number;
    last_run_at: string | null;
    last_run?: string | null;
    avg_duration_ms: number;
    last_duration_ms?: number;
    last_sub_phases?: Record<string, number> | null;
  } | null;
}

interface MetricsTrendData {
  snapshots: Array<{
    id: number;
    timestamp: string;
    avg_response_ms: number;
    success_rate: number;
    db_size_bytes: number;
    memory_count: number;
    memory_tokens_saved?: number;
    hierarchy_effective_tokens?: number;
    total_effective?: number;
  }>;
  period_hours: number;
  avg_response_trend: "improving" | "stable" | "degrading";
  success_rate_trend: "improving" | "stable" | "degrading";
  growth_rate_trend: "stable" | "growing" | "shrinking" | "accelerating";
  compression_trend?: "improving" | "stable" | "degrading";
  effective_context_trend?: "improving" | "stable" | "degrading";
}

const TREND_COLORS: Record<string, string> = {
  improving: "#22c55e",
  stable: "#6b7280",
  degrading: "#ef4444",
  growing: "#3b82f6",
  shrinking: "#f59e0b",
  accelerating: "#8b5cf6",
};

const SLEEP_PHASE_LABELS: Record<string, string> = {
  nrem_replay: "NREM Replay",
  nrem_decay_demoted: "NREM Decay (demoted)",
  nrem_decay_pruned: "NREM Decay (pruned)",
  nrem_compress: "NREM Compress",
  rem_distill: "REM Distill",
  graph_strengthen: "Graph Strengthen",
  promote: "Promote",
};

/** Part III φ₁–φ₈ memory cycle phase labels. */
const MEMORY_CYCLE_PHASES: Array<{ id: string; labelKey: string }> = [
  { id: "sensory_input", labelKey: "memoryPhaseSensory" },
  { id: "encoding", labelKey: "memoryPhaseEncoding" },
  { id: "working_memory", labelKey: "memoryPhaseWorking" },
  { id: "consolidation", labelKey: "memoryPhaseConsolidation" },
  { id: "long_term_storage", labelKey: "memoryPhaseLongTerm" },
  { id: "retrieval", labelKey: "memoryPhaseRetrieval" },
  { id: "sleep_consolidation", labelKey: "memoryPhaseSleep" },
  { id: "output_generation", labelKey: "memoryPhaseOutput" },
];

interface MemoryPhaseStatusData {
  active_phase: string | null;
  last_completed: { phase: string; at: number } | null;
  phase_counts: Record<string, number>;
  cycle_invariant_met: boolean;
  background_sleep_active: boolean;
}

interface ReviewDueItem {
  memory_id: number;
  category: string;
  title: string;
  current_retention: number;
  strength: number;
  retrieval_count: number;
  overdue: boolean;
  days_until_review: number;
}

interface EbbinghausStatsData {
  config: {
    lambda: number;
    pruneThreshold: number;
    strengtheningAlpha: number;
    repetitionBeta: number;
  };
  review_due_count: number;
  avg_retention: number;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  critical: "#ef4444",
};

const TIER_COLORS: Record<string, string> = {
  hot: "#ef4444",
  warm: "#f59e0b",
  cold: "#3b82f6",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  insight: <Lightbulb size={14} />,
  decision: <Target size={14} />,
  preference: <Star size={14} />,
  error_fix: <Wrench size={14} />,
  code_pattern: <Ruler size={14} />,
  project_context: <FolderOpen size={14} />,
  general: <FileText size={14} />,
  convention: <Ruler size={14} />,
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTimeAgo(dateStr: string | null, t: (key: string, opts?: any) => string): string {
  if (!dateStr) return t("memoryTimeNever");
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("memoryTimeJustNow");
  if (minutes < 60) return t("memoryTimeMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("memoryTimeHoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("memoryTimeDaysAgo", { count: days });
}

export function MemoryOverview() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);
  const [data, setData] = useState<DashboardData | null>(null);
  const [effectiveContext, setEffectiveContext] = useState<EffectiveContextData | null>(null);
  const [metricsTrend, setMetricsTrend] = useState<MetricsTrendData | null>(null);
  const [phaseStatus, setPhaseStatus] = useState<MemoryPhaseStatusData | null>(null);
  const [reviewDue, setReviewDue] = useState<ReviewDueItem[]>([]);
  const [ebbinghausStats, setEbbinghausStats] = useState<EbbinghausStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [consolidating, setConsolidating] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [result, effectiveResult, trendResult, phaseResult, reviewResult, ebbResult] =
        await Promise.all([
        ideMessenger.request("brain/dashboard", undefined),
        ideMessenger.request("brain/getEffectiveContext", undefined),
        ideMessenger.request("brain/getMetricsTrend", { hours: 24 }),
        ideMessenger.request("brain/getPhaseStatus", undefined),
        ideMessenger.request("brain/getReviewDue", { limit: 8 }),
        ideMessenger.request("brain/getEbbinghausStats", undefined),
      ]);
      if (result.status === "success") {
        setData(result.content as unknown as DashboardData);
      }
      if (effectiveResult.status === "success") {
        setEffectiveContext(effectiveResult.content as EffectiveContextData);
      }
      if (trendResult.status === "success") {
        setMetricsTrend(trendResult.content as MetricsTrendData);
      }
      if (phaseResult.status === "success") {
        setPhaseStatus(phaseResult.content as MemoryPhaseStatusData);
      }
      if (reviewResult.status === "success") {
        const content = reviewResult.content as { items?: ReviewDueItem[] };
        setReviewDue(Array.isArray(content?.items) ? content.items : []);
      }
      if (ebbResult.status === "success") {
        setEbbinghausStats(ebbResult.content as EbbinghausStatsData);
      }
    } catch (e) {
      console.error("Failed to load dashboard:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      await ideMessenger.request("brain/consolidate", undefined);
      await loadDashboard();
    } finally {
      setConsolidating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "#159994", borderTopColor: "transparent" }}
          />
          <span className="text-sm opacity-60">{t("memoryLoadingDashboard")}</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Brain size={28} style={{ color: "#159994" }} />
          <p className="mt-2 text-sm opacity-60">{t("memoryNoData")}</p>
          <button
            onClick={loadDashboard}
            className="mt-3 rounded px-3 py-1 text-xs"
            style={{
              backgroundColor: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            {t("memoryRetry")}
          </button>
        </div>
      </div>
    );
  }

  const { stats: rawStats, health: rawHealth, graphStats, sessions, healthScore, consolidation } = data;

  // Provide safe defaults for null data
  const stats = rawStats ?? {
    total_sessions: 0, total_episodic: 0, total_semantic: 0, total_associations: 0,
    total_entities: 0, total_edges: 0, total_patterns: 0, total_procedures: 0,
    total_tags: 0, total_collections: 0,
    tier_counts: { hot: 0, warm: 0, cold: 0 },
    category_counts: {}, entity_type_counts: {},
    oldest_memory: null, newest_memory: null, db_size_bytes: 0,
  };
  const health = rawHealth ?? {
    status: "healthy", db_size_bytes: 0, total_memories: 0,
    fragmentation_ratio: 0, oldest_unaccessed_days: 0,
    issues: [], recommendations: [],
  };
  const totalMemories = stats.total_episodic + stats.total_semantic;
  const tierTotal = stats.tier_counts.hot + stats.tier_counts.warm + stats.tier_counts.cold;
  const healthScoreValue = healthScore?.overall ?? healthScore?.score ?? 0;

  return (
    <div className="space-y-4 py-4">
      {/* Health Banner */}
      <div
        className="flex items-center justify-between rounded-lg border p-3"
        style={{
          borderColor: STATUS_COLORS[health.status] || "#6b7280",
          backgroundColor: `${STATUS_COLORS[health.status] || "#6b7280"}10`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
            style={{
              backgroundColor: STATUS_COLORS[health.status] || "#6b7280",
              color: "#fff",
            }}
          >
            {healthScore?.grade || health.status[0].toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold capitalize">
              {t("memorySystemStatus")}: {health.status}
            </div>
            <div className="text-xs opacity-70">
              {healthScore
                ? `${t("memoryHealthScore")}: ${healthScoreValue}/100`
                : `${totalMemories.toLocaleString()} ${t("memoryTotalMemories")}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            <RefreshCw size={12} /> {t("memoryRefresh")}
          </button>
          <button
            onClick={handleConsolidate}
            disabled={consolidating}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{
              backgroundColor: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            {consolidating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} {t("memoryConsolidate")}
          </button>
        </div>
      </div>

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Brain size={20} />} label={t("memorySemantic")} value={stats.total_semantic} />
        <StatCard icon={<FileText size={20} />} label={t("memoryEpisodic")} value={stats.total_episodic} />
        <StatCard icon={<Link size={20} />} label={t("memoryEntities")} value={stats.total_entities} />
        <StatCard icon={<Globe size={20} />} label={t("memorySessions")} value={stats.total_sessions} />
        <StatCard icon={<RefreshCw size={20} />} label={t("memoryEdges")} value={stats.total_edges} />
        <StatCard icon={<BarChart3 size={20} />} label={t("memoryPatterns")} value={stats.total_patterns} />
        <StatCard icon={<ClipboardList size={20} />} label={t("memoryProcedures")} value={stats.total_procedures} />
        <StatCard icon={<HardDrive size={20} />} label={t("memoryDbSize")} value={formatBytes(stats.db_size_bytes)} />
      </div>

      {/* Spaced Repetition / Ebbinghaus (Part IV) */}
      {ebbinghausStats && (
        <SectionCard title={t("memorySpacedRepetition")} icon={<Brain size={14} />}>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                {ebbinghausStats.review_due_count}
              </div>
              <div className="opacity-60">{t("memoryReviewDueCount")}</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                {(ebbinghausStats.avg_retention * 100).toFixed(0)}%
              </div>
              <div className="opacity-60">{t("memoryAvgRetention")}</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                λ={ebbinghausStats.config.lambda}
              </div>
              <div className="opacity-60">{t("memoryDecayRate")}</div>
            </div>
          </div>
          {reviewDue.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-2" style={{ borderColor: "var(--vscode-panel-border)" }}>
              <div className="text-xs font-medium opacity-70 mb-1">{t("memoryReviewDueList")}</div>
              {reviewDue.map((item) => (
                <div key={item.memory_id} className="flex items-center justify-between text-xs opacity-80">
                  <span className="truncate pr-2">
                    {item.overdue && "⚠ "}
                    [{item.category}] {item.title}
                  </span>
                  <span className="shrink-0 font-mono">
                    R={(item.current_retention * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {reviewDue.length === 0 && (
            <div className="mt-2 text-xs opacity-60">{t("memoryNoReviewDue")}</div>
          )}
        </SectionCard>
      )}

      {/* 8-Phase Memory Cycle (Part III) */}
      {phaseStatus && (
        <SectionCard title={t("memoryCyclePhases")} icon={<RefreshCw size={14} />}>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="opacity-70">
              {phaseStatus.cycle_invariant_met
                ? t("memoryCycleInvariantMet")
                : t("memoryCycleInvariantIdle")}
            </span>
            {phaseStatus.background_sleep_active && (
              <span className="rounded px-1.5 py-0.5 opacity-80" style={{ backgroundColor: "#15999420", color: "#159994" }}>
                φ₇ {t("memoryPhaseSleep")} active
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {MEMORY_CYCLE_PHASES.map(({ id, labelKey }, idx) => {
              const count = phaseStatus.phase_counts[id] ?? 0;
              const isActive = phaseStatus.active_phase === id;
              const isLast = phaseStatus.last_completed?.phase === id;
              return (
                <div
                  key={id}
                  className="flex items-center justify-between rounded border px-2 py-1.5 text-xs"
                  style={{
                    borderColor: isActive || isLast ? "#159994" : "var(--vscode-panel-border)",
                    backgroundColor: isActive ? "#15999415" : undefined,
                  }}
                >
                  <span className="opacity-80">
                    φ{idx + 1} {t(labelKey)}
                  </span>
                  <span className="font-mono opacity-60">{count > 0 ? count : "—"}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Effective Context Capacity (C_effective) — Part VIII–IX */}
      {effectiveContext && (
        <SectionCard title={t("memoryEffectiveContext")} icon={<Layers size={14} />}>
          <p className="mb-3 text-xs opacity-60">{t("memoryEffectiveContextFormula")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<Target size={20} />}
              label={t("memoryActiveWindow")}
              value={effectiveContext.active_window_tokens.toLocaleString()}
            />
            {(effectiveContext.last_context_tokens_used ?? 0) > 0 && (
              <StatCard
                icon={<FileText size={20} />}
                label={t("memoryContextTokensUsed")}
                value={effectiveContext.last_context_tokens_used!.toLocaleString()}
              />
            )}
            <StatCard
              icon={<BarChart3 size={20} />}
              label={t("memoryHierarchyEffective")}
              value={Math.round(effectiveContext.hierarchy_effective_tokens).toLocaleString()}
            />
            <StatCard
              icon={<Link size={20} />}
              label={t("memoryGraphEntities")}
              value={
                effectiveContext.graph_max_entities
                  ? `${effectiveContext.graph_entity_count}/${effectiveContext.graph_max_entities}`
                  : effectiveContext.graph_entity_count
              }
            />
            <StatCard
              icon={<Zap size={20} />}
              label={t("memoryTotalEffective")}
              value={Math.round(effectiveContext.total_effective).toLocaleString()}
            />
            {(effectiveContext.memory_tokens_saved ?? 0) > 0 && (
              <StatCard
                icon={<Minimize2 size={20} />}
                label={t("memoryTokensSaved")}
                value={(effectiveContext.memory_tokens_saved ?? 0).toLocaleString()}
              />
            )}
          </div>
          {(effectiveContext.window_utilization ?? 0) > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>{t("memoryContextUtilization")}</span>
                <span>{((effectiveContext.window_utilization ?? 0) * 100).toFixed(1)}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--vscode-input-background)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (effectiveContext.window_utilization ?? 0) * 100)}%`,
                    backgroundColor: "#159994",
                  }}
                />
              </div>
            </div>
          )}
          {effectiveContext.memory_levels && effectiveContext.memory_levels.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-[color:var(--vscode-panel-border)] pt-3">
              <div className="text-xs font-medium opacity-70 mb-1">M₁–M₅ Hierarchy</div>
              {effectiveContext.memory_levels.map((level) => {
                if (level.tokens === 0 && level.effective_tokens === 0) return null;
                return (
                  <div key={level.id} className="flex items-center justify-between text-xs opacity-80">
                    <span>
                      {level.id} {level.name}
                    </span>
                    <span>
                      {level.tokens.toLocaleString()} / r={level.ratio} →{" "}
                      {Math.round(level.effective_tokens).toLocaleString()}
                    </span>
                  </div>
                );
              })}
              {(effectiveContext.working_memory_budget ?? 0) > 0 && (
                <div className="flex items-center justify-between text-xs opacity-60">
                  <span>M₂ budget cap</span>
                  <span>{effectiveContext.working_memory_budget?.toLocaleString()} tokens</span>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 space-y-1">
            {(["active", "hot", "warm", "cold", "frozen"] as const).map((tier) => {
              const tokens = effectiveContext.tier_tokens[tier] ?? 0;
              const ratio = effectiveContext.compression_ratios[tier] ?? 1;
              if (tokens === 0) return null;
              return (
                <div key={tier} className="flex items-center justify-between text-xs opacity-80">
                  <span className="capitalize">{tier}</span>
                  <span>
                    {tokens.toLocaleString()} tokens / r={ratio} → {Math.round(tokens / ratio).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Knowledge Graph cap & spreading activation (IMP-11) */}
      {graphStats && graphStats.max_entities != null && (
        <SectionCard title={t("memoryKnowledgeGraphCap")} icon={<Link size={14} />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<Link size={20} />}
              label={t("memoryGraphEntities")}
              value={`${graphStats.total_entities}/${graphStats.max_entities}`}
            />
            <StatCard
              icon={<RefreshCw size={20} />}
              label={t("memoryEdges")}
              value={graphStats.total_edges}
            />
            <StatCard
              icon={<Compass size={20} />}
              label={t("memoryGraphBfsDepth")}
              value={graphStats.max_depth ?? 3}
            />
            <StatCard
              icon={<BarChart3 size={20} />}
              label={t("memoryGraphDepthDecayGamma")}
              value={`γ=${graphStats.depth_decay_gamma ?? 0.7}`}
            />
          </div>
          {(graphStats.max_entities ?? 0) > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>{t("memoryGraphCapUtilization")}</span>
                <span>
                  {((graphStats.cap_utilization ?? 0) * 100).toFixed(1)}%
                  {graphStats.at_cap && (
                    <span className="ml-1 text-yellow-500">{t("memoryGraphAtCap")}</span>
                  )}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--vscode-input-background)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (graphStats.cap_utilization ?? 0) * 100)}%`,
                    backgroundColor: graphStats.at_cap ? "#f59e0b" : "#159994",
                  }}
                />
              </div>
              <p className="text-[10px] opacity-50">{t("memoryGraphCapLruHint")}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* Metrics trend (IMP-16) */}
      {metricsTrend && (
        <SectionCard title={t("memoryMetricsTrend")} icon={<BarChart3 size={14} />}>
          {metricsTrend.snapshots.length === 0 ? (
            <p className="text-xs opacity-60">{t("memoryNoMetricsSnapshots")}</p>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {metricsTrend.effective_context_trend && (
              <div>
                <div
                  className="text-lg font-bold capitalize"
                  style={{ color: TREND_COLORS[metricsTrend.effective_context_trend] ?? "#6b7280" }}
                >
                  {metricsTrend.effective_context_trend}
                </div>
                <div className="opacity-60">{t("memoryTrendEffectiveContext")}</div>
                {metricsTrend.snapshots[0] && (
                  <div className="mt-0.5 opacity-50">
                    {Math.round(metricsTrend.snapshots[0].total_effective ?? 0).toLocaleString()}
                  </div>
                )}
              </div>
            )}
            <div>
              <div
                className="text-lg font-bold capitalize"
                style={{ color: TREND_COLORS[metricsTrend.avg_response_trend] ?? "#6b7280" }}
              >
                {metricsTrend.avg_response_trend}
              </div>
              <div className="opacity-60">{t("memoryTrendResponse")}</div>
              {metricsTrend.snapshots[0] && (
                <div className="mt-0.5 opacity-50">
                  {metricsTrend.snapshots[0].avg_response_ms.toFixed(0)}ms
                </div>
              )}
            </div>
            <div>
              <div
                className="text-lg font-bold capitalize"
                style={{ color: TREND_COLORS[metricsTrend.success_rate_trend] ?? "#6b7280" }}
              >
                {metricsTrend.success_rate_trend}
              </div>
              <div className="opacity-60">{t("memoryTrendSuccess")}</div>
              {metricsTrend.snapshots[0] && (
                <div className="mt-0.5 opacity-50">
                  {(metricsTrend.snapshots[0].success_rate * 100).toFixed(1)}%
                </div>
              )}
            </div>
            <div>
              <div
                className="text-lg font-bold capitalize"
                style={{ color: TREND_COLORS[metricsTrend.growth_rate_trend] ?? "#6b7280" }}
              >
                {metricsTrend.growth_rate_trend}
              </div>
              <div className="opacity-60">{t("memoryTrendGrowth")}</div>
              {metricsTrend.snapshots[0] && (
                <div className="mt-0.5 opacity-50">
                  {metricsTrend.snapshots[0].memory_count.toLocaleString()} {t("memoryTotalMemories").toLowerCase()}
                </div>
              )}
            </div>
            {metricsTrend.compression_trend && (
              <div>
                <div
                  className="text-lg font-bold capitalize"
                  style={{ color: TREND_COLORS[metricsTrend.compression_trend] ?? "#6b7280" }}
                >
                  {metricsTrend.compression_trend}
                </div>
                <div className="opacity-60">{t("memoryTrendCompression")}</div>
                {metricsTrend.snapshots[0] && (
                  <div className="mt-0.5 opacity-50">
                    {(metricsTrend.snapshots[0].memory_tokens_saved ?? 0).toLocaleString()} {t("memoryTokensSaved").toLowerCase()}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 text-center text-[10px] opacity-50">
            {t("memoryTrendPeriod", {
              hours: metricsTrend.period_hours,
              count: metricsTrend.snapshots.length,
            })}
          </div>
          </>
          )}
        </SectionCard>
      )}

      {/* Tier Distribution */}
      <SectionCard title={t("memoryTierDistribution")} icon={<BarChart3 size={14} />}>
        <div className="space-y-2">
          {(["hot", "warm", "cold"] as const).map((tier) => {
            const count = stats.tier_counts[tier];
            const pct = tierTotal > 0 ? (count / tierTotal) * 100 : 0;
            return (
              <div key={tier} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: TIER_COLORS[tier] }}
                    />
                    <span className="capitalize font-medium">{t(`memoryTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}` as any)}</span>
                  </span>
                  <span className="opacity-70">
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--vscode-input-background)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: TIER_COLORS[tier],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Two columns: Categories + Entity Types */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Category Breakdown */}
        <SectionCard title={t("memoryCategoryBreakdown")} icon={<FolderOpen size={14} />}>
          <div className="space-y-1.5">
            {Object.entries(stats.category_counts)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span>{CATEGORY_ICONS[cat] || <FileIcon size={14} />}</span>
                    <span className="capitalize">{cat.replace(/_/g, " ")}</span>
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--vscode-badge-background)",
                      color: "var(--vscode-badge-foreground)",
                    }}
                  >
                    {count}
                  </span>
                </div>
              ))}
            {Object.keys(stats.category_counts).length === 0 && (
              <span className="text-xs opacity-50">{t("memoryNoCategoriesYet")}</span>
            )}
          </div>
        </SectionCard>

        {/* Entity Types */}
        <SectionCard title={t("memoryEntityTypes")} icon={<Tag size={14} />}>
          <div className="space-y-1.5">
            {Object.entries(stats.entity_type_counts)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div key={type} className="flex items-center justify-between text-xs">
                  <span className="capitalize">{type.replace(/_/g, " ")}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--vscode-badge-background)",
                      color: "var(--vscode-badge-foreground)",
                    }}
                  >
                    {count}
                  </span>
                </div>
              ))}
            {Object.keys(stats.entity_type_counts).length === 0 && (
              <span className="text-xs opacity-50">{t("memoryNoEntitiesYet")}</span>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Health Details */}
      {health.issues.length > 0 && (
        <SectionCard title={t("memoryHealthIssues")} icon={<AlertTriangle size={14} />}>
          <div className="space-y-1">
            {health.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-yellow-400" />
                <span className="opacity-80">{issue}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {health.recommendations.length > 0 && (
        <SectionCard title={t("memoryRecommendations")} icon={<Lightbulb size={14} />}>
          <div className="space-y-1">
            {health.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <ArrowRight size={12} className="mt-0.5 shrink-0" style={{ color: "#159994" }} />
                <span className="opacity-80">{rec}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Recent Sessions */}
      <SectionCard title={t("memoryRecentSessions")} icon={<MessageSquare size={14} />}>
        {sessions.length === 0 ? (
          <span className="text-xs opacity-50">{t("memoryNoSessionsYet")}</span>
        ) : (
          <div className="space-y-1.5">
            {sessions.slice(0, 5).map((session: any) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded border px-2.5 py-1.5 text-xs"
                style={{ borderColor: "var(--vscode-panel-border)" }}
              >
                <div className="flex-1 truncate">
                  <span className="font-medium">{session.title || session.id}</span>
                  <span className="ml-2 opacity-50">
                    {session.message_count != null ? t("memoryMsgs", { count: session.message_count }) : t("memoryMsgsUnknown")}
                  </span>
                </div>
                <span className="shrink-0 opacity-50">
                  {formatTimeAgo(session.updated_at || session.created_at, t)}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Consolidation Stats */}
      {consolidation && (
        <SectionCard title={t("memoryConsolidationStats")} icon={<Zap size={14} />}>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                {consolidation.total_runs}
              </div>
              <div className="opacity-60">{t("memoryTotalRuns")}</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                {(consolidation.last_run_at || consolidation.last_run)
                  ? formatTimeAgo(consolidation.last_run_at || consolidation.last_run || null, t)
                  : "—"}
              </div>
              <div className="opacity-60">{t("memoryLastRun")}</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: "#159994" }}>
                {consolidation.avg_duration_ms > 0
                  ? `${consolidation.avg_duration_ms.toFixed(0)}ms`
                  : "—"}
              </div>
              <div className="opacity-60">{t("memoryAvgDuration")}</div>
            </div>
          </div>
          {consolidation.last_sub_phases && (
            <div className="mt-3 space-y-1 border-t pt-2" style={{ borderColor: "var(--vscode-panel-border)" }}>
              {Object.entries(consolidation.last_sub_phases)
                .filter(([, count]) => count > 0)
                .map(([key, count]) => (
                  <div key={key} className="flex items-center justify-between text-xs opacity-80">
                    <span>{SLEEP_PHASE_LABELS[key] ?? key}</span>
                    <span>{count}</span>
                  </div>
                ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Timeline */}
      <div
        className="flex items-center justify-between rounded border px-3 py-2 text-xs"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <span className="opacity-60">
          {t("memoryOldest")}: {formatTimeAgo(stats.oldest_memory, t)}
        </span>
        <span className="opacity-60">
          {t("memoryNewest")}: {formatTimeAgo(stats.newest_memory, t)}
        </span>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors hover:border-opacity-70"
      style={{ borderColor: "var(--vscode-panel-border)" }}
    >
      <span className="flex items-center justify-center" style={{ color: "#159994" }}>{icon}</span>
      <span className="text-lg font-bold" style={{ color: "#159994" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-xs opacity-60">{label}</span>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--vscode-panel-border)" }}
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
