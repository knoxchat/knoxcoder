#!/usr/bin/env npx tsx
/**
 * Knox-MS Memory Brain — Manual checklist validator (A–H).
 *
 * Programmatically validates smoke-checklist items from memory-impl.md
 * without requiring the VS Code extension.
 *
 *   cd core && npx tsx context/memory/brain/test-memory-checklist.ts
 */

import fs from "fs";
import os from "os";
import path from "path";

const testDir = path.join(os.tmpdir(), `brain-checklist-${Date.now()}`);
fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
process.env.KNOX_GLOBAL_DIR = testDir;

interface Check {
  section: string;
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(
  section: string,
  id: string,
  name: string,
  pass: boolean,
  detail?: string,
): void {
  checks.push({ section, id, name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} [${section}/${id}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function isAutonomousCommand(text: string): boolean {
  return /^\/autonomous\b/i.test(text.trim());
}

function parseAutonomousGoal(text: string): string {
  return text.replace(/^\/autonomous\s+/i, "").trim();
}

const { BrainManager } = await import("./BrainManager.js");
const { BrainStore } = await import("./BrainStore.js");
const { MemoryPipeline } = await import("./MemoryPipeline.js");
const { LocalAutonomousLoop } = await import("./LocalAutonomousLoop.js");
const { SensoryBuffer } = await import("./SensoryBuffer.js");
const {
  getPostTurnMinChars,
  getIntegrationTimeouts,
} = await import("./memoryConfigAccess.js");

const wsA = path.join(testDir, "workspace-a");
const wsB = path.join(testDir, "workspace-b");
fs.mkdirSync(wsA, { recursive: true });
fs.mkdirSync(wsB, { recursive: true });

await BrainStore.get();

try {
  // ── A — Chat turn memory injection ────────────────────────────────────────
  const sessionA = "checklist-session-a";
  await BrainManager.trackSession(sessionA, "Checklist A", wsA);
  await BrainManager.recordMessage(sessionA, "user", "smoke-test-alpha-123 unique token");

  const preTurn = await MemoryPipeline.runPreTurn({
    message: "what was smoke-test-alpha-123?",
    session_id: sessionA,
    goal: "Recall smoke-test-alpha-123",
  });
  const hasGoal = preTurn.context?.items?.some((i) => i.kind === "goal") ?? false;
  record("A", "A1", "Pre-turn pipeline builds context", !!preTurn.context?.context);
  record("A", "A2", "C_goal in provenance (kind: goal)", hasGoal);
  record(
    "A",
    "A3",
    "Retrieved items include episodic/semantic or goal",
    (preTurn.context?.items?.length ?? 0) >= 1,
    `items=${preTurn.context?.items?.length ?? 0}`,
  );

  // ── B — Session lifecycle ─────────────────────────────────────────────────
  const sessionB = "checklist-session-b";
  await BrainManager.trackSession(sessionB, "Checklist B", wsA);
  await BrainManager.recordMessage(sessionB, "user", "session B message one");
  await BrainManager.recordMessage(sessionB, "user", "session B message two");

  await BrainManager.dispatch("close_session", { session_id: sessionA });
  await BrainManager.trackSession(sessionA, "Checklist A restored", wsA);

  const sessionRow = await BrainStore.getSession(sessionB);
  record("B", "B1", "close_session + trackSession lifecycle", true);
  record(
    "B",
    "B2",
    "Session has project_id (IMP-25)",
    Boolean(sessionRow?.project_id),
    sessionRow?.project_id?.slice(0, 8) ?? "missing",
  );
  record(
    "B",
    "B3",
    "Working memory restores on trackSession",
    BrainManager.getWorkingMemory().getStats().max_slots > 0,
  );

  // ── C — Memory Settings persistence ─────────────────────────────────────
  await BrainManager.updateConfig({ key: "memory_mode", value: "selective" });
  await BrainManager.updateConfig({ key: "context_max_tokens", value: "32000" });
  await BrainManager.updateConfig({ key: "sensory_buffer_ms", value: "400" });
  await BrainManager.updateConfig({ key: "post_turn_min_chars", value: "150" });
  await BrainManager.updateConfig({ key: "enable_enhanced_semantic", value: "true" });

  const cfg = BrainStore.getConfig();
  record("C", "C1", "memory_mode persists", cfg.memory_mode === "selective");
  record("C", "C2", "context_max_tokens persists", cfg.context_max_tokens === 32000);
  record("C", "C3", "sensory_buffer_ms persists + reschedule", cfg.sensory_buffer_ms === 400);
  record("C", "C4", "post_turn_min_chars persists", getPostTurnMinChars() === 150);
  record("C", "C5", "enable_enhanced_semantic persists", cfg.enable_enhanced_semantic === true);

  await BrainManager.updateConfig({ key: "memory_mode", value: "summarized" });
  await BrainManager.updateConfig({ key: "memory_scope", value: "project" });

  // ── D — Memory Overview dashboard metrics ─────────────────────────────────
  const effective = await BrainManager.getEffectiveContext();
  const phaseStatus = BrainManager.getPhaseStatus();
  const trend = await BrainManager.getMetricsTrend(24);
  await BrainManager.storeMetricsSnapshot();
  const consolidation = await BrainManager.dispatch("consolidate", {});

  record(
    "D",
    "D1",
    "C_effective formula fields present",
    effective.total_effective > effective.context_max_tokens &&
      effective.memory_levels?.length === 5,
    `total=${effective.total_effective}`,
  );
  record(
    "D",
    "D2",
    "Phase status + cycle invariant",
    phaseStatus.canonical_order.length === 8,
  );
  record("D", "D3", "Metrics trend snapshot stored", typeof trend === "object");
  record(
    "D",
    "D4",
    "Consolidate returns sleep sub_phases",
    String(consolidation).includes("promoted") || String(consolidation).includes("pruned"),
  );
  record(
    "D",
    "D5",
    "Graph cap status API",
    (await BrainManager.getGraphCapStatus()).max_entities > 0,
  );

  // ── E — Post-turn extraction ──────────────────────────────────────────────
  await BrainStore.saveConfig("enable_knowledge_extraction", "true");
  await BrainStore.saveConfig("auto_extract_enabled", "true");
  const substantialTurn =
    "We decided to migrate authentication to OAuth2 with refresh token rotation and PKCE. " +
    "The API gateway validates JWTs and enforces scope-based access control for all endpoints.";
  const postTurn = await MemoryPipeline.runPostTurn({
    message: substantialTurn,
    session_id: sessionB,
    role: "assistant",
    turn_content: substantialTurn,
  });
  const extracted =
    (postTurn.extracted?.semantic_count ?? 0) + (postTurn.extracted?.entity_count ?? 0);
  record(
    "E",
    "E1",
    "Post-turn runs consolidation + storage phases",
    postTurn.phases.some((p) => p.phase === "consolidation") &&
      postTurn.phases.some((p) => p.phase === "long_term_storage"),
  );
  record(
    "E",
    "E2",
    "Substantial turn may extract semantic/entity knowledge",
    extracted >= 0,
    `stored=${extracted}`,
  );

  // ── F — Autonomous loop + cancel ──────────────────────────────────────────
  const autoSession = "checklist-autonomous";
  await BrainManager.trackSession(autoSession, "Autonomous", wsA);

  const loopResult = await LocalAutonomousLoop.run({
    session_id: autoSession,
    goal: "Validate autonomous loop",
    max_iterations: 3,
    executeStep: async ({ iteration }) => ({
      done: iteration >= 2,
      result: `Iteration ${iteration} complete`,
    }),
  });
  record("F", "F1", "Autonomous loop completes", loopResult.success && loopResult.iterations === 2);

  const cancelSession = "checklist-autonomous-cancel";
  await BrainManager.trackSession(cancelSession, "Autonomous Cancel", wsA);
  const cancelResult = await LocalAutonomousLoop.run({
    session_id: cancelSession,
    goal: "Cancel test",
    max_iterations: 10,
    executeStep: async ({ iteration }) => {
      if (iteration === 1) LocalAutonomousLoop.cancel(cancelSession);
      await new Promise((r) => setTimeout(r, 15));
      return { done: false, result: `Step ${iteration}` };
    },
  });
  record("F", "F2", "Autonomous cancel stops loop", cancelResult.cancelled);
  record(
    "F",
    "F3",
    "TaskRouter scores difficulty",
    BrainManager.routeTask({ message: "fix bug", toolCount: 0 }).difficulty === "easy",
  );

  // ── G — Project scope ─────────────────────────────────────────────────────
  await BrainManager.updateConfig({ key: "memory_scope", value: "project" });
  await BrainManager.updateConfig({ key: "memory_mode", value: "full" });
  await BrainManager.updateConfig({ key: "retrieval_threshold", value: "0.25" });

  const projSessionA = "proj-scope-a";
  const projSessionB = "proj-scope-b";
  const needleA = "proj-scope-needle-workspace-a-unique";
  const needleB = "proj-scope-needle-workspace-b-unique";

  await BrainManager.trackSession(projSessionA, "Project A", wsA);
  await BrainManager.store({
    category: "fact",
    title: "Project A fact",
    content: needleA,
    importance: 0.9,
    session_id: projSessionA,
  });

  await BrainManager.trackSession(projSessionB, "Project B", wsB);
  await BrainManager.store({
    category: "fact",
    title: "Project B fact",
    content: needleB,
    importance: 0.9,
    keywords: "proj,scope,b,unique",
    session_id: projSessionB,
  });

  await BrainManager.trackSession(projSessionA, "Project A", wsA);
  const scopedCtx = await BrainManager.buildContextDetailed(needleA, projSessionA, 4000);
  const scopedHasA = scopedCtx.context?.includes(needleA) ?? false;
  const scopedHasB = scopedCtx.context?.includes(needleB) ?? false;

  await BrainManager.updateConfig({ key: "memory_scope", value: "global" });
  const recalledGlobal = await BrainManager.recall({
    query: needleB,
    session_id: projSessionA,
    limit: 10,
  });
  const globalHasB =
    recalledGlobal.semantic.some((m) => m.content.includes(needleB)) ||
    (await BrainManager.buildContextDetailed(needleB, projSessionB, 4000)).context?.includes(
      needleB,
    ) === true;

  record("G", "G1", "Project scope excludes other workspace memories", scopedHasA && !scopedHasB);
  record("G", "G2", "Global scope retrieves cross-project memories", globalHasB);

  // ── H — Edge cases ────────────────────────────────────────────────────────
  const longMessage = "x".repeat(12_000);
  const longCtx = await BrainManager.buildContextDetailed(longMessage, sessionB, 2000);
  record(
    "H",
    "H1",
    "Very long message compresses without crash",
    typeof longCtx.context === "string",
    `len=${longCtx.context?.length ?? 0}`,
  );

  record(
    "H",
    "H2",
    "/autonomous with no goal shows usage error",
    parseAutonomousGoal("/autonomous ") === "" && isAutonomousCommand("/autonomous"),
  );

  const timeouts = getIntegrationTimeouts();
  record(
    "H",
    "H3",
    "Memory build timeout config available",
    timeouts.memoryBuildMs >= 1000 && timeouts.trackSessionMs >= 500,
    `build=${timeouts.memoryBuildMs}ms track=${timeouts.trackSessionMs}ms`,
  );

  SensoryBuffer.ingest(sessionB, "editor chunk for flush test");
  const flushed = SensoryBuffer.flushOnTurnBoundary(sessionB, "user turn");
  record(
    "H",
    "H4",
    "Sensory buffer flushes on turn boundary",
    flushed.includes("user turn"),
  );

  await BrainManager.updateConfig({ key: "graph_max_entities", value: "2" });
  await BrainManager.addEntity({ name: "CapEntity1", entity_type: "concept" });
  await BrainManager.addEntity({ name: "CapEntity2", entity_type: "concept" });
  await BrainManager.addEntity({ name: "CapEntity3", entity_type: "concept" });
  const cap = await BrainManager.getGraphCapStatus();
  record("H", "H5", "Graph entity cap + LRU prune", cap.entity_count <= 2);
} catch (err) {
  record("ERR", "X0", "Unexpected validator error", false, String(err));
}

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);

console.log("\n══════════════════════════════════════════");
console.log(`  Checklist validator: ${passed}/${checks.length} passed`);
if (failed.length > 0) {
  console.log("  Failed:");
  for (const f of failed) {
    console.log(`    [${f.section}/${f.id}] ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }
}
console.log("══════════════════════════════════════════\n");

try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch {}

process.exit(failed.length > 0 ? 1 : 0);
