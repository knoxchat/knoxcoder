/**
 * Nested `agent:` block in config.yaml (harness-loops suggested surface).
 *
 * Mapped onto experimental.agent* so VS Code settings / shared config can
 * still overlay. Zod on the assistant schema strips unknown keys, so we
 * also parse the raw YAML here.
 */

import * as YAML from "yaml";
import { z } from "zod";

export const agentYamlSchema = z.object({
  profile: z.enum(["default", "systems", "rust", "auto"]).optional(),
  maxSteps: z.number().int().min(0).max(1000).optional(),
  doomLoopThreshold: z.number().int().min(0).max(20).optional(),
  verify: z
    .object({
      mode: z.enum(["diagnostics", "command", "off"]).optional(),
      command: z.string().optional(),
      maxIterations: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  jobs: z
    .object({
      logDir: z.string().optional(),
      awaitTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    })
    .optional(),
});

export type AgentYamlConfig = z.infer<typeof agentYamlSchema>;

export interface AgentYamlExperimental {
  agentProfile?: "default" | "systems" | "rust" | "auto";
  agentMaxSteps?: number;
  agentDoomLoopThreshold?: number;
  agentVerifyMode?: "diagnostics" | "command" | "off";
  agentVerifyCommand?: string;
  agentVerifyMaxIterations?: number;
  agentJobsLogDir?: string;
  agentJobsAwaitTimeoutMs?: number;
}

export function parseAgentYamlBlock(raw: unknown): AgentYamlConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const parsed = agentYamlSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Pull `agent:` from a config.yaml string (keys the assistant schema strips). */
export function extractAgentYamlFromRaw(rawYaml: string): unknown {
  if (!rawYaml.trim()) {
    return undefined;
  }
  try {
    const doc = YAML.parse(rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      return (doc as { agent?: unknown }).agent;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function agentYamlToExperimental(
  agent: AgentYamlConfig | undefined,
): AgentYamlExperimental {
  if (!agent) {
    return {};
  }
  const out: AgentYamlExperimental = {};
  if (agent.profile) {
    out.agentProfile = agent.profile;
  }
  if (agent.maxSteps !== undefined) {
    out.agentMaxSteps = agent.maxSteps;
  }
  if (agent.doomLoopThreshold !== undefined) {
    out.agentDoomLoopThreshold = agent.doomLoopThreshold;
  }
  if (agent.verify?.mode) {
    out.agentVerifyMode = agent.verify.mode;
  }
  if (typeof agent.verify?.command === "string") {
    out.agentVerifyCommand = agent.verify.command;
  }
  if (agent.verify?.maxIterations !== undefined) {
    out.agentVerifyMaxIterations = agent.verify.maxIterations;
  }
  const logDir = agent.jobs?.logDir?.trim();
  if (logDir) {
    out.agentJobsLogDir = logDir;
  }
  if (agent.jobs?.awaitTimeoutMs !== undefined) {
    out.agentJobsAwaitTimeoutMs = agent.jobs.awaitTimeoutMs;
  }
  return out;
}

export function loadAgentYamlExperimental(
  rawYaml: string,
  overrideAgent?: unknown,
): AgentYamlExperimental {
  const block = parseAgentYamlBlock(
    overrideAgent !== undefined
      ? overrideAgent
      : extractAgentYamlFromRaw(rawYaml),
  );
  return agentYamlToExperimental(block);
}
