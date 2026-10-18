import { describe, expect, it } from "vitest";

import {
  compactMessages,
  compactMessagesAsync,
  CONVERSATION_SUMMARY_MARKER,
} from "../compaction";
import type { ChatMessage } from "../index.js";
import { BuiltInToolNames } from "../tools/builtIn";
import { runAgentEval } from "./harness";

const ADD_BUG = `export function add(a: number, b: number): number {
  return a - b;
}
`;

const ADD_FIXED = `export function add(a: number, b: number): number {
  return a + b;
}
`;

function user(content: string): ChatMessage {
  return { role: "user", content };
}
function assistant(content: string): ChatMessage {
  return { role: "assistant", content };
}
function system(content: string): ChatMessage {
  return { role: "system", content };
}

/** Long session whose early turn names the file and the bug that must survive. */
function longTaskHistory(): ChatMessage[] {
  const msgs: ChatMessage[] = [
    system("You are a helpful coding assistant."),
    user(
      "Fix add() in src/add.ts — it currently subtracts. TOKEN_BUCKET_CAPACITY is unrelated filler.",
    ),
    assistant("I will edit src/add.ts and change subtraction to addition."),
  ];
  for (let i = 0; i < 16; i++) {
    msgs.push(user(`Side task ${i}: tweak comments in notes${i}.md `.repeat(12)));
    msgs.push(assistant(`Updated notes${i}.md without touching src/add.ts. `.repeat(8)));
  }
  msgs.push(user("Continue: apply the add() fix we discussed in src/add.ts"));
  return msgs;
}

describe("compaction quality eval (P1-7)", () => {
  it("keeps the original file+intent through compaction so a scripted edit still lands", async () => {
    const compacted = compactMessages(
      longTaskHistory(),
      "gpt-4o",
      4_000,
      500,
      0,
      100,
      { preserveRecentCount: 2, maxHistoryRatio: 0.45 },
    );

    expect(compacted.tokensSaved).toBeGreaterThan(0);
    expect(compacted.summarized).toBe(true);
    const joined = compacted.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("src/add.ts");
    expect(joined).toContain(CONVERSATION_SUMMARY_MARKER);
    expect(joined).toMatch(/Continue: apply the add\(\) fix/);

    const result = await runAgentEval({
      systemPrompt: joined.slice(0, 4000),
      prompt: "Continue: apply the add() fix we discussed in src/add.ts",
      workspace: { "src/add.ts": ADD_BUG },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/add.ts",
                old_string: "return a - b",
                new_string: "return a + b",
              },
            },
          ],
        },
        { content: "Fixed add()." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.files["src/add.ts"]).toBe(ADD_FIXED);
  });

  it("LLM summary keeps a rejected approach that heuristic first-sentence drop loses", async () => {
    const rejected =
      "Tried rewriting via regex replace; abandoned because it clobbered comments.";
    const msgs: ChatMessage[] = [
      system("You are a helpful coding assistant."),
      user("Fix the parser."),
      assistant("Continuing the search."),
      {
        role: "tool",
        toolCallId: "search-1",
        content: `Search results for parser. ${"filler ".repeat(200)}\n${rejected}`,
      },
    ];
    for (let i = 0; i < 20; i++) {
      msgs.push({
        role: "tool",
        toolCallId: `grep-${i}`,
        content: `grep hit ${i}: filler `.repeat(40),
      });
    }
    msgs.push(user("Continue with the structured parse."));

    const heuristic = compactMessages(msgs, "gpt-4o", 3_000, 400, 0, 80, {
      preserveRecentCount: 2,
      maxHistoryRatio: 0.4,
      useLlmSummarization: false,
    });
    const heuristicText = heuristic.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    const llm = await compactMessagesAsync(
      msgs,
      "gpt-4o",
      3_000,
      400,
      0,
      80,
      {
        preserveRecentCount: 2,
        maxHistoryRatio: 0.4,
        useLlmSummarization: true,
      },
      async () =>
        `Rejected regex rewrite because it clobbered comments. Continue with a structured parse.`,
    );
    const llmText = llm.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    expect(heuristic.summarized).toBe(true);
    expect(heuristicText).not.toContain("clobbered comments");
    expect(llm.summarizationMethod).toBe("llm");
    expect(llmText).toContain("clobbered comments");
    expect(llmText).toContain(CONVERSATION_SUMMARY_MARKER);
  });
});
