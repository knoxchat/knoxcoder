import React, { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Settings,
  Package,
  Search,
  Wrench,
  Zap,
  RefreshCw,
  Upload,
  HeartPulse,
  AlertTriangle,
  Trash2,
  Loader2,
  Check,
  X,
  FileDown,
  ChevronDown,
  ChevronRight,
  Brain,
  Layers,
  SlidersHorizontal,
  Timer,
  Crosshair,
} from "lucide-react";

import { IdeMessengerContext } from "../../context/IdeMessenger";

/** Must match core MEMORY_CONTEXT_TOKEN_CEILING (types.ts). */
const MEMORY_CONTEXT_TOKEN_CEILING = 10_000_000;

// Keys must match core MemoryConfig (core/context/memory/brain/types.ts) —
// brain/updateConfig only applies known keys to the runtime config.
interface MemoryConfig {
  auto_extract_enabled: boolean;
  consolidation_interval_hours: number;
  max_hot_memories: number;
  max_episodic_per_session: number;
  context_max_tokens: number;
  max_context_tokens: number;
  context_goal_budget_ratio: number;
  memory_mode: "full" | "summarized" | "selective";
  retrieval_threshold: number;
  retrieval_top_k: number;
  retrieval_require_lexical: boolean;
  retrieval_continuation_expand: boolean;
  fts5_use_and_for_content: boolean;
  topic_shift_jaccard: number;
  wm_mismatch_decay: number;
  wm_inject_min_relevance: number;
  summary_inject_min_overlap: number;
  pinned_unmatched_cap: number;
  graph_max_entities: number;
  graph_max_depth: number;
  memory_scope: "project" | "global";
  auto_summarize: boolean;
  summarize_threshold: number;
  enable_knowledge_extraction: boolean;
  post_turn_min_chars: number;
  hot_to_warm_hours: number;
  warm_to_cold_days: number;
  cold_prune_days: number;
  graph_enabled: boolean;
  learning_enabled: boolean;
  llm_entity_extraction_enabled: boolean;
  llm_summarization_enabled: boolean;
  llm_importance_scoring_enabled: boolean;
  llm_post_action_memory_enabled: boolean;
  working_memory_max_slots: number;
  working_memory_token_budget: number;
  working_memory_token_ratio: number;
  working_memory_decay_rate: number;
  working_memory_ttl_seconds: number;
  easy_model: string;
  medium_model: string;
  hard_model: string;
  autonomous_max_iterations: number;
  mode_full_semantic_multiplier: number;
  mode_full_episodic_multiplier: number;
  mode_full_min_importance: number;
  mode_full_episodic_snippet_len: number;
  mode_summarized_semantic_multiplier: number;
  mode_summarized_episodic_multiplier: number;
  mode_summarized_min_importance: number;
  mode_summarized_episodic_snippet_len: number;
  mode_selective_semantic_multiplier: number;
  mode_selective_episodic_multiplier: number;
  mode_selective_min_importance: number;
  mode_selective_episodic_snippet_len: number;
  mode_selective_include_episodic: boolean;
  mode_selective_include_procedures: boolean;
  mode_selective_include_patterns: boolean;
  context_graph_entity_search: number;
  context_graph_entity_display: number;
  context_graph_edge_per_entity: number;
  context_graph_edge_budget_ratio: number;
  context_procedure_limit: number;
  context_pattern_limit: number;
  context_pinned_limit: number;
  context_session_summary_min_tokens: number;
  context_line_truncate_chars: number;
  context_line_compress_chars: number;
  context_compress_keep_lines: number;
  budget_semantic_ratio: number;
  budget_episodic_ratio: number;
  budget_graph_ratio: number;
  budget_procedures_ratio: number;
  budget_patterns_ratio: number;
  fusion_candidate_multiplier: number;
  fusion_candidate_min: number;
  graph_depth_decay_gamma: number;
  graph_memory_boost_factor: number;
  graph_entity_search_limit: number;
  graph_neighbor_limit: number;
  recency_decay_lambda: number;
  compression_ratio_active: number;
  compression_ratio_hot: number;
  compression_ratio_warm: number;
  compression_ratio_cold: number;
  compression_ratio_frozen: number;
  memory_build_timeout_ms: number;
  memory_track_session_timeout_ms: number;
  ebbinghaus_base_strength: number;
  ebbinghaus_lambda: number;
  ebbinghaus_prune_threshold: number;
  ebbinghaus_review_threshold: number;
  ebbinghaus_strengthening_alpha: number;
  ebbinghaus_repetition_beta: number;
  ebbinghaus_salience_weight: number;
  ebbinghaus_importance_weight: number;
  sensory_buffer_ms: number;
  enable_enhanced_semantic: boolean;
}

const DEFAULT_CONFIG: MemoryConfig = {
  auto_extract_enabled: true,
  consolidation_interval_hours: 24,
  max_hot_memories: 500,
  max_episodic_per_session: 1000,
  context_max_tokens: MEMORY_CONTEXT_TOKEN_CEILING,
  max_context_tokens: MEMORY_CONTEXT_TOKEN_CEILING,
  context_goal_budget_ratio: 0.1,
  memory_mode: "summarized",
  retrieval_threshold: 0.6,
  retrieval_top_k: 20,
  retrieval_require_lexical: true,
  retrieval_continuation_expand: true,
  fts5_use_and_for_content: true,
  topic_shift_jaccard: 0.35,
  wm_mismatch_decay: 0.25,
  wm_inject_min_relevance: 0.35,
  summary_inject_min_overlap: 0.2,
  pinned_unmatched_cap: 2,
  graph_max_entities: 5000,
  graph_max_depth: 3,
  memory_scope: "project",
  auto_summarize: true,
  summarize_threshold: 50,
  enable_knowledge_extraction: true,
  post_turn_min_chars: 80,
  hot_to_warm_hours: 24,
  warm_to_cold_days: 7,
  cold_prune_days: 90,
  graph_enabled: true,
  learning_enabled: true,
  llm_entity_extraction_enabled: true,
  llm_summarization_enabled: true,
  llm_importance_scoring_enabled: true,
  llm_post_action_memory_enabled: true,
  working_memory_max_slots: 7,
  working_memory_token_budget: 30000,
  working_memory_token_ratio: 0.125,
  working_memory_decay_rate: 0.001,
  working_memory_ttl_seconds: 30,
  easy_model: "",
  medium_model: "",
  hard_model: "",
  autonomous_max_iterations: 0,
  mode_full_semantic_multiplier: 1.25,
  mode_full_episodic_multiplier: 2.0,
  mode_full_min_importance: 0,
  mode_full_episodic_snippet_len: 400,
  mode_summarized_semantic_multiplier: 0.75,
  mode_summarized_episodic_multiplier: 0.75,
  mode_summarized_min_importance: 0.3,
  mode_summarized_episodic_snippet_len: 150,
  mode_selective_semantic_multiplier: 0.5,
  mode_selective_episodic_multiplier: 0.25,
  mode_selective_min_importance: 0.7,
  mode_selective_episodic_snippet_len: 200,
  mode_selective_include_episodic: false,
  mode_selective_include_procedures: false,
  mode_selective_include_patterns: false,
  context_graph_entity_search: 10,
  context_graph_entity_display: 5,
  context_graph_edge_per_entity: 3,
  context_graph_edge_budget_ratio: 0.7,
  context_procedure_limit: 5,
  context_pattern_limit: 3,
  context_pinned_limit: 10,
  context_session_summary_min_tokens: 200,
  context_line_truncate_chars: 300,
  context_line_compress_chars: 200,
  context_compress_keep_lines: 3,
  budget_semantic_ratio: 0.40,
  budget_episodic_ratio: 0.25,
  budget_graph_ratio: 0.15,
  budget_procedures_ratio: 0.10,
  budget_patterns_ratio: 0.10,
  fusion_candidate_multiplier: 5,
  fusion_candidate_min: 50,
  graph_depth_decay_gamma: 0.7,
  graph_memory_boost_factor: 0.3,
  graph_entity_search_limit: 5,
  graph_neighbor_limit: 10,
  recency_decay_lambda: 0.004125,
  compression_ratio_active: 1.0,
  compression_ratio_hot: 0.5,
  compression_ratio_warm: 0.2,
  compression_ratio_cold: 0.1,
  compression_ratio_frozen: 0.05,
  memory_build_timeout_ms: 5000,
  memory_track_session_timeout_ms: 1500,
  ebbinghaus_base_strength: 1.0,
  ebbinghaus_lambda: 0.03,
  ebbinghaus_prune_threshold: 0.1,
  ebbinghaus_review_threshold: 0.5,
  ebbinghaus_strengthening_alpha: 0.1,
  ebbinghaus_repetition_beta: 0.1,
  ebbinghaus_salience_weight: 0.5,
  ebbinghaus_importance_weight: 0.3,
  sensory_buffer_ms: 250,
  enable_enhanced_semantic: false,
};

export function MemorySettings() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [config, setConfig] = useState<MemoryConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [healthAction, setHealthAction] = useState("");
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; label: string; description: string } | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const result = await ideMessenger.request("brain/getConfig", undefined);
      if (result.status === "success") {
        const config = (result.content as any)?.config;
        if (config) {
          setConfig({ ...DEFAULT_CONFIG, ...config });
        }
      }
    } catch {}
    setLoading(false);
  };

  const saveConfig = async (key: string, value: any) => {
    setSaving(true);
    try {
      await ideMessenger.request("brain/updateConfig", {
        key,
        value: String(value),
      });
      setSavedMessage(key);
      setTimeout(() => setSavedMessage(""), 2000);
    } catch {}
    setSaving(false);
  };

  const updateField = (key: keyof MemoryConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    saveConfig(key, value);
  };

  const runAction = async (action: string, _label: string) => {
    setHealthAction(action);
    setActionResult(null);
    try {
      let resultMsg = "";
      if (action === "optimize") {
        const r = await ideMessenger.request("brain/optimize", undefined);
        resultMsg = r.status === "success" ? ((r.content as any)?.message ?? t("memoryActionSuccess")) : t("memoryActionFailed");
      } else if (action === "consolidate") {
        const r = await ideMessenger.request("brain/consolidate", undefined);
        const result = r.status === "success" ? (r.content as any)?.result : null;
        if (result) {
          const parts: string[] = [];
          if (result.promoted > 0) parts.push(`${result.promoted} promoted`);
          if (result.demoted > 0) parts.push(`${result.demoted} demoted`);
          if (result.pruned > 0) parts.push(`${result.pruned} pruned`);
          if (result.merged > 0) parts.push(`${result.merged} merged`);
          resultMsg = parts.length > 0
            ? t("memoryConsolidateResult") + ": " + parts.join(", ")
            : t("memoryConsolidateNoChanges");
        } else {
          resultMsg = t("memoryActionSuccess");
        }
      } else if (action === "heal") {
        const r = await ideMessenger.request("brain/heal", undefined);
        resultMsg = r.status === "success" ? t("memoryActionSuccess") : t("memoryActionFailed");
      } else if (action === "prune_expired") {
        const r = await ideMessenger.request("brain/heal", { action: "prune_expired" });
        resultMsg = r.status === "success" ? t("memoryActionSuccess") : t("memoryActionFailed");
      } else {
        await ideMessenger.request("brain/dispatch", { action: action as any });
        resultMsg = t("memoryActionSuccess");
      }
      setActionResult({ type: "success", message: resultMsg });
      setTimeout(() => setActionResult(null), 5000);
    } catch (e) {
      setActionResult({ type: "error", message: t("memoryActionFailed") });
      setTimeout(() => setActionResult(null), 5000);
    }
    setHealthAction("");
  };

  const confirmAndRun = (action: string, label: string, description: string) => {
    setConfirmDialog({ action, label, description });
  };

  const handleConfirm = () => {
    if (confirmDialog) {
      runAction(confirmDialog.action, confirmDialog.label);
      setConfirmDialog(null);
    }
  };

  const handleExport = async () => {
    setHealthAction("export");
    setActionResult(null);
    try {
      const password = exportPassword.trim() || undefined;
      const result = await ideMessenger.request("brain/export", {
        password,
      });
      if (result.status === "success") {
        const content = result.content as any;
        const data = content?.data ?? "";
        const filePath = content?.filePath ?? "";
        const encrypted = !!content?.encrypted;

        await navigator.clipboard.writeText(data);

        const sizeKb = (data.length / 1024).toFixed(1);
        const base = filePath
          ? `${t("memoryExportSuccess")} (${sizeKb} KB) → ${filePath}`
          : `${t("memoryExportCopied")} (${sizeKb} KB)`;
        setActionResult({
          type: "success",
          message: encrypted
            ? `${base} · ${t("memoryExportEncrypted")}`
            : `${base} · ${t("memoryExportLocalOnly")}`,
        });
        setExportPassword("");
        setTimeout(() => setActionResult(null), 8000);
      } else {
        setActionResult({ type: "error", message: t("memoryActionFailed") });
        setTimeout(() => setActionResult(null), 5000);
      }
    } catch {
      setActionResult({ type: "error", message: t("memoryActionFailed") });
      setTimeout(() => setActionResult(null), 5000);
    }
    setHealthAction("");
  };

  const handleImportFile = async (file: File) => {
    setHealthAction("import");
    setActionResult(null);
    try {
      const textContent = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(textContent);
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.version) {
        setActionResult({ type: "error", message: t("memoryImportInvalidFile") });
        setTimeout(() => setActionResult(null), 5000);
        setHealthAction("");
        return;
      }
      const isEncrypted = parsed.version === "knox-brain-encrypted-v1";
      if (isEncrypted && !importPassword.trim()) {
        setActionResult({
          type: "error",
          message: t("memoryImportPasswordRequired"),
        });
        setTimeout(() => setActionResult(null), 5000);
        setHealthAction("");
        return;
      }
      const result = await ideMessenger.request("brain/import", {
        data: textContent,
        password: importPassword.trim() || undefined,
      });
      if (result.status === "success") {
        setActionResult({
          type: "success",
          message: (result.content as any)?.result ?? t("memoryActionSuccess"),
        });
        setImportPassword("");
      } else {
        setActionResult({ type: "error", message: t("memoryActionFailed") });
      }
      setTimeout(() => setActionResult(null), 8000);
    } catch {
      setActionResult({ type: "error", message: t("memoryActionFailed") });
      setTimeout(() => setActionResult(null), 5000);
    }
    setHealthAction("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "#159994", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-sm rounded-lg border p-4 shadow-lg"
            style={{
              backgroundColor: "var(--vscode-editor-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: "#f59e0b" }} />
              <h3 className="text-sm font-semibold">{t("memoryConfirmAction")}</h3>
            </div>
            <p className="mb-4 text-xs opacity-70">{confirmDialog.description}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="rounded border px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                {t("memoryCancel")}
              </button>
              <button
                onClick={handleConfirm}
                className="rounded px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.8)",
                  color: "#fff",
                }}
              >
                {confirmDialog.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Result Toast */}
      {actionResult && (
        <div
          className="flex items-center gap-2 rounded-lg border p-2.5 text-xs"
          style={{
            borderColor: actionResult.type === "success" ? "#22c55e" : "#ef4444",
            backgroundColor: actionResult.type === "success" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: actionResult.type === "success" ? "#22c55e" : "#ef4444",
          }}
        >
          {actionResult.type === "success" ? <Check size={14} /> : <X size={14} />}
          <span className="flex-1">{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      {/* General Settings */}
      <SettingsSection title={t("memoryGeneralSettings")} icon={<Settings size={14} />}>
        <ToggleSetting
          label={t("memoryAutoMemory")}
          description={t("memoryAutoMemoryDesc")}
          checked={config.auto_extract_enabled}
          onChange={(v) => updateField("auto_extract_enabled", v)}
          saved={savedMessage === "auto_extract_enabled"}
        />
        <NumberSetting
          label={t("memoryConsolidationInterval")}
          description={t("memoryConsolidationIntervalDesc")}
          value={config.consolidation_interval_hours}
          min={1}
          max={168}
          suffix={t("memoryHoursSuffix")}
          onChange={(v) => updateField("consolidation_interval_hours", v)}
          saved={savedMessage === "consolidation_interval_hours"}
        />
      </SettingsSection>

      {/* Ebbinghaus Forgetting Curve */}
      <SettingsSection title={t("memoryEbbinghausSettings")} icon={<Brain size={14} />}>
        <NumberSetting
          label={t("memoryEbbinghausBaseStrength")}
          description={t("memoryEbbinghausBaseStrengthDesc")}
          value={config.ebbinghaus_base_strength}
          min={0.1}
          max={30}
          onChange={(v) => updateField("ebbinghaus_base_strength", v)}
          saved={savedMessage === "ebbinghaus_base_strength"}
        />
        <FloatSetting
          label={t("memoryEbbinghausLambda")}
          description={t("memoryEbbinghausLambdaDesc")}
          value={config.ebbinghaus_lambda}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(v) => updateField("ebbinghaus_lambda", v)}
          saved={savedMessage === "ebbinghaus_lambda"}
        />
        <NumberSetting
          label={t("memoryEbbinghausPruneThreshold")}
          description={t("memoryEbbinghausPruneThresholdDesc")}
          value={Math.round(config.ebbinghaus_prune_threshold * 100)}
          min={5}
          max={50}
          suffix="%"
          onChange={(v) => updateField("ebbinghaus_prune_threshold", v / 100)}
          saved={savedMessage === "ebbinghaus_prune_threshold"}
        />
        <NumberSetting
          label={t("memoryEbbinghausReviewThreshold")}
          description={t("memoryEbbinghausReviewThresholdDesc")}
          value={Math.round(config.ebbinghaus_review_threshold * 100)}
          min={10}
          max={90}
          suffix="%"
          onChange={(v) => updateField("ebbinghaus_review_threshold", v / 100)}
          saved={savedMessage === "ebbinghaus_review_threshold"}
        />
        <FloatSetting
          label={t("memoryEbbinghausStrengtheningAlpha")}
          description={t("memoryEbbinghausStrengtheningAlphaDesc")}
          value={config.ebbinghaus_strengthening_alpha}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => updateField("ebbinghaus_strengthening_alpha", v)}
          saved={savedMessage === "ebbinghaus_strengthening_alpha"}
        />
        <FloatSetting
          label={t("memoryEbbinghausRepetitionBeta")}
          description={t("memoryEbbinghausRepetitionBetaDesc")}
          value={config.ebbinghaus_repetition_beta}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => updateField("ebbinghaus_repetition_beta", v)}
          saved={savedMessage === "ebbinghaus_repetition_beta"}
        />
        <NumberSetting
          label={t("memoryEbbinghausSalienceWeight")}
          description={t("memoryEbbinghausSalienceWeightDesc")}
          value={config.ebbinghaus_salience_weight}
          min={0}
          max={2}
          onChange={(v) => updateField("ebbinghaus_salience_weight", v)}
          saved={savedMessage === "ebbinghaus_salience_weight"}
        />
        <NumberSetting
          label={t("memoryEbbinghausImportanceWeight")}
          description={t("memoryEbbinghausImportanceWeightDesc")}
          value={config.ebbinghaus_importance_weight}
          min={0}
          max={2}
          onChange={(v) => updateField("ebbinghaus_importance_weight", v)}
          saved={savedMessage === "ebbinghaus_importance_weight"}
        />
      </SettingsSection>

      {/* Capacity Settings */}
      <SettingsSection title={t("memoryCapacitySettings")} icon={<Package size={14} />}>
        <NumberSetting
          label={t("memoryMaxHot")}
          description={t("memoryMaxHotDesc")}
          value={config.max_hot_memories}
          min={100}
          max={10000}
          onChange={(v) => updateField("max_hot_memories", v)}
          saved={savedMessage === "max_hot_memories"}
        />
        <NumberSetting
          label={t("memoryMaxEpisodic")}
          description={t("memoryMaxEpisodicDesc")}
          value={config.max_episodic_per_session}
          min={100}
          max={10000}
          onChange={(v) => updateField("max_episodic_per_session", v)}
          saved={savedMessage === "max_episodic_per_session"}
        />
        <NumberSetting
          label={t("memoryContextTokens")}
          description={t("memoryContextTokensDesc")}
          value={config.context_max_tokens}
          min={1000}
          max={MEMORY_CONTEXT_TOKEN_CEILING}
          onChange={(v) => updateField("context_max_tokens", v)}
          saved={savedMessage === "context_max_tokens"}
        />
        <SelectSetting
          label={t("memoryMode")}
          description={t("memoryModeDesc")}
          value={config.memory_mode}
          options={[
            { value: "summarized", label: t("memoryModeSummarized") },
            { value: "full", label: t("memoryModeFull") },
            { value: "selective", label: t("memoryModeSelective") },
          ]}
          onChange={(v) => updateField("memory_mode", v)}
          saved={savedMessage === "memory_mode"}
        />
        <NumberSetting
          label={t("memoryRetrievalThreshold")}
          description={t("memoryRetrievalThresholdDesc")}
          value={Math.round(config.retrieval_threshold * 100)}
          min={10}
          max={95}
          suffix="%"
          onChange={(v) => updateField("retrieval_threshold", v / 100)}
          saved={savedMessage === "retrieval_threshold"}
        />
        <NumberSetting
          label={t("memoryRetrievalTopK")}
          description={t("memoryRetrievalTopKDesc")}
          value={config.retrieval_top_k}
          min={5}
          max={100}
          onChange={(v) => updateField("retrieval_top_k", v)}
          saved={savedMessage === "retrieval_top_k"}
        />
        <ToggleSetting
          label={t("memoryEnhancedSemantic")}
          description={t("memoryEnhancedSemanticDesc")}
          checked={config.enable_enhanced_semantic}
          onChange={(v) => updateField("enable_enhanced_semantic", v)}
          saved={savedMessage === "enable_enhanced_semantic"}
        />
        <NumberSetting
          label={t("memoryMaxContextTokens")}
          description={t("memoryMaxContextTokensDesc")}
          value={config.max_context_tokens}
          min={1000}
          max={MEMORY_CONTEXT_TOKEN_CEILING}
          onChange={(v) => updateField("max_context_tokens", v)}
          saved={savedMessage === "max_context_tokens"}
        />
        <DecimalSetting
          label={t("memoryGoalBudgetRatio")}
          description={t("memoryGoalBudgetRatioDesc")}
          value={config.context_goal_budget_ratio}
          min={0.05}
          max={0.3}
          onChange={(v) => updateField("context_goal_budget_ratio", v)}
          saved={savedMessage === "context_goal_budget_ratio"}
        />
      </SettingsSection>

      {/* Retrieval precision (REL-20) */}
      <SettingsSection title={t("memoryPrecisionSettings")} icon={<Crosshair size={14} />}>
        <ToggleSetting
          label={t("memoryRequireLexical")}
          description={t("memoryRequireLexicalDesc")}
          checked={config.retrieval_require_lexical}
          onChange={(v) => updateField("retrieval_require_lexical", v)}
          saved={savedMessage === "retrieval_require_lexical"}
        />
        <ToggleSetting
          label={t("memoryContinuationExpand")}
          description={t("memoryContinuationExpandDesc")}
          checked={config.retrieval_continuation_expand}
          onChange={(v) => updateField("retrieval_continuation_expand", v)}
          saved={savedMessage === "retrieval_continuation_expand"}
        />
        <ToggleSetting
          label={t("memoryFts5AndContent")}
          description={t("memoryFts5AndContentDesc")}
          checked={config.fts5_use_and_for_content}
          onChange={(v) => updateField("fts5_use_and_for_content", v)}
          saved={savedMessage === "fts5_use_and_for_content"}
        />
        <DecimalSetting
          label={t("memoryTopicShiftJaccard")}
          description={t("memoryTopicShiftJaccardDesc")}
          value={config.topic_shift_jaccard}
          min={0.1}
          max={0.8}
          onChange={(v) => updateField("topic_shift_jaccard", v)}
          saved={savedMessage === "topic_shift_jaccard"}
        />
        <DecimalSetting
          label={t("memoryWmMismatchDecay")}
          description={t("memoryWmMismatchDecayDesc")}
          value={config.wm_mismatch_decay}
          min={0.05}
          max={0.8}
          onChange={(v) => updateField("wm_mismatch_decay", v)}
          saved={savedMessage === "wm_mismatch_decay"}
        />
        <DecimalSetting
          label={t("memoryWmInjectMinRelevance")}
          description={t("memoryWmInjectMinRelevanceDesc")}
          value={config.wm_inject_min_relevance}
          min={0.1}
          max={0.8}
          onChange={(v) => updateField("wm_inject_min_relevance", v)}
          saved={savedMessage === "wm_inject_min_relevance"}
        />
        <DecimalSetting
          label={t("memorySummaryInjectMinOverlap")}
          description={t("memorySummaryInjectMinOverlapDesc")}
          value={config.summary_inject_min_overlap}
          min={0.05}
          max={0.8}
          onChange={(v) => updateField("summary_inject_min_overlap", v)}
          saved={savedMessage === "summary_inject_min_overlap"}
        />
        <NumberSetting
          label={t("memoryPinnedUnmatchedCap")}
          description={t("memoryPinnedUnmatchedCapDesc")}
          value={config.pinned_unmatched_cap}
          min={0}
          max={10}
          onChange={(v) => updateField("pinned_unmatched_cap", v)}
          saved={savedMessage === "pinned_unmatched_cap"}
        />
      </SettingsSection>

      {/* Working Memory */}
      <SettingsSection title={t("memoryWorkingMemorySettings")} icon={<Brain size={14} />}>
        <NumberSetting
          label={t("memoryWorkingMemorySlots")}
          description={t("memoryWorkingMemorySlotsDesc")}
          value={config.working_memory_max_slots}
          min={3}
          max={15}
          onChange={(v) => updateField("working_memory_max_slots", v)}
          saved={savedMessage === "working_memory_max_slots"}
        />
        <DecimalSetting
          label={t("memoryWorkingMemoryTokenRatio")}
          description={t("memoryWorkingMemoryTokenRatioDesc")}
          value={config.working_memory_token_ratio}
          min={0.05}
          max={0.5}
          onChange={(v) => updateField("working_memory_token_ratio", v)}
          saved={savedMessage === "working_memory_token_ratio"}
        />
        <NumberSetting
          label={t("memoryWorkingMemoryTokenBudget")}
          description={t("memoryWorkingMemoryTokenBudgetDesc")}
          value={config.working_memory_token_budget}
          min={0}
          max={30000}
          onChange={(v) => updateField("working_memory_token_budget", v)}
          saved={savedMessage === "working_memory_token_budget"}
        />
        <FloatSetting
          label={t("memoryWorkingMemoryDecay")}
          description={t("memoryWorkingMemoryDecayDesc")}
          value={config.working_memory_decay_rate}
          min={0.0001}
          max={0.01}
          step={0.0001}
          onChange={(v) => updateField("working_memory_decay_rate", v)}
          saved={savedMessage === "working_memory_decay_rate"}
        />
        <NumberSetting
          label={t("memoryWorkingMemoryTtl")}
          description={t("memoryWorkingMemoryTtlDesc")}
          value={config.working_memory_ttl_seconds}
          min={5}
          max={120}
          onChange={(v) => updateField("working_memory_ttl_seconds", v)}
          saved={savedMessage === "working_memory_ttl_seconds"}
        />
        <NumberSetting
          label={t("memorySensoryBufferMs")}
          description={t("memorySensoryBufferMsDesc")}
          value={config.sensory_buffer_ms}
          min={100}
          max={2000}
          onChange={(v) => updateField("sensory_buffer_ms", v)}
          saved={savedMessage === "sensory_buffer_ms"}
        />
      </SettingsSection>

      {/* Task Routing & Autonomous Loop */}
      <SettingsSection title={t("memoryTaskRoutingSettings")} icon={<SlidersHorizontal size={14} />}>
        <TextSetting
          label={t("memoryEasyModel")}
          description={t("memoryEasyModelDesc")}
          value={config.easy_model}
          onChange={(v) => updateField("easy_model", v)}
          saved={savedMessage === "easy_model"}
        />
        <TextSetting
          label={t("memoryMediumModel")}
          description={t("memoryMediumModelDesc")}
          value={config.medium_model}
          onChange={(v) => updateField("medium_model", v)}
          saved={savedMessage === "medium_model"}
        />
        <TextSetting
          label={t("memoryHardModel")}
          description={t("memoryHardModelDesc")}
          value={config.hard_model}
          onChange={(v) => updateField("hard_model", v)}
          saved={savedMessage === "hard_model"}
        />
        <NumberSetting
          label={t("memoryAutonomousMaxIterations")}
          description={t("memoryAutonomousMaxIterationsDesc")}
          value={config.autonomous_max_iterations}
          min={0}
          max={50}
          onChange={(v) => updateField("autonomous_max_iterations", v)}
          saved={savedMessage === "autonomous_max_iterations"}
        />
      </SettingsSection>

      {/* Advanced: Context Assembly */}
      <CollapsibleSettingsSection
        title={t("memoryContextAssemblySettings")}
        icon={<Layers size={14} />}
      >
        <NumberSetting
          label={t("memoryGraphEntitySearch")}
          description={t("memoryGraphEntitySearchDesc")}
          value={config.context_graph_entity_search}
          min={3}
          max={50}
          onChange={(v) => updateField("context_graph_entity_search", v)}
          saved={savedMessage === "context_graph_entity_search"}
        />
        <NumberSetting
          label={t("memoryGraphEntityDisplay")}
          description={t("memoryGraphEntityDisplayDesc")}
          value={config.context_graph_entity_display}
          min={1}
          max={20}
          onChange={(v) => updateField("context_graph_entity_display", v)}
          saved={savedMessage === "context_graph_entity_display"}
        />
        <NumberSetting
          label={t("memoryGraphEdgePerEntity")}
          description={t("memoryGraphEdgePerEntityDesc")}
          value={config.context_graph_edge_per_entity}
          min={1}
          max={10}
          onChange={(v) => updateField("context_graph_edge_per_entity", v)}
          saved={savedMessage === "context_graph_edge_per_entity"}
        />
        <DecimalSetting
          label={t("memoryGraphEdgeBudgetRatio")}
          description={t("memoryGraphEdgeBudgetRatioDesc")}
          value={config.context_graph_edge_budget_ratio}
          min={0.3}
          max={1}
          onChange={(v) => updateField("context_graph_edge_budget_ratio", v)}
          saved={savedMessage === "context_graph_edge_budget_ratio"}
        />
        <NumberSetting
          label={t("memoryProcedureLimit")}
          description={t("memoryProcedureLimitDesc")}
          value={config.context_procedure_limit}
          min={1}
          max={20}
          onChange={(v) => updateField("context_procedure_limit", v)}
          saved={savedMessage === "context_procedure_limit"}
        />
        <NumberSetting
          label={t("memoryPatternLimit")}
          description={t("memoryPatternLimitDesc")}
          value={config.context_pattern_limit}
          min={1}
          max={20}
          onChange={(v) => updateField("context_pattern_limit", v)}
          saved={savedMessage === "context_pattern_limit"}
        />
        <NumberSetting
          label={t("memoryPinnedLimit")}
          description={t("memoryPinnedLimitDesc")}
          value={config.context_pinned_limit}
          min={1}
          max={50}
          onChange={(v) => updateField("context_pinned_limit", v)}
          saved={savedMessage === "context_pinned_limit"}
        />
        <NumberSetting
          label={t("memoryLineCompressChars")}
          description={t("memoryLineCompressCharsDesc")}
          value={config.context_line_compress_chars}
          min={100}
          max={1000}
          onChange={(v) => updateField("context_line_compress_chars", v)}
          saved={savedMessage === "context_line_compress_chars"}
        />
        <NumberSetting
          label={t("memoryCompressKeepLines")}
          description={t("memoryCompressKeepLinesDesc")}
          value={config.context_compress_keep_lines}
          min={1}
          max={10}
          onChange={(v) => updateField("context_compress_keep_lines", v)}
          saved={savedMessage === "context_compress_keep_lines"}
        />
      </CollapsibleSettingsSection>

      {/* Advanced: Mode Tuning */}
      <CollapsibleSettingsSection
        title={t("memoryModeTuningSettings")}
        icon={<SlidersHorizontal size={14} />}
      >
        <p className="text-xs font-medium opacity-70">{t("memoryModeSummarized")}</p>
        <DecimalSetting
          label={t("memoryModeSemanticMultiplier")}
          description={t("memoryModeSemanticMultiplierDesc")}
          value={config.mode_summarized_semantic_multiplier}
          min={0.25}
          max={2}
          onChange={(v) => updateField("mode_summarized_semantic_multiplier", v)}
          saved={savedMessage === "mode_summarized_semantic_multiplier"}
        />
        <DecimalSetting
          label={t("memoryModeEpisodicMultiplier")}
          description={t("memoryModeEpisodicMultiplierDesc")}
          value={config.mode_summarized_episodic_multiplier}
          min={0.25}
          max={2}
          onChange={(v) => updateField("mode_summarized_episodic_multiplier", v)}
          saved={savedMessage === "mode_summarized_episodic_multiplier"}
        />
        <DecimalSetting
          label={t("memoryModeMinImportance")}
          description={t("memoryModeMinImportanceDesc")}
          value={config.mode_summarized_min_importance}
          min={0}
          max={1}
          onChange={(v) => updateField("mode_summarized_min_importance", v)}
          saved={savedMessage === "mode_summarized_min_importance"}
        />
        <NumberSetting
          label={t("memoryModeEpisodicSnippetLen")}
          description={t("memoryModeEpisodicSnippetLenDesc")}
          value={config.mode_summarized_episodic_snippet_len}
          min={50}
          max={800}
          onChange={(v) => updateField("mode_summarized_episodic_snippet_len", v)}
          saved={savedMessage === "mode_summarized_episodic_snippet_len"}
        />

        <p className="pt-2 text-xs font-medium opacity-70">{t("memoryModeFull")}</p>
        <DecimalSetting
          label={t("memoryModeSemanticMultiplier")}
          description={t("memoryModeSemanticMultiplierDesc")}
          value={config.mode_full_semantic_multiplier}
          min={0.25}
          max={2}
          onChange={(v) => updateField("mode_full_semantic_multiplier", v)}
          saved={savedMessage === "mode_full_semantic_multiplier"}
        />
        <DecimalSetting
          label={t("memoryModeEpisodicMultiplier")}
          description={t("memoryModeEpisodicMultiplierDesc")}
          value={config.mode_full_episodic_multiplier}
          min={0.25}
          max={3}
          onChange={(v) => updateField("mode_full_episodic_multiplier", v)}
          saved={savedMessage === "mode_full_episodic_multiplier"}
        />
        <NumberSetting
          label={t("memoryModeEpisodicSnippetLen")}
          description={t("memoryModeEpisodicSnippetLenDesc")}
          value={config.mode_full_episodic_snippet_len}
          min={100}
          max={1000}
          onChange={(v) => updateField("mode_full_episodic_snippet_len", v)}
          saved={savedMessage === "mode_full_episodic_snippet_len"}
        />

        <p className="pt-2 text-xs font-medium opacity-70">{t("memoryModeSelective")}</p>
        <DecimalSetting
          label={t("memoryModeSemanticMultiplier")}
          description={t("memoryModeSemanticMultiplierDesc")}
          value={config.mode_selective_semantic_multiplier}
          min={0.1}
          max={1.5}
          onChange={(v) => updateField("mode_selective_semantic_multiplier", v)}
          saved={savedMessage === "mode_selective_semantic_multiplier"}
        />
        <DecimalSetting
          label={t("memoryModeMinImportance")}
          description={t("memoryModeMinImportanceDesc")}
          value={config.mode_selective_min_importance}
          min={0.5}
          max={1}
          onChange={(v) => updateField("mode_selective_min_importance", v)}
          saved={savedMessage === "mode_selective_min_importance"}
        />
        <ToggleSetting
          label={t("memorySelectiveIncludeEpisodic")}
          description={t("memorySelectiveIncludeEpisodicDesc")}
          checked={config.mode_selective_include_episodic}
          onChange={(v) => updateField("mode_selective_include_episodic", v)}
          saved={savedMessage === "mode_selective_include_episodic"}
        />
        <ToggleSetting
          label={t("memorySelectiveIncludeProcedures")}
          description={t("memorySelectiveIncludeProceduresDesc")}
          checked={config.mode_selective_include_procedures}
          onChange={(v) => updateField("mode_selective_include_procedures", v)}
          saved={savedMessage === "mode_selective_include_procedures"}
        />
        <ToggleSetting
          label={t("memorySelectiveIncludePatterns")}
          description={t("memorySelectiveIncludePatternsDesc")}
          checked={config.mode_selective_include_patterns}
          onChange={(v) => updateField("mode_selective_include_patterns", v)}
          saved={savedMessage === "mode_selective_include_patterns"}
        />
      </CollapsibleSettingsSection>

      {/* Advanced: Budget Allocation */}
      <CollapsibleSettingsSection
        title={t("memoryBudgetSettings")}
        icon={<SlidersHorizontal size={14} />}
      >
        <DecimalSetting
          label={t("memoryBudgetSemantic")}
          description={t("memoryBudgetSemanticDesc")}
          value={config.budget_semantic_ratio}
          min={0.1}
          max={0.7}
          onChange={(v) => updateField("budget_semantic_ratio", v)}
          saved={savedMessage === "budget_semantic_ratio"}
        />
        <DecimalSetting
          label={t("memoryBudgetEpisodic")}
          description={t("memoryBudgetEpisodicDesc")}
          value={config.budget_episodic_ratio}
          min={0.05}
          max={0.5}
          onChange={(v) => updateField("budget_episodic_ratio", v)}
          saved={savedMessage === "budget_episodic_ratio"}
        />
        <DecimalSetting
          label={t("memoryBudgetGraph")}
          description={t("memoryBudgetGraphDesc")}
          value={config.budget_graph_ratio}
          min={0.05}
          max={0.4}
          onChange={(v) => updateField("budget_graph_ratio", v)}
          saved={savedMessage === "budget_graph_ratio"}
        />
        <DecimalSetting
          label={t("memoryBudgetProcedures")}
          description={t("memoryBudgetProceduresDesc")}
          value={config.budget_procedures_ratio}
          min={0.05}
          max={0.4}
          onChange={(v) => updateField("budget_procedures_ratio", v)}
          saved={savedMessage === "budget_procedures_ratio"}
        />
        <DecimalSetting
          label={t("memoryBudgetPatterns")}
          description={t("memoryBudgetPatternsDesc")}
          value={config.budget_patterns_ratio}
          min={0.05}
          max={0.4}
          onChange={(v) => updateField("budget_patterns_ratio", v)}
          saved={savedMessage === "budget_patterns_ratio"}
        />
      </CollapsibleSettingsSection>

      {/* Advanced: Fusion & Recency */}
      <CollapsibleSettingsSection
        title={t("memoryFusionSettings")}
        icon={<Search size={14} />}
      >
        <p className="text-xs opacity-50">{t("memoryFusionWeightProfilesDesc")}</p>
        <NumberSetting
          label={t("memoryFusionCandidateMultiplier")}
          description={t("memoryFusionCandidateMultiplierDesc")}
          value={config.fusion_candidate_multiplier}
          min={2}
          max={20}
          onChange={(v) => updateField("fusion_candidate_multiplier", v)}
          saved={savedMessage === "fusion_candidate_multiplier"}
        />
        <NumberSetting
          label={t("memoryFusionCandidateMin")}
          description={t("memoryFusionCandidateMinDesc")}
          value={config.fusion_candidate_min}
          min={10}
          max={200}
          onChange={(v) => updateField("fusion_candidate_min", v)}
          saved={savedMessage === "fusion_candidate_min"}
        />
        <FloatSetting
          label={t("memoryRecencyDecayLambda")}
          description={t("memoryRecencyDecayLambdaDesc")}
          value={config.recency_decay_lambda}
          min={0.001}
          max={0.02}
          step={0.0001}
          onChange={(v) => updateField("recency_decay_lambda", v)}
          saved={savedMessage === "recency_decay_lambda"}
        />
        <DecimalSetting
          label={t("memoryGraphDepthDecayGamma")}
          description={t("memoryGraphDepthDecayGammaDesc")}
          value={config.graph_depth_decay_gamma}
          min={0.3}
          max={0.95}
          onChange={(v) => updateField("graph_depth_decay_gamma", v)}
          saved={savedMessage === "graph_depth_decay_gamma"}
        />
        <DecimalSetting
          label={t("memoryGraphMemoryBoost")}
          description={t("memoryGraphMemoryBoostDesc")}
          value={config.graph_memory_boost_factor}
          min={0.1}
          max={0.8}
          onChange={(v) => updateField("graph_memory_boost_factor", v)}
          saved={savedMessage === "graph_memory_boost_factor"}
        />
        <NumberSetting
          label={t("memoryGraphNeighborLimit")}
          description={t("memoryGraphNeighborLimitDesc")}
          value={config.graph_neighbor_limit}
          min={3}
          max={50}
          onChange={(v) => updateField("graph_neighbor_limit", v)}
          saved={savedMessage === "graph_neighbor_limit"}
        />
      </CollapsibleSettingsSection>

      {/* Advanced: Compression Hierarchy */}
      <CollapsibleSettingsSection
        title={t("memoryCompressionSettings")}
        icon={<Layers size={14} />}
      >
        <p className="text-xs opacity-50">{t("memoryCompressionSettingsDesc")}</p>
        <DecimalSetting
          label={t("memoryCompressionHot")}
          description={t("memoryCompressionHotDesc")}
          value={config.compression_ratio_hot}
          min={0.05}
          max={1}
          onChange={(v) => updateField("compression_ratio_hot", v)}
          saved={savedMessage === "compression_ratio_hot"}
        />
        <DecimalSetting
          label={t("memoryCompressionWarm")}
          description={t("memoryCompressionWarmDesc")}
          value={config.compression_ratio_warm}
          min={0.05}
          max={1}
          onChange={(v) => updateField("compression_ratio_warm", v)}
          saved={savedMessage === "compression_ratio_warm"}
        />
        <DecimalSetting
          label={t("memoryCompressionCold")}
          description={t("memoryCompressionColdDesc")}
          value={config.compression_ratio_cold}
          min={0.05}
          max={1}
          onChange={(v) => updateField("compression_ratio_cold", v)}
          saved={savedMessage === "compression_ratio_cold"}
        />
        <DecimalSetting
          label={t("memoryCompressionFrozen")}
          description={t("memoryCompressionFrozenDesc")}
          value={config.compression_ratio_frozen}
          min={0.05}
          max={1}
          onChange={(v) => updateField("compression_ratio_frozen", v)}
          saved={savedMessage === "compression_ratio_frozen"}
        />
      </CollapsibleSettingsSection>

      {/* Integration Timeouts */}
      <CollapsibleSettingsSection
        title={t("memoryIntegrationSettings")}
        icon={<Timer size={14} />}
      >
        <NumberSetting
          label={t("memoryBuildTimeout")}
          description={t("memoryBuildTimeoutDesc")}
          value={config.memory_build_timeout_ms}
          min={1000}
          max={30000}
          suffix={t("memoryMsSuffix")}
          onChange={(v) => updateField("memory_build_timeout_ms", v)}
          saved={savedMessage === "memory_build_timeout_ms"}
        />
        <NumberSetting
          label={t("memoryTrackSessionTimeout")}
          description={t("memoryTrackSessionTimeoutDesc")}
          value={config.memory_track_session_timeout_ms}
          min={500}
          max={10000}
          suffix={t("memoryMsSuffix")}
          onChange={(v) => updateField("memory_track_session_timeout_ms", v)}
          saved={savedMessage === "memory_track_session_timeout_ms"}
        />
      </CollapsibleSettingsSection>

      {/* Graph Settings */}
      <SettingsSection title={t("memoryGraphSettings")} icon={<Search size={14} />}>
        <NumberSetting
          label={t("memoryGraphMaxEntities")}
          description={t("memoryGraphMaxEntitiesDesc")}
          value={config.graph_max_entities}
          min={500}
          max={10000}
          onChange={(v) => updateField("graph_max_entities", v)}
          saved={savedMessage === "graph_max_entities"}
        />
        <NumberSetting
          label={t("memoryGraphMaxDepth")}
          description={t("memoryGraphMaxDepthDesc")}
          value={config.graph_max_depth}
          min={1}
          max={5}
          onChange={(v) => updateField("graph_max_depth", v)}
          saved={savedMessage === "graph_max_depth"}
        />
        <SelectSetting
          label={t("memoryScope")}
          description={t("memoryScopeDesc")}
          value={config.memory_scope}
          options={[
            { value: "project", label: t("memoryScopeProject") },
            { value: "global", label: t("memoryScopeGlobal") },
          ]}
          onChange={(v) => updateField("memory_scope", v)}
          saved={savedMessage === "memory_scope"}
        />
        <ToggleSetting
          label={t("memoryKnowledgeExtraction")}
          description={t("memoryKnowledgeExtractionDesc")}
          checked={config.enable_knowledge_extraction}
          onChange={(v) => updateField("enable_knowledge_extraction", v)}
          saved={savedMessage === "enable_knowledge_extraction"}
        />
        <NumberSetting
          label={t("memoryPostTurnMinChars")}
          description={t("memoryPostTurnMinCharsDesc")}
          value={config.post_turn_min_chars}
          min={20}
          max={2000}
          onChange={(v) => updateField("post_turn_min_chars", v)}
          saved={savedMessage === "post_turn_min_chars"}
        />
        <ToggleSetting
          label={t("memoryAutoSummarize")}
          description={t("memoryAutoSummarizeDesc")}
          checked={config.auto_summarize}
          onChange={(v) => updateField("auto_summarize", v)}
          saved={savedMessage === "auto_summarize"}
        />
        <NumberSetting
          label={t("memorySummarizeThreshold")}
          description={t("memorySummarizeThresholdDesc")}
          value={config.summarize_threshold}
          min={10}
          max={500}
          onChange={(v) => updateField("summarize_threshold", v)}
          saved={savedMessage === "summarize_threshold"}
        />
      </SettingsSection>

      {/* Tiering Settings */}
      <SettingsSection title={t("memoryTieringSettings")} icon={<Package size={14} />}>
        <NumberSetting
          label={t("memoryHotToWarm")}
          description={t("memoryHotToWarmDesc")}
          value={config.hot_to_warm_hours}
          min={1}
          max={720}
          suffix={t("memoryHoursSuffix")}
          onChange={(v) => updateField("hot_to_warm_hours", v)}
          saved={savedMessage === "hot_to_warm_hours"}
        />
        <NumberSetting
          label={t("memoryWarmToCold")}
          description={t("memoryWarmToColdDesc")}
          value={config.warm_to_cold_days}
          min={1}
          max={365}
          suffix={t("memoryDaysSuffix")}
          onChange={(v) => updateField("warm_to_cold_days", v)}
          saved={savedMessage === "warm_to_cold_days"}
        />
        <NumberSetting
          label={t("memoryColdPrune")}
          description={t("memoryColdPruneDesc")}
          value={config.cold_prune_days}
          min={7}
          max={3650}
          suffix={t("memoryDaysSuffix")}
          onChange={(v) => updateField("cold_prune_days", v)}
          saved={savedMessage === "cold_prune_days"}
        />
      </SettingsSection>

      {/* Feature Settings */}
      <SettingsSection title={t("memoryFeatureSettings")} icon={<Search size={14} />}>
        <ToggleSetting
          label={t("memoryGraphEnabled")}
          description={t("memoryGraphEnabledDesc")}
          checked={config.graph_enabled}
          onChange={(v) => updateField("graph_enabled", v)}
          saved={savedMessage === "graph_enabled"}
        />
        <ToggleSetting
          label={t("memoryLearningEnabled")}
          description={t("memoryLearningEnabledDesc")}
          checked={config.learning_enabled}
          onChange={(v) => updateField("learning_enabled", v)}
          saved={savedMessage === "learning_enabled"}
        />
        <ToggleSetting
          label={t("memoryLlmExtraction")}
          description={t("memoryLlmExtractionDesc")}
          checked={config.llm_entity_extraction_enabled}
          onChange={(v) => updateField("llm_entity_extraction_enabled", v)}
          saved={savedMessage === "llm_entity_extraction_enabled"}
        />
        <ToggleSetting
          label={t("memoryLlmSummarization")}
          description={t("memoryLlmSummarizationDesc")}
          checked={config.llm_summarization_enabled}
          onChange={(v) => updateField("llm_summarization_enabled", v)}
          saved={savedMessage === "llm_summarization_enabled"}
        />
        <ToggleSetting
          label={t("memoryLlmImportance")}
          description={t("memoryLlmImportanceDesc")}
          checked={config.llm_importance_scoring_enabled}
          onChange={(v) => updateField("llm_importance_scoring_enabled", v)}
          saved={savedMessage === "llm_importance_scoring_enabled"}
        />
        <ToggleSetting
          label={t("memoryLlmPostAction")}
          description={t("memoryLlmPostActionDesc")}
          checked={config.llm_post_action_memory_enabled}
          onChange={(v) => updateField("llm_post_action_memory_enabled", v)}
          saved={savedMessage === "llm_post_action_memory_enabled"}
        />
      </SettingsSection>

      {/* Maintenance Actions */}
      <SettingsSection title={t("memoryMaintenanceActions")} icon={<Wrench size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            label={t("memoryOptimizeDb")}
            icon={<Zap size={14} />}
            loading={healthAction === "optimize"}
            onClick={() => runAction("optimize", "optimize")}
          />
          <ActionButton
            label={t("memoryConsolidateNow")}
            icon={<RefreshCw size={14} />}
            loading={healthAction === "consolidate"}
            onClick={() => confirmAndRun("consolidate", t("memoryConsolidateNow"), t("memoryConsolidateWarning"))}
          />
          <ActionButton
            label={t("memoryExportData")}
            icon={<FileDown size={14} />}
            loading={healthAction === "export"}
            onClick={handleExport}
          />
          <ActionButton
            label={t("memoryImportData")}
            icon={<Upload size={14} />}
            loading={healthAction === "import"}
            onClick={() => importInputRef.current?.click()}
          />
          <ActionButton
            label={t("memoryHealSystem")}
            icon={<HeartPulse size={14} />}
            loading={healthAction === "heal"}
            onClick={() => runAction("heal", "heal")}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          <label className="block text-xs opacity-70">
            {t("memoryExportPasswordOptional")}
            <input
              type="password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder={t("memoryExportPasswordPlaceholder")}
              className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
              style={{
                backgroundColor: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                borderColor: "var(--vscode-input-border)",
              }}
            />
          </label>
          <label className="block text-xs opacity-70">
            {t("memoryImportPasswordOptional")}
            <input
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder={t("memoryImportPasswordPlaceholder")}
              className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
              style={{
                backgroundColor: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                borderColor: "var(--vscode-input-border)",
              }}
            />
          </label>
        </div>
        <p className="text-xs opacity-50">{t("memoryBackupLocalOnly")}</p>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleImportFile(file);
            }
            e.target.value = "";
          }}
        />
      </SettingsSection>

      {/* Danger Zone */}
      <SettingsSection title={t("memoryDangerZone")} icon={<AlertTriangle size={14} />}>
        <p className="mb-3 text-xs opacity-60">
          {t("memoryDangerZoneDesc")}
        </p>
        <ActionButton
          label={t("memoryPurgeExpired")}
          icon={<Trash2 size={14} />}
          variant="danger"
          loading={healthAction === "prune_expired"}
          onClick={() => confirmAndRun("prune_expired", t("memoryPurgeExpired"), t("memoryPurgeWarning"))}
        />
      </SettingsSection>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function SettingsSection({
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
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        {icon} {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function CollapsibleSettingsSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--vscode-panel-border)" }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-sm font-semibold"
      >
        <span className="flex items-center gap-1.5">
          {icon} {title}
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
  saved,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  saved?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{
          backgroundColor: checked ? "#159994" : "var(--vscode-input-background)",
        }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: checked ? "18px" : "2px" }}
        />
      </button>
    </div>
  );
}

function NumberSetting({
  label,
  description,
  value,
  min,
  max,
  suffix,
  onChange,
  saved,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
  saved?: boolean;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const commit = () => {
    const n = parseInt(local, 10);
    if (!isNaN(n) && n >= min && n <= max) {
      onChange(n);
    } else {
      setLocal(String(value));
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={local}
          min={min}
          max={max}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-20 rounded border px-2 py-1 text-right text-xs"
          style={{
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            borderColor: "var(--vscode-input-border)",
          }}
        />
        {suffix && <span className="text-xs opacity-50">{suffix}</span>}
      </div>
    </div>
  );
}

function TextSetting({
  label,
  description,
  value,
  onChange,
  saved,
  placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  saved?: boolean;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const commit = () => onChange(local.trim());

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="w-48 rounded border px-2 py-1 text-xs"
        style={{
          backgroundColor: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          borderColor: "var(--vscode-input-border)",
        }}
      />
    </div>
  );
}

/** 0–1 ratio displayed and edited as a percentage. */
function DecimalSetting({
  label,
  description,
  value,
  min,
  max,
  onChange,
  saved,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  saved?: boolean;
}) {
  const [local, setLocal] = useState(String(Math.round(value * 100)));

  useEffect(() => {
    setLocal(String(Math.round(value * 100)));
  }, [value]);

  const commit = () => {
    const pct = parseInt(local, 10);
    if (!isNaN(pct)) {
      const ratio = pct / 100;
      if (ratio >= min && ratio <= max) {
        onChange(Math.round(ratio * 1000) / 1000);
        return;
      }
    }
    setLocal(String(Math.round(value * 100)));
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={local}
          min={Math.round(min * 100)}
          max={Math.round(max * 100)}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-20 rounded border px-2 py-1 text-right text-xs"
          style={{
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            borderColor: "var(--vscode-input-border)",
          }}
        />
        <span className="text-xs opacity-50">%</span>
      </div>
    </div>
  );
}

function FloatSetting({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
  saved,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  saved?: boolean;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n) && n >= min && n <= max) {
      onChange(n);
    } else {
      setLocal(String(value));
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="w-24 rounded border px-2 py-1 text-right text-xs"
        style={{
          backgroundColor: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          borderColor: "var(--vscode-input-border)",
        }}
      />
    </div>
  );
}

function SelectSetting({
  label,
  description,
  value,
  options,
  onChange,
  saved,
}: {
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  saved?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm">
          {label}
          {saved && <Check size={12} style={{ color: "#22c55e" }} className="inline" />}
        </div>
        <div className="text-xs opacity-50">{description}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border px-2 py-1 text-xs"
        style={{
          backgroundColor: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          borderColor: "var(--vscode-input-border)",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  loading,
  variant,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  loading?: boolean;
  variant?: "danger";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
      style={{
        backgroundColor: variant === "danger"
          ? "rgba(239, 68, 68, 0.1)"
          : "var(--vscode-button-secondaryBackground)",
        color: variant === "danger"
          ? "#ef4444"
          : "var(--vscode-button-secondaryForeground)",
        borderColor: variant === "danger"
          ? "rgba(239, 68, 68, 0.3)"
          : "var(--vscode-panel-border)",
      }}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon} {label}
    </button>
  );
}
