import { describe, expect, it } from "vitest";

import {
  agentYamlToExperimental,
  extractAgentYamlFromRaw,
  loadAgentYamlExperimental,
  parseAgentYamlBlock,
} from "./agentYaml";

const SAMPLE = `
name: Knox
version: 1.0.0
agent:
  profile: systems
  maxSteps: 120
  doomLoopThreshold: 5
  verify:
    mode: command
    command: "make -j8"
    maxIterations: 8
  jobs:
    logDir: ~/.knoxcoder/jobs
    awaitTimeoutMs: 600000
`;

describe("agent YAML config surface", () => {
  it("maps the suggested nested agent: block onto experimental fields", () => {
    const experimental = loadAgentYamlExperimental(SAMPLE);
    expect(experimental).toEqual({
      agentProfile: "systems",
      agentMaxSteps: 120,
      agentDoomLoopThreshold: 5,
      agentVerifyMode: "command",
      agentVerifyCommand: "make -j8",
      agentVerifyMaxIterations: 8,
      agentJobsLogDir: "~/.knoxcoder/jobs",
      agentJobsAwaitTimeoutMs: 600_000,
    });
  });

  it("strips unknown agent keys and rejects invalid values", () => {
    expect(
      parseAgentYamlBlock({
        profile: "systems",
        extra: true,
      }),
    ).toEqual({ profile: "systems" });
    expect(parseAgentYamlBlock({ profile: "rust" })).toEqual({
      profile: "rust",
    });
    expect(parseAgentYamlBlock({ profile: "nope" })).toBeUndefined();
    expect(agentYamlToExperimental(undefined)).toEqual({});
  });

  it("reads agent: from raw YAML even when the assistant schema would strip it", () => {
    expect(extractAgentYamlFromRaw(SAMPLE)).toMatchObject({
      profile: "systems",
      verify: { command: "make -j8" },
    });
    expect(extractAgentYamlFromRaw("name: x\nversion: 0\n")).toBeUndefined();
  });
});
