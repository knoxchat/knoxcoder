import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { resolveJevRuntime } from "../jev/config";
import type { JevClient, JevSystemOneResult } from "../jev/types";
import {
  scoreEvalTrace,
  scoreTraceFile,
  traceInputFromEvalResult,
  traceInputFromUnknown,
} from "./scoreTraceJob";
import type { AgentEvalResult } from "./harness";

function runtime() {
  return {
    ...resolveJevRuntime({ enabled: true }),
    apiKey: "test-key",
  };
}

function fakeClient(result: JevSystemOneResult): JevClient {
  return {
    async systemOne() {
      return result;
    },
  };
}

const evalResult: AgentEvalResult = {
  stoppedReason: "completed",
  steps: 2,
  summary: "fixed add()",
  files: {},
  toolTrace: [
    {
      name: BuiltInToolNames.EditFile,
      args: { filepath: "src/lib.rs" },
      ok: true,
      output: "ok",
    },
  ],
};

describe("scoreEvalTrace", () => {
  it("maps an eval result onto scoreAgentTrace", async () => {
    const input = traceInputFromEvalResult(evalResult, "Fix add()");
    expect(input.steps[0].name).toBe(BuiltInToolNames.EditFile);

    const scored = await scoreEvalTrace(evalResult, {
      userMessage: "Fix add()",
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          tool_calls_match_request: { type: "noul", noul: 0.9 },
          oracle_ignored: { type: "noul", noul: 0.05 },
          test_tamper: { type: "noul", noul: 0.02 },
          outcome: { type: "choice", choice: "success", confidence: 0.88 },
        },
      }),
    });
    expect(scored?.outcome).toBe("success");
    expect(scored?.source).toBe("jev");
  });

  it("returns undefined for junk payloads", () => {
    expect(traceInputFromUnknown({ foo: 1 })).toBeUndefined();
  });

  it("scores a session JSON file", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "jev-trace-"));
    const file = join(dir, "session.json");
    await writeFile(
      file,
      JSON.stringify({
        userMessage: "Fix add()",
        steps: evalResult.toolTrace,
        stoppedReason: "completed",
      }),
    );
    const scored = await scoreTraceFile(file, {
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          tool_calls_match_request: { type: "noul", noul: 0.9 },
          oracle_ignored: { type: "noul", noul: 0.05 },
          test_tamper: { type: "noul", noul: 0.02 },
          outcome: { type: "choice", choice: "success", confidence: 0.88 },
        },
      }),
    });
    expect(scored?.outcome).toBe("success");
  });
});
