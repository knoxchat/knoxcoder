import { describe, expect, it } from "vitest";

import {
  formatCheckpointInjectPointer,
  formatCheckpointMetadataLeaf,
  isCheckpointPointerLeaf,
  looksLikeCheckpointDump,
  parseCheckpointPointerLeaf,
} from "./checkpointPointer.js";
import {
  extractSoulCheckpointId,
  extractSoulFiles,
  formatLinkedRestoreOffer,
  formatRestoreNotice,
  formatSettledToolSummary,
  formatSoulCheckpointStamp,
  formatSoulEventContent,
} from "./extractToolFiles.js";
import { MAX_SOUL_HISTORY, trimSoulHistory } from "./recordSoulEvent.js";
import {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "./memoryAccess.js";

describe("extractSoulFiles", () => {
  it("collects filepath and apply_patch paths", () => {
    expect(
      extractSoulFiles("builtin_edit_file", {
        filepath: "src/a.ts",
        old_string: "x",
        new_string: "y",
      }),
    ).toEqual(["src/a.ts"]);

    const files = extractSoulFiles("builtin_apply_patch", {
      patch: `*** Begin Patch
*** Add File: src/b.ts
+export const x = 1;
*** Update File: src/a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`,
    });
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
  });
});

describe("soul formatters", () => {
  it("formats a soul event and restore notice", () => {
    const content = formatSoulEventContent({
      kind: "tool_success",
      toolName: "builtin_edit_file",
      files: ["src/a.ts"],
      workspaceCheckpointId: "cp-1",
      ok: true,
      summary: "replaced x",
    });
    expect(content).toContain("tool=builtin_edit_file");
    expect(content).toContain("checkpoint_id=cp-1");
    expect(content).toContain("src/a.ts");

    const notice = formatRestoreNotice({
      checkpointId: "cp-1",
      description: "before edit",
      restoredFiles: ["src/a.ts"],
    });
    expect(notice).toContain("## Workspace restore");
    expect(notice).toContain("cp-1");
    expect(notice).toContain("src/a.ts");
    expect(notice).toContain("Memory was not rewound");
    expect(notice).toContain("rewind_memory=true");

    const rewound = formatRestoreNotice({
      checkpointId: "cp-1",
      restoredFiles: ["src/a.ts"],
      memoryRewound: true,
      memoryMessage: "Trimmed 2 later episodic turns",
    });
    expect(rewound).toContain("Working memory was rewound");
    expect(rewound).toContain("Trimmed 2 later episodic turns");
  });

  it("stamps and extracts a workspace checkpoint id", () => {
    const stamp = formatSoulCheckpointStamp("cp-1");
    expect(extractSoulCheckpointId(stamp)).toBe("cp-1");
    expect(
      extractSoulCheckpointId([{ content: "ok" }, { content: stamp }]),
    ).toBe("cp-1");
  });

  it("formats settled tools for post-turn memory", () => {
    expect(formatSettledToolSummary([])).toBe("");
    const summary = formatSettledToolSummary([
      { name: "builtin_edit_file", status: "done", files: ["src/a.ts"], ok: true },
      { name: "builtin_run_terminal_command", status: "canceled", ok: false },
    ]);
    expect(summary).toContain("## Tools this turn");
    expect(summary).toContain("builtin_edit_file ok");
    expect(summary).toContain("files=src/a.ts");
    expect(summary).toContain("builtin_run_terminal_command fail");
    expect(summary).toContain("status=canceled");
  });

  it("offers linked file restore without auto-rewinding", () => {
    const offer = formatLinkedRestoreOffer("cp-1");
    expect(offer).toContain("cp-1");
    expect(offer).toContain("builtin_workspace_checkpoint");
    expect(formatLinkedRestoreOffer()).toBe("");
  });
});

describe("checkpoint pointer leaf (MEM-38)", () => {
  it("stores metadata and injects a pointer, never snapshot JSON", () => {
    const stored = formatCheckpointMetadataLeaf({
      workspaceCheckpointId: "ws-auth",
      memoryCheckpointId: 7,
      label: "workspace ws-auth: auth fix",
      sessionId: "sess-1",
      files: ["src/auth.ts", "src/login.ts"],
      recipeIds: ["recipe-auth"],
    });
    expect(stored).toContain("checkpoint_id=ws-auth");
    expect(stored).toContain("turn that changed: src/auth.ts, src/login.ts");
    expect(stored).toContain("recipes: recipe-auth");
    expect(stored).not.toContain("fileSnapshots");
    expect(looksLikeCheckpointDump(stored)).toBe(false);
    expect(isCheckpointPointerLeaf(stored, { kind: "checkpoint", workspaceCheckpointId: "ws-auth" })).toBe(true);

    const parsed = parseCheckpointPointerLeaf(stored, {
      kind: "checkpoint",
      workspaceCheckpointId: "ws-auth",
      files: ["src/auth.ts", "src/login.ts"],
      recipeIds: ["recipe-auth"],
    });
    expect(parsed?.files).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(parsed?.recipeIds).toEqual(["recipe-auth"]);

    const injected = formatCheckpointInjectPointer({
      cite: "[mem:episodic:9]",
      workspaceCheckpointId: "ws-auth",
      label: "workspace ws-auth: auth fix",
    });
    expect(injected).toBe("[mem:episodic:9] checkpoint_id=ws-auth workspace ws-auth: auth fix");
    expect(injected).not.toContain("{");
    expect(looksLikeCheckpointDump(injected)).toBe(false);
  });
});

describe("trimSoulHistory", () => {
  it("keeps mutating events when the ring overflows with reads", () => {
    const events = Array.from({ length: MAX_SOUL_HISTORY + 5 }, (_, i) => ({
      sessionId: "s",
      kind: "tool_success" as const,
      files: i === 3 || i === 22 ? ["src/a.ts"] : [],
      toolName: i === 3 || i === 22 ? "builtin_edit_file" : "builtin_read_file",
      ok: true,
      summary: "x",
      episodicId: i + 1,
      ...(i === 22 ? { oracle: { kind: "lsp" as const, passed: true } } : {}),
    }));
    const trimmed = trimSoulHistory(events);
    expect(trimmed).toHaveLength(MAX_SOUL_HISTORY);
    expect(trimmed.some((e) => e.files.includes("src/a.ts") && e.episodicId === 4)).toBe(true);
    expect(trimmed.some((e) => e.oracle && e.episodicId === 23)).toBe(true);
  });
});

describe("memory access", () => {
  it("allows recall and blocks store", () => {
    expect(isMemoryReadAction("recall")).toBe(true);
    expect(isMemoryReadAction("search_entities")).toBe(true);
    expect(isMemoryReadAction("store")).toBe(false);
    expect(memoryWriteBlockedMessage("store")).toContain("store");
  });
});
