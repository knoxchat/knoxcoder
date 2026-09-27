import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as orchestration from "../tools/orchestration";
import { unimplementedAdvancedTools } from "../tools/definitions/advanced";
import {
  hasToolImplementation,
  listImplementedToolNames,
} from "../tools/callTool";
import { allAvailableTools, allTools } from "../tools";

const here = path.dirname(fileURLToPath(import.meta.url));
/** KnoxCoder repo root: `extensions/knox/src/core/eval` → five levels up. */
const repoRoot = path.resolve(here, "../../../../..");

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function readEval(rel: string): string {
  return readFileSync(path.join(here, rel), "utf8");
}

describe("agent honesty gate", () => {
  it("does not export SmartToolRouter or smartExecute from the public orchestration surface", () => {
    expect(
      Object.prototype.hasOwnProperty.call(orchestration, "SmartToolRouter"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(orchestration, "smartExecute"),
    ).toBe(false);
    expect(
      (orchestration as { SmartToolRouter?: unknown }).SmartToolRouter,
    ).toBeUndefined();
    expect(
      (orchestration as { smartExecute?: unknown }).smartExecute,
    ).toBeUndefined();
  });

  it("keeps every allTools / allAvailableTools entry routed through callTool", () => {
    for (const tool of [...allTools, ...allAvailableTools]) {
      expect(
        hasToolImplementation(tool.function.name),
        `${tool.function.name} missing callTool impl`,
      ).toBe(true);
    }
  });

  it("does not expose quarantined advanced defs on the product catalogs", () => {
    const product = new Set(
      [...allTools, ...allAvailableTools].map((tool) => tool.function.name),
    );
    const implemented = new Set(listImplementedToolNames());
    for (const tool of unimplementedAdvancedTools) {
      expect(product.has(tool.function.name)).toBe(false);
      expect(implemented.has(tool.function.name)).toBe(false);
    }
  });

  it("docs do not claim SmartToolRouter is the default chat path", () => {
    const docs = [
      "extensions/knox/src/core/tools/CUSTOM_TOOLS.md",
      "extensions/knox/src/core/tools/orchestration/README.md",
      "extensions/knox/src/core/tools/orchestration/index.ts",
    ];
    for (const rel of docs) {
      const text = readRepo(rel);
      expect(text, rel).toMatch(/not exported|callTool/i);
      expect(text, `${rel} still says "let smart routing choose"`).not.toMatch(
        /let smart routing choose/i,
      );
      for (const sentence of text.split(/[.\n]/)) {
        if (!/smarttoolrouter/i.test(sentence)) {
          continue;
        }
        const claimsDefault = /default (chat |agent |product )?path/i.test(
          sentence,
        );
        const negated =
          /\bnot\b|never|do not|don't|unexported|experimental/i.test(sentence);
        expect(
          claimsDefault && !negated,
          `${rel} claims SmartToolRouter is the default path: ${sentence.trim()}`,
        ).toBe(false);
      }
    }
  });

  it("PR template includes the agent honesty checklist", () => {
    const template = readRepo(".github/pull_request_template.md");
    expect(template).toMatch(/callTool/i);
    expect(template).toMatch(/SmartToolRouter/i);
    expect(template).toMatch(/allTools|allAvailableTools/);
    expect(template).toMatch(/test/i);
  });

  it("documents builtin_plan as the product planning path (HL-17/38)", () => {
    const agentReadme = readRepo("extensions/knox/src/host/agent/README.md");
    expect(agentReadme).toMatch(/builtin_plan/);
    expect(agentReadme).toMatch(/legacy/i);
    expect(agentReadme).toMatch(/ReasoningEngine/);
  });

  it("eval harness is a scripted model (no live LLM in CI)", () => {
    const harness = readEval("harness.ts");
    expect(harness).toContain("createScriptedLlm");
    expect(harness).toContain("eval-scripted");
    expect(harness).not.toMatch(/api\.knoxstudio\.ai|api\.openai|api\.anthropic/);

    const evalTests = readdirSync(here).filter((name) => name.endsWith(".test.ts"));
    expect(evalTests).toEqual(
      expect.arrayContaining([
        "goldenTasks.test.ts",
        "systemsTasks.test.ts",
        "rustTasks.test.ts",
        "honestyGate.test.ts",
      ]),
    );
    for (const file of evalTests) {
      const text = readEval(file);
      expect(text, file).not.toMatch(/from ["']\.\.\/llm\/llms/);
      expect(text, file).not.toMatch(/api\.knoxstudio\.ai|api\.openai\.com|api\.anthropic\.com/);
    }
  });

  it("golden / systems / rust tests do not import live Jev scoring", () => {
    for (const file of [
      "goldenTasks.test.ts",
      "systemsTasks.test.ts",
      "rustTasks.test.ts",
      "autonomousTools.test.ts",
    ]) {
      const text = readEval(file);
      expect(text, file).not.toMatch(/scoreEvalTrace|scoreTraceFile|scoreAgentTrace/);
    }
  });
});
