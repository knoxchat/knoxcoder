import { describe, expect, it } from "vitest";

import {
  extractTextToolCalls,
  holdbackPartialToolMarkup,
  hydrateAssistantTextToolCalls,
  IncrementalTextToolCallParser,
  looksLikeTextToolCall,
  mapTextToolCallStream,
  stripLeakedToolMarkup,
} from "./parseTextToolCalls";

const SCREENSHOT_DSML = `Let me run the build differently to see all remaining errors at once:
< | DSML | tool_calls>
< | DSML | invoke name="builtin_run_terminal_command">
< | DSML | parameter name="command" string="true">cargo build 2>&1 | tail -60</ | DSML | parameter>
< | DSML | parameter name="block_until_ms" string="false">60000</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | tool_calls>`;

const COMPACT_DSML = `<|DSML|tool_calls>
<|DSML|invoke name="builtin_read_file">
<|DSML|parameter name="filepath" string="true">src/main.rs</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`;

/** DeepSeek/Cursor special-token form: fullwidth ｜ (U+FF5C), no spaces. */
const FULLWIDTH_DSML = `Let me check the manifest state and restructure to avoid bin/lib conflict.
<\uFF5CDSML\uFF5Ctool_calls>
<\uFF5CDSML\uFF5Cinvoke name="builtin_read_file">
<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Ctool_calls>`;

describe("extractTextToolCalls", () => {
  it("parses spaced DSML from a leaked Cursor-style tool call", () => {
    const { content, toolCalls, rest } = extractTextToolCalls(SCREENSHOT_DSML);
    expect(rest).toBe("");
    expect(content).toContain("Let me run the build differently");
    expect(content).not.toMatch(/DSML/);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe("builtin_run_terminal_command");
    const args = JSON.parse(toolCalls[0]?.function?.arguments ?? "{}");
    expect(args.command).toBe("cargo build 2>&1 | tail -60");
    expect(args.block_until_ms).toBe(60000);
  });

  it("parses DSML calls wrapper with a split parameter close tag", () => {
    const text = `< | DSML |  calls>
< | DSML |  invoke name="builtin_run_terminal_command">
< | DSML |  parameter name="command" string="true">cat Cargo.toml</
 | DSML |  parameter>
</ | DSML |  invoke></ | DSML |  calls>`;
    const { content, toolCalls, rest } = extractTextToolCalls(text);
    expect(rest).toBe("");
    expect(content).not.toMatch(/DSML/);
    expect(content.trim()).toBe("");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe("builtin_run_terminal_command");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}").command).toBe(
      "cat Cargo.toml",
    );
  });

  it("parses malformed edit_file DSML with sibling parameters and no invoke close", () => {
    const text = `< | DSML |  calls>
< | DSML |  invoke name="builtin_edit_file">
< | DSML |  parameter name="filepath" string="true">src/main.rs</ | DSML | 
parameter>
< | DSML |  parameter name="old_string" string="true"> let mut high_score = 
use_signal(|| 0u32);< | DSML |  parameter name="new_string" string="true"> let 
high_score = use_signal(|| 0u32);
</ | DSML |  calls>`;
    const { content, toolCalls, rest } = extractTextToolCalls(text, {
      allowIncomplete: true,
    });
    expect(rest).toBe("");
    expect(content).not.toMatch(/DSML/);
    expect(content.trim()).toBe("");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe("builtin_edit_file");
    const args = JSON.parse(toolCalls[0]?.function?.arguments ?? "{}");
    expect(args.filepath).toBe("src/main.rs");
    expect(args.old_string).toContain("let mut high_score");
    expect(args.old_string).not.toContain("new_string");
    expect(args.new_string).toContain("let \nhigh_score = use_signal(|| 0u32);");
  });

  it("parses exploded `| | DSML | |` tags from a leaked DeepSeek screenshot", () => {
    const text = `我先把工作区的结构和各 crate 的清单读一遍，再给你一份有依据的架构总结。
< | | DSML | |  calls>
< | | DSML | |  invoke name="builtin_run_terminal_command">
< | | DSML | |  parameter name="command" string="true">find . -name target -prune -o -type f -name "*.toml" -print | sort</ / | DSML | | parameter>
</ / | DSML | | invoke>
< | | DSML | |  invoke name="builtin_run_terminal_command">
< | | DSML | |  parameter name="command" string="true">find . -name target -prune -o -name .git -prune -o -type f -name "*.rs" -print | sort | head -200</ / | DSML | | parameter>
</ / | DSML | | invoke>
</ / | DSML | | calls>`;
    const { content, toolCalls, rest } = extractTextToolCalls(text, {
      allowIncomplete: true,
    });
    expect(rest).toBe("");
    expect(content).toContain("架构总结");
    expect(content).not.toMatch(/DSML/);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.function?.name).toBe("builtin_run_terminal_command");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}").command).toContain(
      "*.toml",
    );
    expect(JSON.parse(toolCalls[1]?.function?.arguments ?? "{}").command).toContain(
      "*.rs",
    );
  });

  it("maps placeholder invoke name=tool_name from parameter keys", () => {
    const text = `<|DSML|tool_calls>
<|DSML|invoke name="tool_name">
<|DSML|parameter name="command" string="true">ls</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`;
    const { toolCalls, content } = extractTextToolCalls(text);
    expect(content).toBe("");
    expect(toolCalls[0]?.function?.name).toBe("builtin_run_terminal_command");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}").command).toBe(
      "ls",
    );
  });

  it("parses compact <|DSML|> tags and canonicalizes names", () => {
    const { content, toolCalls } = extractTextToolCalls(COMPACT_DSML);
    expect(content).toBe("");
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      filepath: "src/main.rs",
    });
  });

  it("parses fullwidth ｜DSML｜ tags instead of leaking them as chat text", () => {
    const { content, toolCalls, rest } = extractTextToolCalls(FULLWIDTH_DSML);
    expect(rest).toBe("");
    expect(content).toContain("Let me check the manifest");
    expect(content).not.toMatch(/DSML/);
    expect(content).not.toContain("\uFF5C");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      filepath: "Cargo.toml",
    });
  });

  it("parses fullwidth ｜DSML｜function_calls wrappers", () => {
    const text = `<\uFF5CDSML\uFF5Cfunction_calls>
<\uFF5CDSML\uFF5Cinvoke name="builtin_read_file">
<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Cfunction_calls>`;
    const { content, toolCalls, rest } = extractTextToolCalls(text);
    expect(rest).toBe("");
    expect(content).toBe("");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      filepath: "Cargo.toml",
    });
  });

  it("parses multiple invokes in one block", () => {
    const text = `<|DSML|tool_calls>
<|DSML|invoke name="read_file">
<|DSML|parameter name="filepath" string="true">a.ts</|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="glob">
<|DSML|parameter name="pattern" string="true">*.ts</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`;
    const { toolCalls } = extractTextToolCalls(text);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
    expect(toolCalls[1]?.function?.name).toBe("builtin_glob");
    expect(toolCalls[0]?.index).toBe(0);
    expect(toolCalls[1]?.index).toBe(1);
  });

  it("parses XML invoke / parameter tool calls", () => {
    const text = `<tool_calls>
<invoke name="builtin_exact_search">
<parameter name="query">TODO</parameter>
</invoke>
</tool_calls>`;
    const { toolCalls, content } = extractTextToolCalls(text);
    expect(content).toBe("");
    expect(toolCalls[0]?.function?.name).toBe("builtin_exact_search");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      query: "TODO",
    });
  });

  it("parses Hermes <function=name> blocks", () => {
    const text = `<function=run_terminal_command>
<parameter=command>ls</parameter>
</function>`;
    const { toolCalls } = extractTextToolCalls(text);
    expect(toolCalls[0]?.function?.name).toBe("builtin_run_terminal_command");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      command: "ls",
    });
  });

  it("parses JSON inside <tool_call>", () => {
    const text = `<tool_call>
{"name": "read_file", "arguments": {"filepath": "a.ts"}}
</tool_call>`;
    const { toolCalls } = extractTextToolCalls(text);
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}")).toEqual({
      filepath: "a.ts",
    });
  });

  it("holds incomplete markup in rest until the block closes", () => {
    const partial = `intro
< | DSML | tool_calls>
< | DSML | invoke name="builtin_run_terminal_command">
< | DSML | parameter name="command" string="true">cargo build`;
    const { content, toolCalls, rest } = extractTextToolCalls(partial);
    expect(toolCalls).toHaveLength(0);
    expect(content).toContain("intro");
    expect(rest).toContain("DSML");
  });

  it("recovers an unclosed invoke when allowIncomplete is set", () => {
    const partial = `< | DSML | invoke name="builtin_run_terminal_command">
< | DSML | parameter name="command" string="true">cargo build</ | DSML | parameter>`;
    const { toolCalls } = extractTextToolCalls(partial, {
      allowIncomplete: true,
    });
    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? "{}").command).toBe(
      "cargo build",
    );
  });
});

describe("holdbackPartialToolMarkup", () => {
  it("emits prose and holds a partial DSML opener", () => {
    const { emit, hold } = holdbackPartialToolMarkup("hello < | DSML");
    expect(emit).toBe("hello ");
    expect(hold).toBe("< | DSML");
  });

  it("holds an exploded double-bar DSML opener", () => {
    const { emit, hold } = holdbackPartialToolMarkup("hello < | | DSML");
    expect(emit).toBe("hello ");
    expect(hold).toBe("< | | DSML");
  });

  it("holds a partial fullwidth DSML opener", () => {
    const { emit, hold } = holdbackPartialToolMarkup(
      "hello <\uFF5CDSML",
    );
    expect(emit).toBe("hello ");
    expect(hold).toBe("<\uFF5CDSML");
  });

  it("does not hold a finished HTML tag", () => {
    const { emit, hold } = holdbackPartialToolMarkup("use <div> ok");
    expect(emit).toBe("use <div> ok");
    expect(hold).toBe("");
  });

  it("holds an unclosed DSML calls wrapper so it is not printed", () => {
    const { emit, hold } = holdbackPartialToolMarkup(
      "ok\n< | DSML |  calls>\n< | DSML |  invoke name=\"builtin_run_terminal_command\">",
    );
    expect(emit).toBe("ok\n");
    expect(hold).toMatch(/DSML/);
  });
});

describe("IncrementalTextToolCallParser", () => {
  it("does not leak DSML while tokens stream in", () => {
    const parser = new IncrementalTextToolCallParser();
    const mid = parser.push({
      role: "assistant",
      content: "Let me run:\n< | DSML | tool_calls>\n< | DSML | invoke name=\"builtin_run_terminal_command\">",
    });
    expect(JSON.stringify(mid)).not.toMatch(/DSML/);
    expect(mid.some((m) => m.role === "assistant" && m.content === "Let me run:")).toBe(
      true,
    );

    const done = parser.push({
      role: "assistant",
      content: `
< | DSML | parameter name="command" string="true">cargo build</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | tool_calls>`,
    });
    const toolChunk = done.find(
      (m) => m.role === "assistant" && "toolCalls" in m && m.toolCalls?.length,
    );
    expect(
      toolChunk && "toolCalls" in toolChunk
        ? toolChunk.toolCalls?.[0]?.function?.name
        : undefined,
    ).toBe("builtin_run_terminal_command");
    expect(JSON.stringify(done)).not.toMatch(/DSML/);
  });

  it("does not leak fullwidth DSML while tokens stream in", () => {
    const parser = new IncrementalTextToolCallParser();
    const mid = parser.push({
      role: "assistant",
      content:
        "Let me check:\n<\uFF5CDSML\uFF5Ctool_calls>\n<\uFF5CDSML\uFF5Cinvoke name=\"builtin_read_file\">",
    });
    expect(JSON.stringify(mid)).not.toMatch(/DSML/);
    expect(JSON.stringify(mid)).not.toContain("\uFF5C");
    expect(
      mid.some((m) => m.role === "assistant" && m.content === "Let me check:"),
    ).toBe(true);

    const done = parser.push({
      role: "assistant",
      content: `
<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Ctool_calls>`,
    });
    const toolChunk = done.find(
      (m) => m.role === "assistant" && "toolCalls" in m && m.toolCalls?.length,
    );
    expect(
      toolChunk && "toolCalls" in toolChunk
        ? toolChunk.toolCalls?.[0]?.function?.name
        : undefined,
    ).toBe("builtin_read_file");
    expect(JSON.stringify(done)).not.toMatch(/DSML/);
    expect(JSON.stringify(done)).not.toContain("\uFF5C");
  });

  it("passes reasoning-only chunks through", () => {
    const parser = new IncrementalTextToolCallParser();
    const out = parser.push({
      role: "assistant",
      content: "",
      reasoning: "need the compiler output",
    } as any);
    expect(out).toHaveLength(1);
    expect((out[0] as any).reasoning).toBe("need the compiler output");
  });

  it("flushes a complete block at end() even without the outer close", () => {
    const parser = new IncrementalTextToolCallParser();
    parser.push({
      role: "assistant",
      content: `< | DSML | invoke name="builtin_glob">
< | DSML | parameter name="pattern" string="true">*.rs</ | DSML | parameter>`,
    });
    const end = parser.end();
    expect(
      end[0] && "toolCalls" in end[0]
        ? end[0].toolCalls?.[0]?.function?.name
        : undefined,
    ).toBe("builtin_glob");
  });
});

describe("mapTextToolCallStream", () => {
  it("converts chunked fullwidth DSML into structured toolCalls without leaking tags", async function () {
    async function* source() {
      yield {
        role: "assistant" as const,
        content: "Let me check the manifest state and restructure to avoid bin/lib conflict.\n",
      };
      yield {
        role: "assistant" as const,
        content: "<\uFF5CDSML\uFF5Ctool_calls>\n",
      };
      yield {
        role: "assistant" as const,
        content: '<\uFF5CDSML\uFF5Cinvoke name="builtin_read_file">\n',
      };
      yield {
        role: "assistant" as const,
        content:
          '<\uFF5CDSML\uFF5Cparameter name="filepath" string="true">Cargo.toml</\uFF5CDSML\uFF5Cparameter>\n',
      };
      yield {
        role: "assistant" as const,
        content: "</\uFF5CDSML\uFF5Cinvoke>\n</\uFF5CDSML\uFF5Ctool_calls>",
      };
    }

    const chunks = [];
    for await (const chunk of mapTextToolCallStream(source())) {
      chunks.push(chunk);
    }
    const visible = chunks
      .map((c) => (typeof c.content === "string" ? c.content : ""))
      .join("");
    expect(visible).not.toMatch(/DSML/);
    expect(visible).not.toContain("\uFF5C");
    expect(visible).toContain("Let me check the manifest");
    const tools = chunks.flatMap((c) =>
      c.role === "assistant" && "toolCalls" in c ? (c.toolCalls ?? []) : [],
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function?.name).toBe("builtin_read_file");
    expect(JSON.parse(tools[0]?.function?.arguments ?? "{}")).toEqual({
      filepath: "Cargo.toml",
    });
  });

  it("converts a chunked screenshot-style leak into structured toolCalls", async function () {
    async function* source() {
      yield { role: "assistant" as const, content: "Let me run the build differently to see all remaining errors at once:\n" };
      yield { role: "assistant" as const, content: "< | DSML | tool_calls>\n" };
      yield { role: "assistant" as const, content: "< | DSML | invoke name=\"builtin_run_terminal_command\">\n" };
      yield { role: "assistant" as const, content: "< | DSML | parameter name=\"command\" string=\"true\">cargo build 2>&1 | tail -60</ | DSML | parameter>\n" };
      yield { role: "assistant" as const, content: "< | DSML | parameter name=\"block_until_ms\" string=\"false\">60000</ | DSML | parameter>\n" };
      yield { role: "assistant" as const, content: "</ | DSML | invoke>\n</ | DSML | tool_calls>" };
    }

    const chunks = [];
    for await (const chunk of mapTextToolCallStream(source())) {
      chunks.push(chunk);
    }
    const visible = chunks
      .map((c) => (typeof c.content === "string" ? c.content : ""))
      .join("");
    expect(visible).not.toMatch(/DSML/);
    expect(visible).toContain("Let me run the build");
    const tools = chunks.flatMap((c) =>
      c.role === "assistant" && "toolCalls" in c ? (c.toolCalls ?? []) : [],
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function?.name).toBe("builtin_run_terminal_command");
  });

  it("does not leak a DSML calls wrapper while tokens stream in", async function () {
    async function* source() {
      yield { role: "assistant" as const, content: "< | DSML |  calls>\n" };
      yield {
        role: "assistant" as const,
        content: '< | DSML |  invoke name="builtin_run_terminal_command">\n',
      };
      yield {
        role: "assistant" as const,
        content:
          '< | DSML |  parameter name="command" string="true">cat Cargo.toml</\n | DSML |  parameter>\n',
      };
      yield {
        role: "assistant" as const,
        content: "</ | DSML |  invoke></ | DSML |  calls>",
      };
    }

    const chunks = [];
    for await (const chunk of mapTextToolCallStream(source())) {
      chunks.push(chunk);
    }
    const visible = chunks
      .map((c) => (typeof c.content === "string" ? c.content : ""))
      .join("");
    expect(visible).not.toMatch(/DSML/);
    const tools = chunks.flatMap((c) =>
      c.role === "assistant" && "toolCalls" in c ? (c.toolCalls ?? []) : [],
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function?.name).toBe("builtin_run_terminal_command");
    expect(JSON.parse(tools[0]?.function?.arguments ?? "{}").command).toBe(
      "cat Cargo.toml",
    );
  });

  it("does not leak malformed edit_file DSML with a missing invoke close", async function () {
    async function* source() {
      yield {
        role: "assistant" as const,
        content: `< | DSML |  calls>
< | DSML |  invoke name="builtin_edit_file">
< | DSML |  parameter name="filepath" string="true">src/main.rs</ | DSML | 
parameter>
< | DSML |  parameter name="old_string" string="true"> let mut high_score = 
use_signal(|| 0u32);< | DSML |  parameter name="new_string" string="true"> let 
high_score = use_signal(|| 0u32);
</ | DSML |  calls>`,
      };
    }

    const chunks = [];
    for await (const chunk of mapTextToolCallStream(source())) {
      chunks.push(chunk);
    }
    const visible = chunks
      .map((c) => (typeof c.content === "string" ? c.content : ""))
      .join("");
    expect(visible).not.toMatch(/DSML/);
    const tools = chunks.flatMap((c) =>
      c.role === "assistant" && "toolCalls" in c ? (c.toolCalls ?? []) : [],
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function?.name).toBe("builtin_edit_file");
    const args = JSON.parse(tools[0]?.function?.arguments ?? "{}");
    expect(args.filepath).toBe("src/main.rs");
    expect(args.new_string).toContain("high_score = use_signal(|| 0u32);");
  });
});

describe("looksLikeTextToolCall", () => {
  it("detects DSML and ignores ordinary prose", () => {
    expect(looksLikeTextToolCall(SCREENSHOT_DSML)).toBe(true);
    expect(looksLikeTextToolCall(FULLWIDTH_DSML)).toBe(true);
    expect(looksLikeTextToolCall("< | | DSML | |  calls>")).toBe(true);
    expect(looksLikeTextToolCall("use a <div> in the template")).toBe(false);
  });
});

describe("stripLeakedToolMarkup", () => {
  it("drops screenshot-style DSML so it cannot render as chat text", () => {
    const leaked = `< | DSML |  calls>
< | DSML |  invoke name="builtin_edit_file">
< | DSML |  parameter name="filepath" string="true">src/main.rs</ | DSML | 
parameter>
</ | DSML |  calls>`;
    expect(stripLeakedToolMarkup(leaked)).not.toMatch(/DSML/);
    expect(stripLeakedToolMarkup(`intro\n${leaked}`).trim()).toBe("intro");
  });

  it("drops exploded `| | DSML | |` markup from a leaked reply", () => {
    const leaked = `intro
< | | DSML | |  calls>
< | | DSML | |  invoke name="builtin_run_terminal_command">
< | | DSML | |  parameter name="command" string="true">ls</ / | DSML | | parameter>`;
    expect(stripLeakedToolMarkup(leaked)).not.toMatch(/DSML/);
    expect(stripLeakedToolMarkup(leaked).trim()).toBe("intro");
  });
});

describe("hydrateAssistantTextToolCalls", () => {
  it("promotes leaked fullwidth DSML into toolCalls when the stream skipped them", () => {
    const { content, toolCalls } = hydrateAssistantTextToolCalls(
      FULLWIDTH_DSML,
      [],
    );
    expect(content).toContain("Let me check the manifest");
    expect(content).not.toMatch(/DSML/);
    expect(toolCalls[0]?.function?.name).toBe("builtin_read_file");
  });

  it("keeps native toolCalls and only strips markup from content", () => {
    const native = [
      {
        id: "n1",
        type: "function" as const,
        function: { name: "builtin_glob", arguments: '{"pattern":"*.rs"}' },
      },
    ];
    const { content, toolCalls } = hydrateAssistantTextToolCalls(
      FULLWIDTH_DSML,
      native,
    );
    expect(content).not.toMatch(/DSML/);
    expect(toolCalls).toEqual(native);
  });
});
