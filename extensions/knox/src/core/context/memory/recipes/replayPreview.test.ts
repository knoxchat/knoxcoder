import { describe, expect, it } from "vitest";

import { decide } from "../../../agent/decisionEngine";
import { driftAction, formatReplayPreview, previewReplay, REPLAY_APPLY_LATENCY_NOTE, type PreviewPorts } from "./replayPreview";
import { replayExact, type ReplayPorts } from "./replayer";
import type { Recipe } from "./types";

const BASE = "l1\nl2\nl3\nl4\nl5";
const RESULT = "l1\nl2\nl3\nl4\nl5\nl6";
const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z" };

const recipe: Recipe = {
  id: "r".repeat(64),
  projectId: "p",
  scope: "project",
  status: "verified",
  title: "Add l6",
  intentText: "",
  intentFingerprint: "add l6",
  slots: [],
  preconditions: [],
  steps: [{ kind: "write_file", path: "src/a.ts", blobHash: "h-res", baseBlobHash: "h-base" }],
  sourceCheckpointIds: [],
  oracle,
  stats: { replays: 3, ok: 3, reverted: 0, failedVerify: 0 },
  captureCount: 2,
  createdAt: "",
  updatedAt: "",
};

const blobs: Record<string, string> = { "h-res": RESULT, "h-base": BASE };
const hashOf = (t: string) => (t === BASE ? "h-base" : t === RESULT ? "h-res" : `x:${t}`);

function ports(disk: Map<string, string>): PreviewPorts & ReplayPorts & { writes: Record<string, string> } {
  const writes: Record<string, string> = {};
  return {
    writes,
    readBlob: async (h) => blobs[h],
    currentHash: async (p) => (disk.has(p) ? hashOf(disk.get(p)!) : undefined),
    readCurrent: async (p) => disk.get(p),
    createCheckpoint: async () => "cp",
    restoreCheckpoint: async () => {},
    writeFile: async (p, c) => {
      writes[p] = String(c);
      disk.set(p, String(c));
      return { ok: true };
    },
    deleteFile: async () => ({ ok: true }),
    runCommand: async () => ({ ok: true }),
    verify: async () => ({ ok: true }),
  };
}

const match = (r: Recipe) => ({ recipe: r, score: 1, reason: "fingerprint_exact" as const, why: "", fingerprintSimilarity: 1, fusionScore: 1, replayable: true });
const okPre = { ok: true, failures: [], summary: "" };

describe("previewReplay", () => {
  it("previews a clean replay as an exact apply with a diff", async () => {
    const p = await previewReplay(recipe, ports(new Map([["src/a.ts", BASE]])));
    expect(p.entries[0]).toMatchObject({ action: "modify", added: 1, removed: 0 });
    expect(p.drifted).toBe(false);
    expect(driftAction(p)).toBe("exact");
    const text = formatReplayPreview(p);
    expect(text).toContain(REPLAY_APPLY_LATENCY_NOTE);
    expect(text).toContain("+l6");
    expect(text).toContain("src/a.ts");
  });

  it("reports unchanged when already applied", async () => {
    const p = await previewReplay(recipe, ports(new Map([["src/a.ts", RESULT]])));
    expect(p.entries[0].action).toBe("unchanged");
    expect(p.totals.files).toBe(0);
  });

  it("merges non-overlapping user edits and replays the merged bytes", async () => {
    const disk = new Map([["src/a.ts", BASE.replace("l1", "USER")]]);
    const pr = ports(disk);
    const p = await previewReplay(recipe, pr);
    expect(p.entries[0].action).toBe("merge");
    expect(driftAction(p)).toBe("merge");
    const res = await replayExact(recipe, pr, { merged: p.merged });
    expect(res.status).toBe("applied");
    expect(pr.writes["src/a.ts"]).toBe("USER\nl2\nl3\nl4\nl5\nl6");
  });

  it("conflict fixture picks adapt and exact replay refuses", async () => {
    const disk = new Map([["src/a.ts", `${BASE}\nUSER TAIL`]]);
    const pr = ports(disk);
    const p = await previewReplay(recipe, pr);
    expect(p.entries[0].action).toBe("conflict");
    expect(driftAction(p)).toBe("adapt");
    const d = decide({ match: match(recipe), preconditions: okPre, autoReplay: "exact", drifted: p.drifted });
    expect(d.mode).toBe("adapt");
    expect((await replayExact(recipe, pr)).status).toBe("drifted");
  });

  it("does not preview a refused recipe", async () => {
    const p = await previewReplay({ ...recipe, status: "candidate" }, ports(new Map()));
    expect(p.allowed).toBe(false);
    expect(formatReplayPreview(p)).toMatch(/refused/);
  });
});
