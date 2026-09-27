import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Tool, ToolExtras } from "../..";

import {
  resetCodebaseCardForTests,
  setCodebaseCardInject,
} from "../../context/codebaseCard";
import {
  resetSerialContextForTests,
  setSerialContextInject,
} from "../../context/serialContext";
import { SkillManager } from "../../skills/skillManager";
import { BuiltInToolNames } from "../builtIn";
import { setSkillManager } from "../implementations/skillSingleton";
import { createPlan, resetPlansForTests } from "../planStore";
import {
  buildSubagentContextBlock,
  formatSubagentResult,
  runSubagent,
} from "./runSubagent";

function extras(chunks: ChatMessage[][]): ToolExtras {
  let turn = 0;
  return {
    ide: {} as ToolExtras["ide"],
    llm: {
      streamChat: async function* () {
        const batch = chunks[Math.min(turn, chunks.length - 1)] ?? [];
        turn += 1;
        for (const chunk of batch) {
          yield chunk;
        }
      },
    } as unknown as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: BuiltInToolNames.Task } } as ToolExtras["tool"],
  };
}

const readTool = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;

describe("runSubagent", () => {
  afterEach(() => {
    resetCodebaseCardForTests();
    resetSerialContextForTests();
    resetPlansForTests();
  });

  it("returns a text-only first turn as the summary", async () => {
    const result = await runSubagent({
      prompt: "What is the entry point?",
      profile: "explore",
      extras: extras([
        [{ role: "assistant", content: "src/index.ts is the entry." }],
      ]),
      catalog: [readTool],
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.steps).toBe(0);
    expect(result.summary).toContain("src/index.ts");
    expect(formatSubagentResult(result)).toContain("explore");
  });

  it("recovers leaked fullwidth DSML tool markup and executes the call", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "[package]\nname = \"demo\"" },
    ]);
    const result = await runSubagent({
      prompt: "Read Cargo.toml",
      profile: "explore",
      extras: extras([
        [
          {
            role: "assistant",
            content: `Let me check the manifest.
<\uFF5CDSML\uFF5Ctool_calls>
<\uFF5CDSML\uFF5Cinvoke name="builtin_read_file">
<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Ctool_calls>`,
          },
        ],
        [{ role: "assistant", content: "Cargo.toml names the crate demo." }],
      ]),
      catalog: [readTool],
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.filesTouched).toContain("Cargo.toml");
    expect(result.stoppedReason).toBe("completed");
    expect(result.summary).toContain("demo");
  });

  it("executes a child tool then summarizes", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "export const x = 1;" },
    ]);
    const result = await runSubagent({
      prompt: "Read x.ts",
      profile: "explore",
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: '{"filepath":"x.ts"}',
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "x.ts exports x." }],
      ]),
      catalog: [readTool],
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.filesTouched).toContain("x.ts");
    expect(result.stoppedReason).toBe("completed");
    expect(result.summary).toContain("exports x");
  });

  it("injects plan, codebase card, and serial into the child system prompt", async () => {
    setCodebaseCardInject("## Codebase Card\nmake ARCH=arm64");
    setSerialContextInject("## Serial / dmesg\nRIP: copy_to_user");
    createPlan({
      sessionId: "sess-sub",
      title: "boot panic",
      steps: ["fix oops in mm"],
    });
    const block = await buildSubagentContextBlock({
      prompt: "Where is copy_to_user?",
      sessionId: "sess-sub",
    });
    expect(block).toMatch(/Codebase Card/);
    expect(block).toMatch(/make ARCH=arm64/);
    expect(block).toMatch(/Task Execution Plan/);
    expect(block).toMatch(/fix oops in mm/);
    expect(block).toMatch(/RIP: copy_to_user/);

    let system = "";
    const captured = extras([
      [{ role: "assistant", content: "mm/filemap.c" }],
    ]);
    captured.soul = { sessionId: "sess-sub" };
    captured.llm = {
      streamChat: async function* (messages: ChatMessage[]) {
        const first = messages[0]?.content;
        system = typeof first === "string" ? first : "";
        yield { role: "assistant" as const, content: "mm/filemap.c" };
      },
    } as unknown as ToolExtras["llm"];
    await runSubagent({
      prompt: "Where is copy_to_user?",
      profile: "explore",
      extras: captured,
      catalog: [readTool],
      executeTool: vi.fn(),
    });
    expect(system).toMatch(/Codebase Card/);
    expect(system).toMatch(/Task Execution Plan/);
    expect(system).toMatch(/RIP: copy_to_user/);
  });

  it("suggests linux-kernel when the child prompt is a boot panic", async () => {
    const manager = new SkillManager({
      workspaceDirs: ["/tmp/nonexistent-knox-skills-ws"],
      disableExternalSkills: true,
    });
    await manager.load();
    setSkillManager(manager);
    const block = await buildSubagentContextBlock({
      prompt: "boot panic in mm",
      sessionId: "sess-sub",
    });
    expect(block).toMatch(/Suggested Skills/);
    expect(block).toMatch(/linux-kernel/);
  });

  it("does not execute write tools on explore", async () => {
    const executeTool = vi.fn();
    const result = await runSubagent({
      prompt: "Edit it",
      profile: "explore",
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: BuiltInToolNames.EditFile,
                  arguments: '{"filepath":"x.ts"}',
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "Could not edit." }],
      ]),
      catalog: [readTool],
      executeTool,
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.summary).toContain("Could not edit");
  });

  it("rejects an empty prompt", async () => {
    const result = await runSubagent({
      prompt: "   ",
      extras: extras([]),
      catalog: [],
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("error");
  });
});
