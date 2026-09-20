/**
 * Nested `jev:` block in config.yaml.
 *
 * Mapped onto experimental.jev. Zod on the assistant schema may strip
 * unknown keys, so we also parse the raw YAML here.
 */

import * as YAML from "yaml";
import { z } from "zod";

import type { JevYamlConfig } from "../jev/types";

export const jevYamlSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().min(1).max(64).optional(),
  apiKey: z.string().max(512).optional(),
  timeoutMs: z.number().int().min(50).max(10_000).optional(),
  failOpen: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
});

export function parseJevYamlBlock(raw: unknown): JevYamlConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const parsed = jevYamlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function extractJevYamlFromRaw(rawYaml: string): unknown {
  if (!rawYaml.trim()) {
    return undefined;
  }
  try {
    const doc = YAML.parse(rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      return (doc as { jev?: unknown }).jev;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function loadJevYamlExperimental(
  rawYaml: string,
  overrideJev?: unknown,
): { jev?: JevYamlConfig } {
  const block = parseJevYamlBlock(
    overrideJev !== undefined ? overrideJev : extractJevYamlFromRaw(rawYaml),
  );
  return block ? { jev: block } : {};
}
