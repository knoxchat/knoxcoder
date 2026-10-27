import { describe, expect, it, vi } from "vitest";

import type { ToolExtras } from "../..";
import { recipeImpl } from "./recipe";

function extras(ide: Partial<ToolExtras["ide"]>): ToolExtras {
  return {
    ide: ide as ToolExtras["ide"],
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_recipe" } } as ToolExtras["tool"],
  };
}

describe("recipeImpl", () => {
  it("lists through recipeControl and never writes", async () => {
    const recipeControl = vi.fn(async () => ({
      content: "1 recipe(s).",
      status: "ok" as const,
    }));
    const result = await recipeImpl({ action: "list", query: "button" }, extras({ recipeControl }));
    expect(recipeControl).toHaveBeenCalledWith({
      op: "list",
      query: "button",
      recipeId: undefined,
      confirm: false,
      slotValues: undefined,
      skillPath: undefined,
      skillContent: undefined,
    });
    expect(result[0].content).toContain("1 recipe");
  });

  it("refuses apply without confirm by forwarding confirm=false", async () => {
    const recipeControl = vi.fn(async () => ({
      content: "Nothing was written.",
      status: "needs_confirm" as const,
    }));
    const result = await recipeImpl({ action: "apply", recipe_id: "abc" }, extras({ recipeControl }));
    expect(recipeControl).toHaveBeenCalledWith(expect.objectContaining({ op: "apply", recipeId: "abc", confirm: false }));
    expect(result[0].description).toBe("needs_confirm");
  });

  it("rejects unknown actions without calling the host", async () => {
    const recipeControl = vi.fn();
    const result = await recipeImpl({ action: "delete" }, extras({ recipeControl }));
    expect(recipeControl).not.toHaveBeenCalled();
    expect(result[0].content).toMatch(/not available/i);
  });

  it("reports unavailable when the IDE has no recipeControl", async () => {
    const result = await recipeImpl({ action: "list" }, extras({}));
    expect(result[0].description).toBe("unavailable");
  });
});
