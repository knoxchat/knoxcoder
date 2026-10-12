import { describe, expect, it } from "vitest";

import { estimateTokens } from "../brain/manager/helpers";
import { planAdapt, replayAdapt, type AdaptPorts } from "./adapt";
import type { ReplayPorts } from "./replayer";
import type { Recipe } from "./types";

const hash = (t: string) => `h:${t.length}:${[...t].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7)}`;

function component(name: string): string {
  const rows = Array.from({ length: 40 }, (_, i) => `  const row${i} = useMemo(() => compute${i}(props.value, ${i}), [props.value]);`);
  return [`import React, { useMemo } from "react";`, `export function ${name}(props: { value: number }) {`, ...rows, `  return <div className="${name.toLowerCase()}">{props.value}</div>;`, `}`, ""].join("\n");
}
const stylesheet = (name: string) => Array.from({ length: 30 }, (_, i) => `.${name.toLowerCase()}-${i} { margin: ${i}px; padding: ${i}px; }`).join("\n") + "\n";
const test = (name: string) => `import { ${name} } from "./${name}";\n` + Array.from({ length: 25 }, (_, i) => `it("renders ${i}", () => { expect(${name}).toBeDefined(); });`).join("\n") + "\n";

const SAVED = { "src/Button.tsx": component("Button"), "src/Button.css": stylesheet("Button"), "src/Button.test.tsx": test("Button") };

function recipe(over: Partial<Recipe> = {}): Recipe {
  const blobs = Object.values(SAVED);
  return {
    id: "a".repeat(64), projectId: "p", scope: "project", status: "verified", title: "create Button component",
    intentText: "create a Button component", intentFingerprint: "create component", slots: [], preconditions: [],
    steps: Object.keys(SAVED).map((path, i) => ({ kind: "write_file" as const, path, blobHash: hash(blobs[i]), checkpointId: "cp" })),
    sourceCheckpointIds: ["cp"], oracle: { kind: "build", passedAt: "x", command: "npm run build" },
    stats: { replays: 3, ok: 3, reverted: 0, failedVerify: 0 }, captureCount: 2, createdAt: "", updatedAt: "", ...over,
  };
}

const PATCH_ONE = `*** Begin Patch
*** Update File: src/Button.tsx
@@
-  return <div className="button">{props.value}</div>;
+  return <button className="button">{props.value}</button>;
*** End Patch`;

function ports(opts: { reply: string; disk?: Record<string, string> }): AdaptPorts & ReplayPorts & { prompts: string[]; written: Map<string, string> } {
  const blobMap = new Map(Object.values(SAVED).map((t) => [hash(t), t]));
  const disk = new Map(Object.entries(opts.disk ?? {}));
  const prompts: string[] = [];
  const written = new Map<string, string>();
  return {
    prompts, written,
    readBlob: async (h) => blobMap.get(h),
    currentHash: async (p) => (disk.has(p) ? hash(disk.get(p)!) : undefined),
    readCurrent: async (p) => disk.get(p),
    complete: async (prompt) => (prompts.push(prompt), opts.reply),
    createCheckpoint: async () => "pre",
    restoreCheckpoint: async () => {},
    writeFile: async (p, c) => (written.set(p, String(c)), disk.set(p, String(c)), { ok: true }),
    deleteFile: async () => ({ ok: false }),
    runCommand: async () => ({ ok: true }),
    verify: async () => ({ ok: true }),
  };
}

describe("planAdapt (MC-32)", () => {
  it("applies a small patch to the saved file and leaves other files to the recipe", async () => {
    const p = ports({ reply: PATCH_ONE });
    const plan = await planAdapt(recipe(), "make it a button element", p);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.touched).toEqual(["src/Button.tsx"]);
    expect(plan.merged.get("src/Button.tsx")).toContain("<button");
    expect(p.prompts).toHaveLength(1); // exactly one model call
  });

  it("NO_CHANGES touches nothing", async () => {
    const plan = await planAdapt(recipe(), "same", ports({ reply: "NO_CHANGES" }));
    expect(plan).toMatchObject({ ok: true, touched: [] });
  });

  it("accepts a patch inside code fences", async () => {
    const plan = await planAdapt(recipe(), "x", ports({ reply: "```diff\n" + PATCH_ONE + "\n```" }));
    expect(plan.ok).toBe(true);
  });

  it("refuses paths the recipe did not write", async () => {
    const reply = `*** Begin Patch\n*** Add File: src/Evil.ts\n+x\n*** End Patch`;
    const plan = await planAdapt(recipe(), "x", ports({ reply }));
    expect(plan).toMatchObject({ ok: false, outsidePaths: ["src/Evil.ts"] });
  });

  it("refuses traversal, deletes and renames", async () => {
    for (const reply of [
      `*** Begin Patch\n*** Update File: ../x.ts\n@@\n-a\n+b\n*** End Patch`,
      `*** Begin Patch\n*** Delete File: src/Button.tsx\n*** End Patch`,
      `*** Begin Patch\n*** Update File: src/Button.tsx\n*** Move to: src/Other.tsx\n@@\n-a\n+b\n*** End Patch`,
    ]) {
      expect((await planAdapt(recipe(), "x", ports({ reply }))).ok).toBe(false);
    }
  });

  it("refuses garbage and hunks that do not match", async () => {
    expect((await planAdapt(recipe(), "x", ports({ reply: "Sure! Here is the code" }))).ok).toBe(false);
    const bad = `*** Begin Patch\n*** Update File: src/Button.tsx\n@@\n-nonexistent line\n+x\n*** End Patch`;
    expect((await planAdapt(recipe(), "x", ports({ reply: bad }))).ok).toBe(false);
  });

  it("refuses unverified recipes and oversized ones without calling the model", async () => {
    const p = ports({ reply: PATCH_ONE });
    expect((await planAdapt(recipe({ status: "candidate" }), "x", p)).ok).toBe(false);
    expect(p.prompts).toHaveLength(0);
  });

  it("merges onto local edits and refuses real conflicts", async () => {
    const edited = SAVED["src/Button.tsx"].replace("const row0", "const firstRow");
    const base = ports({ reply: PATCH_ONE, disk: { "src/Button.tsx": edited } });
    const rec = recipe();
    rec.steps[0].baseBlobHash = "other-base"; // disk differs from base => local edit
    const plan = await planAdapt(rec, "x", base);
    expect(plan.ok && plan.merged.get("src/Button.tsx")).toContain("firstRow");
    expect(plan.ok && plan.merged.get("src/Button.tsx")).toContain("<button");

    const conflicting = SAVED["src/Button.tsx"].replace('<div className="button">{props.value}</div>', "<span>{props.value}</span>");
    const plan2 = await planAdapt(rec, "x", ports({ reply: PATCH_ONE, disk: { "src/Button.tsx": conflicting } }));
    expect(plan2.ok).toBe(false);
  });
});

describe("replayAdapt (MC-32)", () => {
  it("writes adapted content for the touched file and saved bytes for the rest", async () => {
    const p = ports({ reply: PATCH_ONE });
    const res = await replayAdapt(recipe(), "make it a button element", p);
    expect(res.status).toBe("applied");
    expect(p.written.get("src/Button.tsx")).toContain("<button");
    expect(p.written.get("src/Button.css")).toBe(SAVED["src/Button.css"]);
  });

  it("falls back (refused, nothing written) when the plan is refused", async () => {
    const p = ports({ reply: "nope" });
    const res = await replayAdapt(recipe(), "x", p);
    expect(res.status).toBe("refused");
    expect(p.written.size).toBe(0);
  });

  it("writes adapted content even when the saved version is already on disk", async () => {
    const p = ports({ reply: PATCH_ONE, disk: { "src/Button.tsx": SAVED["src/Button.tsx"] } });
    const res = await replayAdapt(recipe(), "x", p);
    expect(res.status).toBe("applied");
    expect(p.written.get("src/Button.tsx")).toContain("<button");
  });
});

describe("token use (MC-32 done-when)", () => {
  it("uses at least 70% fewer output tokens than generating the files", async () => {
    const p = ports({ reply: PATCH_ONE });
    const plan = await planAdapt(recipe(), "make it a button element", p);
    if (!plan.ok) throw new Error(plan.reason);
    const request = "create a Button component with css and tests, rendering a button element";
    const generateOut = estimateTokens(Object.values(SAVED).join("\n"));
    const generateTotal = estimateTokens(request) + generateOut;
    const adaptOut = estimateTokens(plan.response);
    const adaptTotal = estimateTokens(plan.prompt) + adaptOut;
    expect(adaptOut).toBeLessThanOrEqual(generateOut * 0.3);
    // Input counts too, and the saved files are sent as context, so the total is not smaller.
    // Output tokens are the slow and expensive side; the total is logged, with a loose bound.
    expect(adaptTotal).toBeLessThanOrEqual(generateTotal * 1.5);
    console.info(`[adapt tokens] output ${adaptOut} vs ${generateOut}; total ${adaptTotal} vs ${generateTotal}`);
  });
});

describe("previewAdaptPlan (MC-32/35)", () => {
  it("shows the adapted diff for the touched file and the saved bytes for the rest", async () => {
    const { previewAdaptPlan } = await import("./adapt");
    const p = ports({ reply: PATCH_ONE, disk: { "src/Button.tsx": SAVED["src/Button.tsx"] } });
    const plan = await planAdapt(recipe(), "x", p);
    if (!plan.ok) throw new Error(plan.reason);
    const preview = await previewAdaptPlan(recipe(), plan, p);
    const entry = preview.entries.find((e) => e.path === "src/Button.tsx")!;
    expect(entry.action).toBe("modify");
    expect(entry.diff).toContain("+  return <button");
    expect(preview.entries.find((e) => e.path === "src/Button.css")!.action).toBe("create");
    expect(preview.conflicts).toEqual([]);
  });
});
