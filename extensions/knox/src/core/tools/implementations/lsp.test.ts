import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { lspImpl } from "./lsp";
import {
  COMPILE_COMMANDS_ADVICE,
  NO_LSP_SERVER_ADVICE,
  RUST_ANALYZER_ADVICE,
} from "../compileCommands";

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_lsp" } } as ToolExtras["tool"],
  };
}

describe("lspImpl workspaceSymbol", () => {
  it("passes the query through (not an empty string)", async () => {
    const getWorkspaceSymbols = vi.fn(async (query: string) => [
      { name: query, kind: 12, location: "file:///tmp/ws/sched.c" },
    ]);
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      getWorkspaceSymbols,
    } as unknown as IDE;

    const result = await lspImpl(
      { operation: "workspaceSymbol", query: "copy_process" },
      extras(ide),
    );

    expect(getWorkspaceSymbols).toHaveBeenCalledWith("copy_process");
    expect(result[0].content).toContain("copy_process");
  });

  it("requires query for workspaceSymbol", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      getWorkspaceSymbols: vi.fn(),
    } as unknown as IDE;

    const result = await lspImpl({ operation: "workspaceSymbol" }, extras(ide));
    expect(result[0].content).toMatch(/requires query/i);
    expect(ide.getWorkspaceSymbols).not.toHaveBeenCalled();
  });

  it("does not require filePath for workspaceSymbol", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => false),
      listDir: vi.fn(async () => []),
      getWorkspaceSymbols: vi.fn(async () => []),
    } as unknown as IDE;

    const result = await lspImpl(
      { operation: "workspaceSymbol", query: "schedule" },
      extras(ide),
    );
    expect(result[0].content).toMatch(/No results found/i);
  });

  it("falls back to a mini tags file when LSP is empty (HL-26)", async () => {
    const tags = `copy_process\tkernel/fork.c\t/^pid_t copy_process(/;"\tf\n`;
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async (uri: string) => uri.endsWith("/tags")),
      readFile: vi.fn(async () => tags),
      listDir: vi.fn(async () => []),
      getWorkspaceSymbols: vi.fn(async () => []),
    } as unknown as IDE;

    const result = await lspImpl(
      { operation: "workspaceSymbol", query: "copy_process" },
      extras(ide),
    );
    expect(result[0].content).toContain("kernel/fork.c");
    expect(result[0].content).toMatch(/via tags/i);
    expect(result[0].content).not.toContain("compile_commands");
  });
});

describe("lspImpl compile_commands vs no server (HL-25)", () => {
  it("tells the model to generate compile_commands.json on empty C gotoDefinition", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async (uri: string) => !uri.includes("compile_commands")),
      listDir: vi.fn(async () => [
        ["Kconfig", 1],
        ["Makefile", 1],
        ["arch", 2],
      ]),
      gotoDefinition: vi.fn(async () => []),
    } as unknown as IDE;

    const result = await lspImpl(
      {
        operation: "goToDefinition",
        filePath: "mm/filemap.c",
        line: 10,
        character: 1,
      },
      extras(ide),
    );
    expect(result[0].content).toContain(COMPILE_COMMANDS_ADVICE);
    expect(result[0].content).not.toContain(NO_LSP_SERVER_ADVICE);
  });

  it("distinguishes a missing language server from a missing compile DB", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async (uri: string) =>
        uri.includes("compile_commands.json")
          ? true
          : !uri.endsWith("compile_commands.json"),
      ),
      listDir: vi.fn(async () => []),
      gotoDefinition: vi.fn(async () => {
        throw new Error("No language server is available");
      }),
    } as unknown as IDE;

    const result = await lspImpl(
      {
        operation: "goToDefinition",
        filePath: "src/app.ts",
        line: 1,
        character: 1,
      },
      extras(ide),
    );
    expect(result[0].content).toContain(NO_LSP_SERVER_ADVICE);
    expect(result[0].content).not.toContain("bear -- make");
  });

  it("tells the model to install rust-analyzer on empty .rs hover (RL-26)", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      fileExists: vi.fn(async () => true),
      listDir: vi.fn(async () => [
        ["Cargo.toml", 1],
        ["src", 2],
      ]),
      getHover: vi.fn(async () => []),
    } as unknown as IDE;

    const result = await lspImpl(
      {
        operation: "hover",
        filePath: "src/lib.rs",
        line: 4,
        character: 8,
      },
      extras(ide),
    );
    expect(result[0].content).toContain(RUST_ANALYZER_ADVICE);
    expect(result[0].content).toMatch(/rust-analyzer/);
    expect(result[0].content).not.toContain("compile_commands");
    expect(result[0].content).not.toContain("bear -- make");
  });
});
