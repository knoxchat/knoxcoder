/**
 * Decisions models Knox can send on System One (`POST /v1/systemone`).
 *
 * Jev is TypeSafe (Knox Chat or OpenRouter). Gemini Decision 1 is Google's
 * OpenRouter Decisions model; it only reads media from the top-level `state`
 * array (nested `image_url` parts return 400).
 *
 * @see https://openrouter.ai/docs/guides/community/multimodal-decisions
 * @see https://openrouter.ai/google/gemini-decision-1
 */

import type { JevProvider } from "./types";

/** GUI / vscode catalog id for TypeSafe Jev (mapped onto the live host). */
export const DECISIONS_CATALOG_JEV = "jev";
/** OpenRouter model id for Google Gemini Decision 1. */
export const OPENROUTER_GEMINI_DECISION_MODEL = "google/gemini-decision-1";

export type DecisionsFamily = "jev" | "gemini";

export interface DecisionsModelSpec {
  /** Stable id written to `jev.model` / `knoxchat.jev.model`. */
  catalogId: string;
  family: DecisionsFamily;
  /** Hosts that can serve this model. Gemini Decision 1 is OpenRouter-only. */
  hosts: readonly JevProvider[];
  /**
   * TypeSafe Jev reads `image_url` nested in `state` objects. Every other
   * Decisions adapter only lifts media from the top-level `state` array.
   */
  nestedImages: boolean;
  /** Max `image_url` parts Knox will attach (latency budget, not the provider cap). */
  maxImages: number;
  /** When true, public `https://` image URLs are forwarded (Google fetches them). */
  remoteImageHttps: boolean;
  audio: boolean;
  video: boolean;
  files: boolean;
}

export const DECISIONS_MODELS: readonly DecisionsModelSpec[] = [
  {
    catalogId: DECISIONS_CATALOG_JEV,
    family: "jev",
    hosts: ["knoxchat", "openrouter"],
    nestedImages: true,
    maxImages: 4,
    remoteImageHttps: false,
    audio: false,
    video: false,
    files: false,
  },
  {
    catalogId: OPENROUTER_GEMINI_DECISION_MODEL,
    family: "gemini",
    hosts: ["openrouter"],
    nestedImages: false,
    maxImages: 16,
    remoteImageHttps: true,
    audio: true,
    video: true,
    files: true,
  },
];

const GEMINI_IDS = new Set([
  OPENROUTER_GEMINI_DECISION_MODEL,
  "gemini-decision-1",
  "gemini-decision",
  "google/gemini-decision",
]);

export function isGeminiDecisionModel(model: string | undefined): boolean {
  const id = (model ?? "").trim().toLowerCase();
  if (!id) {
    return false;
  }
  return GEMINI_IDS.has(id) || id.endsWith("/gemini-decision-1");
}

export function decisionsFamily(model: string | undefined): DecisionsFamily {
  return isGeminiDecisionModel(model) ? "gemini" : "jev";
}

export function decisionsModelSpec(model: string | undefined): DecisionsModelSpec {
  const family = decisionsFamily(model);
  const match = DECISIONS_MODELS.find((entry) => entry.family === family);
  if (match) {
    return match;
  }
  return DECISIONS_MODELS[0] as DecisionsModelSpec;
}

/** Catalog id for the Settings picker (`jev` or `google/gemini-decision-1`). */
export function decisionsCatalogId(model: string | undefined): string {
  return decisionsModelSpec(model).catalogId;
}

/**
 * Models the Settings list should show. Jev is always listed. Gemini Decision 1
 * is OpenRouter-only but stays visible so a Knox Chat session can still pick it
 * (the runtime then uses the OpenRouter key).
 */
export function listDecisionsModels(
  _provider?: JevProvider,
): readonly DecisionsModelSpec[] {
  return DECISIONS_MODELS;
}

export function decisionsModelRequiresOpenRouter(
  model: string | undefined,
): boolean {
  return decisionsModelSpec(model).hosts.length === 1
    && decisionsModelSpec(model).hosts[0] === "openrouter";
}

export function decisionsModelReadsNestedImages(
  model: string | undefined,
): boolean {
  return decisionsModelSpec(model).nestedImages;
}

export function decisionsMaxImages(model: string | undefined): number {
  return decisionsModelSpec(model).maxImages;
}

/**
 * Whether this URL can go on `state` as an `image_url` part for `model`.
 * Jev: png/jpeg data URLs only. Gemini Decision 1: any `image/*` data URL or
 * a public `https://` URL.
 */
export function decisionsImageAcceptsUrl(
  url: string,
  model: string | undefined,
): boolean {
  const trimmed = url.trim();
  const spec = decisionsModelSpec(model);
  if (spec.remoteImageHttps && /^https:\/\//i.test(trimmed)) {
    return true;
  }
  if (spec.family === "gemini") {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed);
  }
  return /^data:image\/(png|jpeg);base64,/i.test(trimmed);
}
