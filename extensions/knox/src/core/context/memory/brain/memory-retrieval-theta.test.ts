/**
 * MEM-22 — fused candidates 50, then calibrated θ = 0.35.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEXICAL_SCORE_MIN } from "./RelevanceGate.js";
import {
  activeFusionChannels,
  calibratedScoreCutoff,
  fuseCandidateScore,
  leftoverAdditiveScore,
  normalizeFusedScore,
  passesCalibratedTheta,
  REL02_ADDITIVE_FLOOR,
  rrfCeiling,
  rrfScore,
  FUSION_CANDIDATE_CUTOFF_DEFAULT,
  RETRIEVAL_THRESHOLD_DEFAULT,
  RRF_CHANNEL_WEIGHTS_DEFAULT,
  RRF_K0_DEFAULT,
  type FusionResult,
} from "./RetrievalFusion.js";
import { getFusionWeights } from "./memoryConfigAccess.js";

const testDir = path.join(os.tmpdir(), `brain-mem22-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

describe("MEM-22 calibrated θ (pure)", () => {
  it("defaults are fused candidates 50 then θ = 0.35", () => {
    expect(FUSION_CANDIDATE_CUTOFF_DEFAULT).toBe(50);
    expect(RETRIEVAL_THRESHOLD_DEFAULT).toBe(0.35);
  });

  it("θ is a fraction of the active-channel RRF ceiling, not raw 1/61", () => {
    const lexical = rrfCeiling(RRF_CHANNEL_WEIGHTS_DEFAULT, RRF_K0_DEFAULT, ["lexical"]);
    expect(lexical).toBeCloseTo(1 / 61, 10);
    expect(calibratedScoreCutoff(0.35, RRF_CHANNEL_WEIGHTS_DEFAULT, RRF_K0_DEFAULT, ["lexical"]))
      .toBeCloseTo(0.35 / 61, 10);

    const rank1 = rrfScore({ lexical: 1 });
    expect(normalizeFusedScore(rank1, lexical)).toBeCloseTo(1, 10);
    expect(passesCalibratedTheta(rank1, 0.35, lexical)).toBe(true);
    expect(passesCalibratedTheta(rank1 * 0.3, 0.35, lexical)).toBe(false);
    expect(passesCalibratedTheta(0, 0.35, lexical)).toBe(false);
    expect(passesCalibratedTheta(rank1 * 0.3, 0.35, lexical, true)).toBe(true);
  });

  it("REL-03 lexical floor still zeros graph-only and importance-only misses", () => {
    const ceiling = rrfCeiling(RRF_CHANNEL_WEIGHTS_DEFAULT, RRF_K0_DEFAULT, ["lexical", "graph"]);
    expect(
      fuseCandidateScore({ fts5: 0, trigram: 0, graph: 1, recency: 1, importance: 1 }),
    ).toBe(0);
    expect(
      fuseCandidateScore({
        fts5: LEXICAL_SCORE_MIN - 0.01,
        trigram: 0,
        graph: 1,
        recency: 1,
        importance: 1,
      }),
    ).toBe(0);
    expect(
      passesCalibratedTheta(
        fuseCandidateScore({ fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 }),
        0.35,
        ceiling,
      ),
    ).toBe(false);
    expect(REL02_ADDITIVE_FLOOR).toBe(0.6);
    expect(
      leftoverAdditiveScore(
        { fts5: 0, trigram: 0, graph: 0, recency: 1, importance: 1 },
        getFusionWeights("conversational"),
        REL02_ADDITIVE_FLOOR,
      ),
    ).toBeLessThan(REL02_ADDITIVE_FLOOR);
    expect(
      leftoverAdditiveScore(
        { fts5: 0.2, trigram: 0, graph: 0, recency: 1, importance: 1 },
        getFusionWeights("conversational"),
        REL02_ADDITIVE_FLOOR,
      ),
    ).toBeLessThan(REL02_ADDITIVE_FLOOR);
  });

  it("active channels ignore ranks that never fired", () => {
    const results: Array<Pick<FusionResult, "ranks">> = [
      { ranks: { lexical: 1 } },
      { ranks: { lexical: 2 } },
    ];
    expect(activeFusionChannels(results)).toEqual(["lexical"]);
    expect(
      rrfCeiling(RRF_CHANNEL_WEIGHTS_DEFAULT, RRF_K0_DEFAULT, activeFusionChannels(results)),
    ).toBeCloseTo(1 / 61, 10);
  });
});

describe("MEM-22 calibrated θ search wiring", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_collection_items");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_associations");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_sessions");
    await BrainStore.reloadConfig();
  }

  it("live defaults are retrieval_top_k=50, fusion_candidate_cutoff=50, θ=0.35", async () => {
    await BrainStore.reloadConfig();
    const cfg = BrainStore.getConfig();
    expect(cfg.retrieval_top_k).toBe(50);
    expect(cfg.fusion_candidate_cutoff).toBe(50);
    expect(cfg.retrieval_threshold).toBe(0.35);
    expect(cfg.calibrated_theta).toBe(0.35);
  });

  it("takes fused candidates then cuts by θ; a miss still scores 0", async () => {
    await reset();
    const sessionId = "mem22-cutoff";
    const token = "quartzthetamem22leaf";
    await BrainManager.trackSession(sessionId, "MEM-22 cutoff", testDir);
    const hitId = await BrainManager.store({
      category: "fact",
      title: `Alpha ${token}`,
      content: `This document is about ${token} specifically.`,
      keywords: token,
      session_id: sessionId,
      importance: 0.8,
    });
    const missId = await BrainManager.store({
      category: "decision",
      title: "Use JWT refresh with OAuth",
      content: "oauth-jwt-refresh-token-omega is the auth approach.",
      keywords: "auth, jwt, oauth, refresh",
      session_id: sessionId,
      importance: 0.99,
    });

    const hits = await RetrievalFusion.search({
      query: `alpha ${token}`,
      includeEpisodic: false,
    });
    const hit = hits.find((h) => h.id === hitId);
    expect(hit).toBeTruthy();
    expect(hit!.ranks?.lexical).toBe(1);
    const ceiling = rrfCeiling(
      RRF_CHANNEL_WEIGHTS_DEFAULT,
      RRF_K0_DEFAULT,
      activeFusionChannels(hits),
    );
    expect(hit!.score).toBeGreaterThanOrEqual(0.35 * ceiling);
    expect(hits.some((h) => h.id === missId)).toBe(false);

    const miss = await RetrievalFusion.search({
      query: "readme-badges-shields-zeta unique docs header",
      minScore: 0.35,
      includeEpisodic: false,
    });
    expect(miss.some((r) => r.id === hitId || r.id === missId)).toBe(false);
  });

  it("does not return more than fusion_candidate_cutoff after θ", async () => {
    await reset();
    await BrainStore.saveConfig("fusion_candidate_cutoff", "3");
    await BrainStore.saveConfig("retrieval_top_k", "50");
    const sessionId = "mem22-cap";
    const token = "quartzthetacapmem22";
    await BrainManager.trackSession(sessionId, "MEM-22 cap", testDir);
    for (let i = 0; i < 8; i++) {
      await BrainManager.store({
        category: "fact",
        title: `${token} leaf ${i}`,
        content: `Document ${i} about ${token} for the fused-candidate cap.`,
        keywords: `${token}, leaf${i}`,
        session_id: sessionId,
        importance: 0.5,
      });
    }

    const hits = await RetrievalFusion.search({
      query: token,
      includeEpisodic: false,
    });
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.every((h) => h.score > 0)).toBe(true);

    await BrainStore.saveConfig("fusion_candidate_cutoff", "50");
    await BrainStore.saveConfig("retrieval_top_k", "50");
  });
});
