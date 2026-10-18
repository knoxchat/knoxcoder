import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage, Tool } from "..";
import { BuiltInToolNames } from "../tools/builtIn";
import { writeFileTool } from "../tools";
import { cleanupTempRepos, makeTempRepo } from "../test/tempRepo";
import { startJob } from "./background";
import { runBackgroundAgent } from "./backgroundRun";

const roots: string[] = [];
const bgRootDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-bg-run-"));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  cleanupTempRepos();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function scriptedLlm(chunks: ChatMessage[][]) {
  let turn = 0;
  return {
    streamChat: async function* () {
      const batch = chunks[Math.min(turn, chunks.length - 1)] ?? [];
      turn += 1;
      for (const chunk of batch) {
        yield chunk;
      }
    },
  };
}

describe("runBackgroundAgent", () => {
  it("runs the agent loop in the worktree and writes files there", async () => {
    const repo = makeTempRepo({ "a.txt": "one\n" });
    const root = bgRootDir();
    const job = startJob({ root, dir: repo, task: "write hello" });
    const result = await runBackgroundAgent(job, new AbortController().signal, {
      llm: scriptedLlm([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "w1",
                type: "function",
                function: {
                  name: BuiltInToolNames.WriteFile,
                  arguments: JSON.stringify({
                    filepath: "a.txt",
                    contents: "hello\n",
                    openAfterWrite: false,
                  }),
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "wrote a.txt" }],
      ]) as never,
      tools: [writeFileTool as Tool],
      deferTools: false,
      permissionMode: "acceptEdits",
    });
    expect(result.stoppedReason).toBe("completed");
    expect(fs.readFileSync(path.join(job.worktree, "a.txt"), "utf-8")).toBe(
      "hello\n",
    );
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\n");
  });
});
