import { describe, expect, it, vi } from "vitest";

import { noTopLevelKeywordsMidline } from "./lineStream.js";

async function collect(
  gen: AsyncGenerator<string>,
): Promise<string[]> {
  const out: string[] = [];
  for await (const line of gen) {
    out.push(line);
  }
  return out;
}

async function* lines(...vals: string[]) {
  for (const v of vals) {
    yield v;
  }
}

describe("noTopLevelKeywordsMidline", () => {
  it("passes through top-level and indented keywords", async () => {
    const fullStop = vi.fn();
    const result = await collect(
      noTopLevelKeywordsMidline(
        lines("def foo():", "    class Bar:", "x = 1"),
        ["def", "class"],
        fullStop,
      ),
    );
    expect(result).toEqual(["def foo():", "    class Bar:", "x = 1"]);
    expect(fullStop).not.toHaveBeenCalled();
  });

  it("truncates when a keyword is glued mid-token", async () => {
    const fullStop = vi.fn();
    const result = await collect(
      noTopLevelKeywordsMidline(
        lines("xdef foo():", "ok"),
        ["def"],
        fullStop,
      ),
    );
    expect(result).toEqual(["x", "ok"]);
    expect(fullStop).toHaveBeenCalledOnce();
  });
});
