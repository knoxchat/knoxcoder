import { describe, expect, it } from "vitest";

import DebugLocalsProvider, {
  DEBUGGER_CONTEXT_PROVIDER_TITLE,
  debuggerSubmenuItems,
  formatDebuggerContext,
} from "./DebugLocalsProvider";

describe("KN-353 @debugger context provider", () => {
  it("keeps the integration title debugger", () => {
    expect(DEBUGGER_CONTEXT_PROVIDER_TITLE).toBe("debugger");
    expect(DebugLocalsProvider.description.title).toBe("debugger");
    expect(DebugLocalsProvider.description.type).toBe("submenu");
  });

  it("formats paused-thread locals and call-stack fences", () => {
    const content = formatDebuggerContext({
      threadName: "main",
      localVariables: "name: x, value: 1",
      callStackSources: ["fn()", "main()"],
    });
    expect(content).toContain("paused thread: main");
    expect(content).toContain("name: x, value: 1");
    expect(content).toContain("call stack 0");
    expect(content).toContain("```\nfn()\n```");
    expect(content).toContain("call stack 1");
  });

  it("maps paused threads to submenu items by id", () => {
    expect(
      debuggerSubmenuItems([
        { id: 2, name: "worker" },
        { id: 1, name: "main" },
      ]),
    ).toEqual([
      { id: "2", title: "worker", description: "2" },
      { id: "1", title: "main", description: "1" },
    ]);
  });
});
