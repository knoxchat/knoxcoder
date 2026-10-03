import { describe, expect, it } from "vitest";

import slashCommands from "./index";

describe("slash command catalog (KN-092)", () => {
  it("includes /autonomous, /commit, and /skills", () => {
    const names = slashCommands.map((command) => command.name);
    expect(names).toEqual([
      "autonomous",
      "issue",
      "share",
      "cmd",
      "http",
      "commit",
      "review",
      "pr",
      "changelog",
      "skills",
      "init",
      "instructions",
    ]);
  });
});
