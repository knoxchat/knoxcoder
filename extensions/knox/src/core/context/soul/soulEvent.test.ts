import { describe, expect, it } from "vitest";

import {
  extractSoulCheckpointId,
  extractSoulFiles,
  formatLinkedRestoreOffer,
  formatRestoreNotice,
  formatSettledToolSummary,
  formatSoulCheckpointStamp,
  formatSoulEventContent,
} from "./extractToolFiles.js";
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
    expect(content).toContain("checkpoint=cp-1");
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

describe("memory access", () => {
  it("allows recall and blocks store", () => {
    expect(isMemoryReadAction("recall")).toBe(true);
    expect(isMemoryReadAction("search_entities")).toBe(true);
    expect(isMemoryReadAction("store")).toBe(false);
    expect(memoryWriteBlockedMessage("store")).toContain("store");
  });
});
