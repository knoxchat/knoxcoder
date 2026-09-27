import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatMessage } from "../index.js";
import {
  adjustBoundaryForToolPairs,
  buildConversationSummary,
  compactMessages,
  compactMessagesAsync,
  expandIndicesWithToolPairs,
  heuristicSummarize,
  CONVERSATION_SUMMARY_MARKER,
  llmSummarizeConversation,
  pruneByRelevance,
  pruneByRelevanceAsync,
} from "./index.js";

function user(content: string): ChatMessage {
  return { role: "user", content };
}
function assistant(content: string, toolCalls?: ChatMessage extends { toolCalls?: infer T } ? T : never): ChatMessage {
  return toolCalls
    ? { role: "assistant", content, toolCalls }
    : { role: "assistant", content };
}
function tool(toolCallId: string, content: string): ChatMessage {
  return { role: "tool", toolCallId, content };
}
function system(content: string): ChatMessage {
  return { role: "system", content };
}

/** Build a long conversation that exceeds a tiny history budget. */
function longHistory(): ChatMessage[] {
  const msgs: ChatMessage[] = [
    system("You are a helpful coding assistant."),
    system(
      "## Relevant Memory Context\n<memory-context>\n[pinned] auth uses JWT\n</memory-context>",
    ),
  ];
  for (let i = 0; i < 12; i++) {
    msgs.push(user(`Please work on task ${i}. Update file${i}.ts with details `.repeat(20)));
    msgs.push(
      assistant(
        `I will edit file${i}.ts now.\n\`\`\`ts\nexport function f${i}() { return ${i}; }\n\`\`\`\n`.repeat(
          5,
        ),
      ),
    );
  }
  // Trailing tool round that must stay intact
  msgs.push(
    assistant("Calling read", [
      {
        id: "call-1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"a.ts"}' },
      },
    ] as any),
  );
  msgs.push(tool("call-1", "file contents of a.ts\n".repeat(30)));
  msgs.push(user("Continue from the tool result"));
  return msgs;
}

describe("adjustBoundaryForToolPairs", () => {
  it("pulls boundary back so tool call + result stay together in recent", () => {
    const messages: ChatMessage[] = [
      user("a"),
      assistant("b", [
        {
          id: "t1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ] as any),
      tool("t1", "result"),
      user("c"),
    ];
    // Boundary between assistant and tool would split the pair
    expect(adjustBoundaryForToolPairs(messages, 2)).toBe(1);
  });
});

describe("expandIndicesWithToolPairs", () => {
  it("expands removal of a tool result to include its assistant call", () => {
    const messages: ChatMessage[] = [
      user("a"),
      assistant("b", [
        {
          id: "t1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ] as any),
      tool("t1", "result"),
    ];
    const expanded = expandIndicesWithToolPairs(messages, new Set([2]));
    expect(expanded.has(1)).toBe(true);
    expect(expanded.has(2)).toBe(true);
  });
});

describe("compactMessages", () => {
  it("preserves memory inject and tool pairs when summarizing", () => {
    const messages = longHistory();
    const result = compactMessages(
      messages,
      "gpt-4o",
      4_000, // tiny context to force compaction
      500,
      0,
      100,
      { preserveRecentCount: 4, maxHistoryRatio: 0.5 },
    );

    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.summarized).toBe(true);
    expect(result.summaryText).toContain(CONVERSATION_SUMMARY_MARKER);

    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("Relevant Memory Context");
    expect(joined).toContain("[pinned] auth uses JWT");

    // Last tool round must remain paired if present
    const toolIdx = result.messages.findIndex(
      (m) => m.role === "tool" && "toolCallId" in m && m.toolCallId === "call-1",
    );
    if (toolIdx >= 0) {
      const prev = result.messages[toolIdx - 1];
      expect(prev.role).toBe("assistant");
      expect(
        prev.role === "assistant" &&
          prev.toolCalls?.some((tc) => tc.id === "call-1"),
      ).toBe(true);
    }
  });

  it("does not double-summarize when a summary already exists", () => {
    const messages: ChatMessage[] = [
      system(`${CONVERSATION_SUMMARY_MARKER}\n- prior work`),
      user("follow up ".repeat(200)),
      assistant("ok ".repeat(200)),
      user("again ".repeat(200)),
      assistant("sure ".repeat(200)),
      user("and more ".repeat(200)),
      assistant("done ".repeat(200)),
      user("final"),
    ];
    const result = compactMessages(messages, "gpt-4o", 3_000, 500, 0, 50, {
      preserveRecentCount: 2,
    });
    const summaries = result.messages.filter(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes(CONVERSATION_SUMMARY_MARKER),
    );
    expect(summaries.length).toBeLessThanOrEqual(1);
  });
});

describe("llmSummarizeConversation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns marked summary text from the LLM", async () => {
    const text = await llmSummarizeConversation(
      [user("Add auth"), assistant("Added JWT middleware")],
      {
        complete: async () => "User asked for auth; assistant added JWT.",
        modelName: "gpt-4o",
        maxSummaryTokens: 100,
        maxInputTokens: 2000,
        timeoutMs: 2000,
      },
    );
    expect(text).toContain(CONVERSATION_SUMMARY_MARKER);
    expect(text).toContain("JWT");
  });

  it("returns null on timeout so callers can fall back", async () => {
    vi.useFakeTimers();
    const promise = llmSummarizeConversation([user("hi"), assistant("yo")], {
      complete: async (_prompt, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      modelName: "gpt-4o",
      maxSummaryTokens: 100,
      maxInputTokens: 2000,
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeNull();
  });
});

describe("compactMessagesAsync", () => {
  it("uses LLM summary when flag is on and complete succeeds", async () => {
    const messages = longHistory();
    const complete = vi.fn(async () => "Prior turns set up JWT auth and edits.");
    const result = await compactMessagesAsync(
      messages,
      "gpt-4o",
      4_000,
      500,
      0,
      100,
      {
        useLlmSummarization: true,
        preserveRecentCount: 4,
        maxHistoryRatio: 0.5,
        llmSummarizationTimeoutMs: 2000,
      },
      complete,
    );

    expect(result.tokensSaved).toBeGreaterThan(0);
    if (result.summarized) {
      expect(result.summarizationMethod).toBe("llm");
      expect(complete).toHaveBeenCalled();
      expect(result.summaryText).toContain("JWT");
    }
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("Relevant Memory Context");
  });

  it("falls back to heuristic when LLM fails", async () => {
    const messages = longHistory();
    const result = await compactMessagesAsync(
      messages,
      "gpt-4o",
      4_000,
      500,
      0,
      100,
      {
        useLlmSummarization: true,
        preserveRecentCount: 4,
        maxHistoryRatio: 0.5,
      },
      async () => {
        throw new Error("boom");
      },
    );

    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.summarizationMethod).toBe("heuristic");
    expect(result.summaryText).toContain(CONVERSATION_SUMMARY_MARKER);
  });
});

describe("pruneByRelevanceAsync", () => {
  it("matches heuristic prune when Jev is disabled", async () => {
    const messages = longHistory();
    const sync = pruneByRelevance(messages, "gpt-4o", 800, 4);
    const asyncResult = await pruneByRelevanceAsync(messages, "gpt-4o", 800, 4);
    expect(asyncResult.messages).toEqual(sync.messages);
    expect(asyncResult.tokensSaved).toBe(sync.tokensSaved);
  });
});

describe("buildConversationSummary", () => {
  it("skips memory-protected system messages in the summary body", () => {
    const summary = buildConversationSummary(
      [
        system("## Relevant Memory Context\n[pinned] secret"),
        user("do the thing"),
        assistant("did the thing"),
      ],
      1500,
    );
    expect(summary).toContain(CONVERSATION_SUMMARY_MARKER);
    expect(summary).not.toContain("[pinned] secret");
    expect(summary).toContain("user");
  });
});

function gccMakeLog(): string {
  const cc = Array.from({ length: 40 }, (_, i) => `  CC      kernel/foo${i}.o`).join("\n");
  return [
    cc,
    "mm/filemap.c:42:5: error: implicit declaration of function 'copy_to_user'",
    "make[2]: *** [mm/filemap.o] Error 1",
  ].join("\n");
}

const KERNEL_PLAN_STEPS = [
  "Read MAINTAINERS for mm",
  "Reproduce panic in QEMU",
  "Parse oops RIP",
  "Patch copy_to_user",
  "Rebuild vmlinux",
  "Boot qemu-system-x86_64",
  "Run kselftest",
  "Commit the fix",
];

describe("compactMessages systems loop state (HL-16 / HL-17)", () => {
  it("keeps gcc error path and verifyCommand after forced compaction", () => {
    const messages: ChatMessage[] = [
      system("You are a helpful coding assistant."),
      system("Workspace oracle verifyCommand: make -j8"),
      user("Fix the kernel build"),
      assistant("Running make"),
      tool("build-1", gccMakeLog()),
    ];
    for (let i = 0; i < 14; i++) {
      messages.push(user(`Please continue filler task ${i}. `.repeat(30)));
      messages.push(assistant(`Working on filler ${i}. `.repeat(40)));
    }
    messages.push(user("What was the compiler error?"));

    const result = compactMessages(messages, "gpt-4o", 4_000, 500, 0, 100, {
      preserveRecentCount: 2,
      maxHistoryRatio: 0.45,
    });

    expect(result.tokensSaved).toBeGreaterThan(0);
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("mm/filemap.c");
    expect(joined).toMatch(/copy_to_user/);
    expect(joined).toMatch(/verifyCommand:\s*make/);
  });

  it("keeps rustc E0502 and cargo verifyCommand after forced compaction", () => {
    const rustLog = [
      ...Array.from({ length: 40 }, (_, i) => `   Compiling crate${i} v0.1.0`),
      "error[E0502]: cannot borrow `x` as mutable because it is also borrowed as immutable",
      " --> src/borrow.rs:12:9",
    ].join("\n");
    const messages: ChatMessage[] = [
      system("You are a helpful coding assistant."),
      system("Workspace oracle verifyCommand: cargo check --workspace --all-targets"),
      user("Fix the borrow error"),
      assistant("Running cargo check"),
      tool("build-1", rustLog),
    ];
    for (let i = 0; i < 14; i++) {
      messages.push(user(`Please continue filler task ${i}. `.repeat(30)));
      messages.push(assistant(`Working on filler ${i}. `.repeat(40)));
    }
    messages.push(user("What was the rustc error?"));

    const result = compactMessages(messages, "gpt-4o", 4_000, 500, 0, 100, {
      preserveRecentCount: 2,
      maxHistoryRatio: 0.45,
    });

    expect(result.tokensSaved).toBeGreaterThan(0);
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toMatch(/E0502/);
    expect(joined).toContain("src/borrow.rs");
    expect(joined).toMatch(/verifyCommand:\s*cargo check/);
  });

  it("summarizes CC spam to a file-count plus error lines", () => {
    const summary = heuristicSummarize(tool("t", gccMakeLog()), 500);
    expect(summary).toMatch(/make: \d+ files/);
    expect(summary).toContain("mm/filemap.c");
    expect(summary).toMatch(/copy_to_user/);
  });

  it("keeps oops RIP and QEMU monitor status when compacting verbose serial", () => {
    const serial = [
      "Booting Linux on physical CPU 0x0",
      ...Array.from({ length: 40 }, (_, i) => `[    0.${String(i).padStart(6, "0")}] init`),
      "Kernel panic - not syncing: Fatal exception",
      "RIP: 0010:copy_to_user+0x10/0x20",
      "Call Trace:",
      " do_fault+0x1c/0x40 mm/filemap.c:42",
      "job_id: pty_qemu1",
      "(qemu) info status",
      "VM status: running",
    ].join("\n");
    const summary = heuristicSummarize(tool("qemu-1", serial), 500);
    expect(summary).toMatch(/copy_to_user/);
    expect(summary).toContain("mm/filemap.c:42");
    expect(summary).toMatch(/pty_qemu1/);
    expect(summary).toMatch(/VM status:\s*running/);

    const messages: ChatMessage[] = [
      system("You are a helpful coding assistant."),
      user("Boot the kernel"),
      assistant("Starting QEMU"),
      tool("qemu-1", serial),
    ];
    for (let i = 0; i < 14; i++) {
      messages.push(user(`Filler ${i} `.repeat(40)));
      messages.push(assistant(`Ack ${i} `.repeat(40)));
    }
    messages.push(user("What was the panic?"));

    const result = compactMessages(messages, "gpt-4o", 4_000, 500, 0, 100, {
      preserveRecentCount: 2,
      maxHistoryRatio: 0.45,
    });
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toMatch(/copy_to_user/);
    expect(joined).toContain("mm/filemap.c");
    expect(joined).toMatch(/pty_qemu1|job_id/);
  });

  it("promotes an 8-step kernel plan from a tool result through compaction", () => {
    const planBody = [
      "Task Execution Plan",
      "[pinned]",
      "Title: Boot panic in mm",
      ...KERNEL_PLAN_STEPS.map((title, i) => `${i + 1}. [ ] ${title}`),
    ].join("\n");

    const messages: ChatMessage[] = [
      system("You are a helpful coding assistant."),
      user("Plan the kernel panic work"),
      assistant("Creating a plan"),
      tool("plan-1", planBody),
    ];
    for (let i = 0; i < 14; i++) {
      messages.push(user(`Filler ${i} `.repeat(40)));
      messages.push(assistant(`Ack ${i} `.repeat(40)));
    }
    messages.push(user("Continue with the plan"));

    const result = compactMessages(messages, "gpt-4o", 4_000, 500, 0, 100, {
      preserveRecentCount: 2,
      maxHistoryRatio: 0.45,
    });

    expect(result.tokensSaved).toBeGreaterThan(0);
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(joined).toContain("Task Execution Plan");
    for (const step of KERNEL_PLAN_STEPS) {
      expect(joined).toContain(step);
    }
  });
});
