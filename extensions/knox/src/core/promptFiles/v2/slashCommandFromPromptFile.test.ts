import { describe, expect, it } from "vitest";

import { slashCommandFromPromptFile } from "./slashCommandFromPromptFile";

describe("slashCommandFromPromptFile", () => {
  it("parses preamble + body into a prompt-based command", () => {
    const cmd = slashCommandFromPromptFile(
      "/tmp/api.prompt",
      `---
name: api-endpoint
description: Generate an API endpoint
---
Create a REST endpoint.
{{{ input }}}`,
    );

    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("api-endpoint");
    expect(cmd!.description).toBe("Generate an API endpoint");
    expect(cmd!.prompt).toContain("Create a REST endpoint");
    expect(cmd!.prompt).toContain("{{{ input }}}");
  });

  it("folds <system> into the prompt body for client expansion", () => {
    const cmd = slashCommandFromPromptFile(
      "/tmp/sys.prompt",
      `name: with-sys
---
<system>Be concise</system>
Do the task`,
    );

    expect(cmd!.prompt).toMatch(/Be concise/);
    expect(cmd!.prompt).toMatch(/Do the task/);
  });

  it("run() fails closed (prompt path only)", async () => {
    const cmd = slashCommandFromPromptFile(
      "/tmp/x.prompt",
      "name: x\n---\nhello",
    );
    await expect(cmd!.run({} as any).next()).rejects.toThrow(/prompt-based/);
  });
});
