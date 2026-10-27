import { describe, expect, it } from "vitest";

import { filterRecipesByQuery, formatRecipeAgentList, toRecipeAgentRow } from "./agentView";
import type { Recipe } from "./types";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "aa".repeat(16),
    projectId: "p",
    scope: "project",
    status: "verified",
    title: "Create Button",
    intentText: "create a Button component",
    intentFingerprint: "create button component",
    slots: [{ name: "componentName", kind: "identifier" }],
    preconditions: [],
    steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "h" }],
    sourceCheckpointIds: [],
    stats: { replays: 2, ok: 2, reverted: 0, failedVerify: 0 },
    captureCount: 1,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("agentView", () => {
  it("formats a list without file bodies", () => {
    const text = formatRecipeAgentList([toRecipeAgentRow(recipe())]);
    expect(text).toContain("Create Button");
    expect(text).toContain("src/Button.tsx");
    expect(text).toContain("confirm=true");
    expect(text).not.toContain("blobHash");
  });

  it("filters by title and path", () => {
    const card = recipe({
      id: "bb".repeat(16),
      title: "Create Card",
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "h" }],
    });
    expect(filterRecipesByQuery([recipe(), card], "card").map((r) => r.title)).toEqual(["Create Card"]);
    expect(filterRecipesByQuery([recipe(), card], "src/button").map((r) => r.title)).toEqual(["Create Button"]);
  });
});
