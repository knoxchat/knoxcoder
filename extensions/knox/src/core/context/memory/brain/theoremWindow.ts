/**
 * Published bench window for the Overview (MEM-10 / MEM-40–42).
 *
 * Rec / H_0.85 / σ / ε_* are optional until a bench or self-improve run
 * writes `theorem-window.json` next to the brain. Checkpoints are not this
 * file and this file is not C_addr.
 */
import fs from "fs";
import path from "path";

import { getMemoryBrainPath } from "../../../util/paths.js";

export const THEOREM_WINDOW_FILENAME = "theorem-window.json";

export interface PublishedTheoremWindow {
  rec_rolling?: number;
  h_0_85?: number;
  sigma?: number;
  epsilon_b?: number | null;
  epsilon_b_note?: string;
  epsilon_s?: number;
  theorem_held?: boolean;
  published_at: string;
  source?: string;
}

export function theoremWindowPath(dir?: string): string {
  return path.join(dir ?? getMemoryBrainPath(), THEOREM_WINDOW_FILENAME);
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function readEpsilonB(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && /n\/a/i.test(value)) return null;
  return readFinite(value);
}

/** Own-key pick so `epsilon_b: null` (flat FTS) is not dropped by `??`. */
function firstOwn(rec: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
  }
  return undefined;
}

export function publishTheoremWindow(
  window: Omit<PublishedTheoremWindow, "published_at"> & { published_at?: string },
  dir?: string,
): string {
  const dest = theoremWindowPath(dir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body: PublishedTheoremWindow = {
    ...window,
    published_at: window.published_at ?? new Date().toISOString(),
  };
  fs.writeFileSync(dest, `${JSON.stringify(body, null, 2)}\n`);
  return dest;
}

export function loadPublishedTheoremWindow(dir?: string): PublishedTheoremWindow | undefined {
  const dest = theoremWindowPath(dir);
  if (!fs.existsSync(dest)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(dest, "utf8")) as Record<string, unknown>;
    const rec = readFinite(raw.rec_rolling ?? raw.rec ?? raw.recallAtK);
    const horizon = readFinite(raw.h_0_85 ?? raw.h085 ?? raw.answerable_horizon);
    const sigma = readFinite(raw.sigma);
    const epsilonB = readEpsilonB(firstOwn(raw, "epsilon_b", "epsilonB"));
    const epsilonS = readFinite(raw.epsilon_s ?? raw.epsilonS);
    const note = typeof raw.epsilon_b_note === "string" && raw.epsilon_b_note.trim()
      ? raw.epsilon_b_note.trim()
      : undefined;
    if (
      rec === undefined &&
      horizon === undefined &&
      sigma === undefined &&
      epsilonB === undefined &&
      epsilonS === undefined
    ) {
      return undefined;
    }
    const published: PublishedTheoremWindow = {
      published_at: typeof raw.published_at === "string" ? raw.published_at : new Date(0).toISOString(),
    };
    if (rec !== undefined) published.rec_rolling = rec;
    if (horizon !== undefined) published.h_0_85 = horizon;
    if (sigma !== undefined) published.sigma = sigma;
    if (epsilonB !== undefined) published.epsilon_b = epsilonB;
    if (note) published.epsilon_b_note = note;
    if (epsilonS !== undefined) published.epsilon_s = epsilonS;
    if (typeof raw.theorem_held === "boolean") published.theorem_held = raw.theorem_held;
    if (typeof raw.source === "string" && raw.source.trim()) published.source = raw.source.trim();
    return published;
  } catch {
    return undefined;
  }
}
