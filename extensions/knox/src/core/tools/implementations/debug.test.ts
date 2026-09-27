import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { MockDapSession } from "../debug/mockDap";
import { debugImpl } from "./debug";
import {
  resolveProductAgentTools,
  selectAgentTools,
  shouldIncludeDebugTool,
} from "../catalog";
import { debugTool } from "../definitions/debug";
import { allTools } from "../index";

function extrasWithDap(session: MockDapSession): ToolExtras {
  return {
    ide: {
      debugControl: (request) => session.handle(request),
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_debug" } } as ToolExtras["tool"],
  };
}

describe("builtin_debug mock DAP (HL-31)", () => {
  it("breakpoint → continue → backtrace returns frames to the model", async () => {
    const session = new MockDapSession();
    const extras = extrasWithDap(session);

    const launched = await debugImpl(
      { op: "launch", program: "vmlinux" },
      extras,
    );
    expect(launched[0].content).toMatch(/Launched/);

    const bp = await debugImpl(
      { op: "breakpoint", filePath: "mm/filemap.c", line: 42 },
      extras,
    );
    expect(bp[0].content).toContain("mm/filemap.c:42");

    const cont = await debugImpl({ op: "continue" }, extras);
    expect(cont[0].content).toMatch(/stopped at mm\/filemap\.c:42/);

    const bt = await debugImpl({ op: "backtrace" }, extras);
    expect(bt[0].content).toContain("copy_to_user");
    expect(bt[0].content).toContain("mm/filemap.c:42");
    expect(bt[0].content).toContain("sys_read");
  });

  it("evaluate reads a mock local", async () => {
    const session = new MockDapSession();
    const extras = extrasWithDap(session);
    await debugImpl({ op: "launch", program: "vmlinux" }, extras);
    await debugImpl(
      { op: "breakpoint", filePath: "mm/filemap.c", line: 42 },
      extras,
    );
    await debugImpl({ op: "continue" }, extras);
    const ev = await debugImpl({ op: "evaluate", expression: "n" }, extras);
    expect(ev[0].content).toBe("16");
  });

  it("tells the model when no DAP backend exists", async () => {
    const extras = extrasWithDap(new MockDapSession());
    extras.ide = {} as IDE;
    const result = await debugImpl({ op: "backtrace" }, extras);
    expect(result[0].content).toMatch(/No DAP backend/);
  });
});

describe("debug catalog gate (HL-46)", () => {
  it("stays off default app catalogs", () => {
    expect(shouldIncludeDebugTool({})).toBe(false);
    expect(
      selectAgentTools(allTools, {}).some(
        (tool) => tool.function.name === debugTool.function.name,
      ),
    ).toBe(false);
  });

  it("appears for systems profile or an active session", () => {
    expect(shouldIncludeDebugTool({ systems: true })).toBe(true);
    expect(shouldIncludeDebugTool({ debugSessionActive: true })).toBe(true);
    const systems = selectAgentTools(allTools, { systems: true });
    expect(systems.some((tool) => tool.function.name === "builtin_debug")).toBe(
      true,
    );
  });

  it("resolveProductAgentTools adds debug for systems or a live DAP session", async () => {
    const systems = await resolveProductAgentTools(allTools, {
      systems: true,
      ide: {} as IDE,
    });
    expect(systems.some((tool) => tool.function.name === "builtin_debug")).toBe(
      true,
    );

    const session = new MockDapSession();
    await session.handle({ op: "launch", program: "vmlinux" });
    const live = await resolveProductAgentTools(allTools, {
      ide: { debugControl: (request) => session.handle(request) } as IDE,
    });
    expect(live.some((tool) => tool.function.name === "builtin_debug")).toBe(
      true,
    );

    const app = await resolveProductAgentTools(allTools, {
      ide: {} as IDE,
    });
    expect(app.some((tool) => tool.function.name === "builtin_debug")).toBe(
      false,
    );
  });
});
