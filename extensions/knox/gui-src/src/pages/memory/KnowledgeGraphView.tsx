import React, { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Compass, X, Loader2, ArrowRight } from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";

interface GraphEntity {
  id: number;
  name: string;
  entity_type: string;
  description: string | null;
  mention_count: number;
  created_at: string;
}

interface GraphEdge {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship: string;
  weight: number;
}

interface ExploreResult {
  center: GraphEntity;
  entities: GraphEntity[];
  edges: GraphEdge[];
  depth_reached: number;
  entity_depths?: Record<number, number>;
  activation_scores?: Record<number, number>;
}

interface GraphStatsData {
  total_entities: number;
  total_edges: number;
  entity_types: Record<string, number>;
  max_entities?: number;
  cap_utilization?: number;
  at_cap?: boolean;
  max_depth?: number;
  depth_decay_gamma?: number;
}

const TYPE_COLORS: Record<string, string> = {
  technology: "#3b82f6",
  framework: "#8b5cf6",
  library: "#6366f1",
  language: "#ec4899",
  tool: "#f59e0b",
  concept: "#10b981",
  person: "#f97316",
  project: "#06b6d4",
  file: "#84cc16",
  service: "#14b8a6",
  api: "#a855f7",
  database: "#ef4444",
  default: "#6b7280",
};

export function KnowledgeGraphView() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [exploreResult, setExploreResult] = useState<ExploreResult | null>(null);
  const [exploringId, setExploringId] = useState<number | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStatsData | null>(null);
  const [filterType, setFilterType] = useState("all");

  const loadEntities = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ideMessenger.request("brain/searchEntities", {
        query: searchQuery || "*",
        limit: 50,
      });
      if (result.status === "success") {
        const content = result.content as any;
        setEntities(Array.isArray(content?.entities) ? content.entities : []);
      }
    } catch (e) {
      console.error("Failed to load entities:", e);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, ideMessenger]);

  const loadStats = useCallback(async () => {
    try {
      const result = await ideMessenger.request("brain/graphStats", undefined);
      if (result.status === "success") {
        setGraphStats(result.content as GraphStatsData);
      }
    } catch {}
  }, [ideMessenger]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    const timeout = setTimeout(loadEntities, 300);
    return () => clearTimeout(timeout);
  }, [loadEntities]);

  const exploreEntity = async (entityId: number) => {
    setExploringId(entityId);
    try {
      const result = await ideMessenger.request("brain/exploreGraph", {
        entity_id: entityId,
        depth: graphStats?.max_depth ?? 3,
      });
      if (result.status === "success") {
        const content = result.content as any;
        setExploreResult(content?.result ?? content);
      }
    } catch (e) {
      console.error("Explore failed:", e);
    } finally {
      setExploringId(null);
    }
  };

  const filteredEntities = filterType === "all"
    ? entities
    : entities.filter((e) => e.entity_type === filterType);

  const entityTypes = [...new Set(entities.map((e) => e.entity_type).filter(Boolean))];

  return (
    <div className="space-y-4 py-4">
      {/* Graph Stats Summary */}
      {graphStats && (
        <>
        <div className="grid grid-cols-3 gap-3">
          <div
            className="rounded-lg border p-3 text-center"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <div className="text-lg font-bold" style={{ color: "#159994" }}>
              {graphStats.max_entities
                ? `${graphStats.total_entities}/${graphStats.max_entities}`
                : graphStats.total_entities}
            </div>
            <div className="text-xs opacity-60">{t("memoryEntities")}</div>
          </div>
          <div
            className="rounded-lg border p-3 text-center"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <div className="text-lg font-bold" style={{ color: "#159994" }}>
              {graphStats.total_edges ?? 0}
            </div>
            <div className="text-xs opacity-60">{t("memoryEdges")}</div>
          </div>
          <div
            className="rounded-lg border p-3 text-center"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <div className="text-lg font-bold" style={{ color: "#159994" }}>
              {entityTypes.length}
            </div>
            <div className="text-xs opacity-60">{t("memoryEntityTypesCount")}</div>
          </div>
        </div>
        {(graphStats.max_entities ?? 0) > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs opacity-70">
              <span>{t("memoryGraphCapUtilization")}</span>
              <span>
                {((graphStats.cap_utilization ?? 0) * 100).toFixed(1)}%
                {graphStats.at_cap && (
                  <span className="ml-1" style={{ color: "#f59e0b" }}>{t("memoryGraphAtCap")}</span>
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
            <p className="text-[10px] opacity-50">
              {t("memoryGraphSpreadingHint", {
                depth: graphStats.max_depth ?? 3,
                gamma: graphStats.depth_decay_gamma ?? 0.7,
              })}
            </p>
          </div>
        )}
        </>
      )}

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("memorySearchEntities")}
            className="w-full rounded border py-1.5 pl-7 pr-2 text-sm"
            style={{
              backgroundColor: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              borderColor: "var(--vscode-input-border)",
            }}
          />
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-50" />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded border px-2 py-1 text-xs"
          style={{
            backgroundColor: "var(--vscode-dropdown-background)",
            color: "var(--vscode-dropdown-foreground)",
            borderColor: "var(--vscode-dropdown-border)",
          }}
        >
          <option value="all">{t("memoryAllTypes")}</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      {/* Explore Panel */}
      {exploreResult && (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "#159994",
            backgroundColor: "rgba(21, 153, 148, 0.05)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Compass size={14} />
              {t("memoryExploring")}: {exploreResult.center.name}
              <span className="text-xs opacity-50">
                ({t("memoryGraphDepth", { count: exploreResult.depth_reached })})
              </span>
            </h3>
            <button
              onClick={() => setExploreResult(null)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              <X size={12} /> {t("memoryClose")}
            </button>
          </div>

          {/* Visual Node Map */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* Center node */}
            <div
              className="rounded-full px-3 py-1 text-xs font-bold"
              style={{
                backgroundColor: TYPE_COLORS[exploreResult.center.entity_type] || TYPE_COLORS.default,
                color: "#fff",
              }}
            >
              {exploreResult.center.name}
            </div>
            {exploreResult.edges.length > 0 && (
              <ArrowRight size={10} className="opacity-40" />
            )}
            {/* Connected nodes with relationship labels */}
            {exploreResult.edges.map((edge, i) => {
              const connected = exploreResult.entities.find(
                (e) =>
                  e.id === (edge.source_entity_id === exploreResult.center.id
                    ? edge.target_entity_id
                    : edge.source_entity_id),
              );
              if (!connected) return null;
              return (
                <div key={i} className="flex items-center gap-1">
                  <span
                    className="rounded px-1 py-0.5 text-xs italic opacity-60"
                  >
                    {edge.relationship}
                  </span>
                  <div
                    className="cursor-pointer rounded-full px-2 py-0.5 text-xs transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: `${TYPE_COLORS[connected.entity_type] || TYPE_COLORS.default}30`,
                      color: TYPE_COLORS[connected.entity_type] || TYPE_COLORS.default,
                      border: `1px solid ${TYPE_COLORS[connected.entity_type] || TYPE_COLORS.default}50`,
                    }}
                    onClick={() => exploreEntity(connected.id)}
                  >
                    {connected.name}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Description */}
          {exploreResult.center.description && (
            <p className="text-xs opacity-70">{exploreResult.center.description}</p>
          )}

          <div className="mt-2 text-xs opacity-50">
            {exploreResult.entities.length} {t("memoryConnectedEntities")} · {exploreResult.edges.length} {t("memoryRelationships")}
          </div>
        </div>
      )}

      {/* Entity Type Legend */}
      {entityTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entityTypes.map((type) => (
            <span
              key={type}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: `${TYPE_COLORS[type] || TYPE_COLORS.default}15`,
                color: TYPE_COLORS[type] || TYPE_COLORS.default,
                border: `1px solid ${TYPE_COLORS[type] || TYPE_COLORS.default}30`,
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[type] || TYPE_COLORS.default }}
              />
              {type}
              <span className="opacity-60">
                ({entities.filter((e) => e.entity_type === type).length})
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Entity List */}
      {loading ? (
        <div className="py-8 text-center">
          <div
            className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "#159994", borderTopColor: "transparent" }}
          />
        </div>
      ) : filteredEntities.length === 0 ? (
        <div className="py-8 text-center text-sm opacity-50">
          {searchQuery ? t("memoryNoEntitiesFound") : t("memoryNoEntitiesYet")}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntities.map((entity) => (
            <div
              key={entity.id}
              className="group flex items-center gap-3 rounded-lg border p-2.5 transition-all hover:border-opacity-70"
              style={{ borderColor: "var(--vscode-panel-border)" }}
            >
              {/* Type indicator */}
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{
                  backgroundColor: `${TYPE_COLORS[entity.entity_type] || TYPE_COLORS.default}20`,
                  color: TYPE_COLORS[entity.entity_type] || TYPE_COLORS.default,
                }}
              >
                {entity.entity_type[0]?.toUpperCase() || "?"}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{entity.name}</span>
                  <span
                    className="shrink-0 rounded px-1 py-0.5 text-xs"
                    style={{
                      backgroundColor: `${TYPE_COLORS[entity.entity_type] || TYPE_COLORS.default}15`,
                      color: TYPE_COLORS[entity.entity_type] || TYPE_COLORS.default,
                    }}
                  >
                    {entity.entity_type}
                  </span>
                </div>
                {entity.description && (
                  <p className="mt-0.5 truncate text-xs opacity-60">{entity.description}</p>
                )}
                <div className="mt-0.5 flex items-center gap-3 text-xs opacity-40">
                  <span>{t("memoryEntityMentions")}: {entity.mention_count}</span>
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={() => exploreEntity(entity.id)}
                disabled={exploringId === entity.id}
                className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                }}
              >
                {exploringId === entity.id ? <Loader2 size={12} className="animate-spin" /> : <Compass size={12} />} {t("memoryExplore")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
