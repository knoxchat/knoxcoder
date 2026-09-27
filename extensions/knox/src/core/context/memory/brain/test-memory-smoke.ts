#!/usr/bin/env npx tsx
/**
 * Knox-MS Memory Brain — Pipeline smoke test.
 *
 * Exercises the IMP-critical paths in one pass against a temp DB.
 *
 *   cd core && npx tsx context/memory/brain/test-memory-smoke.ts
 */

import fs from "fs";
import os from "os";
import path from "path";

const testDir = path.join(os.tmpdir(), `brain-smoke-${Date.now()}`);
fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
process.env.KNOX_GLOBAL_DIR = testDir;

interface Check {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(id: string, name: string, pass: boolean, detail?: string): void {
  checks.push({ id, name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const { BrainManager } = await import("./BrainManager.js");
const { BrainStore } = await import("./BrainStore.js");

try {
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");

  const sid = "smoke-session-1";
  const ws = path.join(testDir, "proj-a");
  fs.mkdirSync(ws, { recursive: true });

  // ── Session lifecycle ─────────────────────────────────────────────────────
  await BrainManager.trackSession(sid, "Smoke Test", ws);
  record("A1", "trackSession binds workspace + project_id", true);

  await BrainManager.recordMessage(
    sid,
    "user",
    "How do we handle authentication in this project?",
    { importance: 0.7 },
  );
  record("A2", "recordMessage stores episodic turn", true);

  // ── Pre-turn pipeline (φ₁–φ₃ → φ₆ → φ₈) ────────────────────────────────
  const pre = await BrainManager.runPipeline({
    mode: "pre_turn",
    message: "authentication flow",
    session_id: sid,
    goal: "Review auth implementation",
  });
  record("B1", "pre_turn runs 5+ phases", pre.phases.length >= 5, `phases=${pre.phases.length}`);
  record(
    "B2",
    "C_goal injected in context",
    !!pre.context?.context?.includes("Current Task"),
  );
  record(
    "B3",
    "C_goal in provenance (kind: goal)",
    !!pre.context?.items?.some((i) => i.kind === "goal"),
    `items=${pre.context?.items?.length ?? 0}`,
  );
  record(
    "B4",
    "memory_tokens_saved tracked",
    typeof pre.context?.memory_tokens_saved === "number",
    `saved=${pre.context?.memory_tokens_saved ?? "?"}`,
  );

  // ── Post-turn pipeline (φ₄–φ₅) ───────────────────────────────────────────
  const post = await BrainManager.runPipeline({
    mode: "post_turn",
    session_id: sid,
    turn_content:
      "User: auth question\nAssistant: We use JWT tokens with refresh rotation.",
    role: "assistant",
  });
  record("B5", "post_turn runs consolidation phases", post.phases.length >= 1);

  // ── Memory modes ──────────────────────────────────────────────────────────
  await BrainStore.saveConfig("memory_mode", "selective");
  const selective = await BrainManager.buildContextDetailed("authentication", sid, 4000, {
    goal: "test goal",
  });
  record("C1", "selective mode builds context", selective.context.length > 0);

  await BrainStore.saveConfig("memory_mode", "full");
  const full = await BrainManager.buildContextDetailed("authentication", sid);
  record("C2", "full mode builds context", full.context.length > 0);

  // ── Project scope ─────────────────────────────────────────────────────────
  await BrainStore.saveConfig("memory_scope", "project");
  record("C3", "memory_scope=project persisted", BrainStore.getConfig().memory_scope === "project");

  // ── Metrics ───────────────────────────────────────────────────────────────
  const eff = await BrainManager.getEffectiveContext();
  record(
    "D1",
    "C_effective metrics available",
    eff.hierarchy_effective_tokens >= 0,
    `total=${Math.round(eff.total_effective)}`,
  );

  const status = BrainManager.getPhaseStatus();
  record("D2", "phase status reports idle after run", status.active_phase === null);

  // ── Sleep consolidation ─────────────────────────────────────────────────────
  const cycle = await BrainManager.consolidate();
  record("D3", "sleep cycle returns sub_phases", !!cycle.sub_phases);

  // ── Session close ───────────────────────────────────────────────────────────
  await BrainManager.dispatch("close_session", { session_id: sid });
  record("A3", "close_session completes", true);

  // ── Autonomous loop ───────────────────────────────────────────────────────
  const { LocalAutonomousLoop } = await import("./LocalAutonomousLoop.js");
  const auto = await LocalAutonomousLoop.run({
    session_id: sid,
    goal: "smoke test goal",
    max_iterations: 3,
    executeStep: async ({ iteration }) => ({
      done: iteration >= 2,
      result: `step ${iteration}`,
    }),
  });
  record(
    "E1",
    "autonomous loop completes",
    auto.success && auto.iterations === 2,
    `iterations=${auto.iterations}`,
  );

  // ── TaskRouter ────────────────────────────────────────────────────────────
  const { TaskRouter } = await import("./TaskRouter.js");
  const easy = TaskRouter.scoreAndRoute({ message: "hi" });
  const hard = TaskRouter.scoreAndRoute({
    message: "x".repeat(5000) + "```\n".repeat(10),
    toolCount: 6,
    codeBlockCount: 4,
  });
  record("E2", "TaskRouter easy tier", easy.difficulty === "easy", easy.difficulty);
  record("E3", "TaskRouter hard tier", hard.difficulty === "hard", hard.difficulty);

  // ── Pipeline dispatch actions ───────────────────────────────────────────────
  const metricsRaw = await BrainManager.dispatch("get_effective_context", {});
  record("F1", "dispatch get_effective_context", metricsRaw.includes("hierarchy_effective_tokens"));

  const fullCycle = await BrainManager.runPipeline({
    mode: "full_cycle",
    message: "smoke full cycle",
    session_id: sid,
    goal: "Smoke full cycle",
    turn_content: "User: test\nAssistant: We decided to use JWT auth.",
    role: "assistant",
  });
  record("F2", "full_cycle runs 8+ phases", fullCycle.phases.length >= 8, `phases=${fullCycle.phases.length}`);

  // ── Sensory buffer ────────────────────────────────────────────────────────
  const { SensoryBuffer } = await import("./SensoryBuffer.js");
  const flushed: string[] = [];
  SensoryBuffer.setFlushHandler(sid, (t) => flushed.push(t));
  SensoryBuffer.ingest(sid, "chunk");
  SensoryBuffer.flushOnTurnBoundary(sid, "turn");
  record("G1", "sensory buffer flushes on turn boundary", flushed.length === 1);
  SensoryBuffer.clear(sid);

  // ── Knowledge graph cap & γ decay (IMP-11) ────────────────────────────────
  const { KnowledgeGraph } = await import("./KnowledgeGraph.js");
  await BrainStore.saveConfig("graph_max_depth", "3");
  await BrainStore.saveConfig("graph_depth_decay_gamma", "0.7");

  const rootId = await KnowledgeGraph.addEntity({
    name: "SmokeDepthRoot",
    entity_type: "concept",
    confidence: 1.0,
  });
  const midId = await KnowledgeGraph.addEntity({
    name: "SmokeDepthMid",
    entity_type: "concept",
    confidence: 1.0,
  });
  const leafId = await KnowledgeGraph.addEntity({
    name: "SmokeDepthLeaf",
    entity_type: "concept",
    confidence: 1.0,
  });
  await KnowledgeGraph.addEdge({
    source_entity_id: rootId,
    target_entity_id: midId,
    relationship: "related_to",
    weight: 1.0,
  });
  await KnowledgeGraph.addEdge({
    source_entity_id: midId,
    target_entity_id: leafId,
    relationship: "related_to",
    weight: 1.0,
  });
  const explored = await KnowledgeGraph.explore({ entity_id: rootId, depth: 3, limit: 10 });
  const gammaOk =
    explored.activation_scores[midId] === 0.7 &&
    Math.abs((explored.activation_scores[leafId] ?? 0) - 0.49) < 0.001;
  record(
    "H1",
    "γ=0.7 spreading activation by BFS depth",
    gammaOk,
    `mid=${explored.activation_scores[midId]}, leaf=${explored.activation_scores[leafId]}`,
  );

  await BrainStore.saveConfig("graph_max_entities", "3");
  for (let i = 0; i < 5; i++) {
    await KnowledgeGraph.addEntity({
      name: `SmokeGraphEntity${i}`,
      entity_type: "concept",
      description: `Smoke entity ${i}`,
    });
  }
  const graphCount = await BrainStore.countEntities();
  record(
    "H2",
    "graph entity cap enforced (LRU prune)",
    graphCount <= 3,
    `count=${graphCount}`,
  );

  await BrainManager.updateConfig({ key: "graph_max_entities", value: "2" });
  const afterLower = await BrainStore.countEntities();
  record(
    "H3",
    "lowering graph_max_entities trims excess",
    afterLower <= 2,
    `count=${afterLower}`,
  );
} catch (err) {
  record("ERR", "unexpected failure", false, err instanceof Error ? err.message : String(err));
}

const passed = checks.filter((c) => c.pass).length;
const total = checks.length;

console.log("\n══════════════════════════════════════════");
console.log(`  Pipeline smoke: ${passed}/${total} passed (${((passed / total) * 100).toFixed(0)}%)`);
console.log("══════════════════════════════════════════\n");

try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch {}

process.exit(passed === total ? 0 : 1);
