import { describe, expect, it, vi } from "vitest";

import { isGhAvailable, submitWithGh, type GhRunner } from "./ghHandoff";
import type { IssueDraft } from "./issueDraft";

const draft: IssueDraft = { id: "1", title: "T", body: "B", suspectedFiles: [], createdAt: "x" };
const ok = (stdout = ""): GhRunner => vi.fn(async () => ({ code: 0, stdout, stderr: "" }));

describe("gh hand-off (MC-45)", () => {
  it("makes no gh call when disabled or unconfirmed", async () => {
    const runner = ok();
    expect((await submitWithGh(draft, { enabled: false, confirmed: true, runner })).ok).toBe(false);
    const r = await submitWithGh(draft, { enabled: true, confirmed: false, runner });
    expect(r).toMatchObject({ ok: false, reason: "not_confirmed" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("creates an issue after confirmation, body via file", async () => {
    const runner = ok("https://github.com/o/r/issues/7\n");
    const r = await submitWithGh(draft, { enabled: true, confirmed: true, repo: "o/r", runner });
    expect(r).toEqual({ ok: true, url: "https://github.com/o/r/issues/7" });
    const calls = (runner as any).mock.calls.map((c: string[][]) => c[0]);
    expect(calls[0]).toEqual(["--version"]);
    expect(calls[1].slice(0, 2)).toEqual(["issue", "create"]);
    expect(calls[1]).toContain("--body-file");
    expect(calls[1]).not.toContain("B");
  });

  it("requires a valid head for PRs and a valid repo", async () => {
    const runner = ok();
    expect(await submitWithGh(draft, { enabled: true, confirmed: true, kind: "pr", runner })).toMatchObject({ reason: "invalid" });
    expect(await submitWithGh(draft, { enabled: true, confirmed: true, repo: "--evil", runner })).toMatchObject({ reason: "invalid" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports missing gh and failures", async () => {
    const missing: GhRunner = async () => ({ code: 127, stdout: "", stderr: "" });
    expect(await isGhAvailable(missing)).toBe(false);
    expect(await submitWithGh(draft, { enabled: true, confirmed: true, runner: missing })).toMatchObject({ reason: "gh_missing" });
    const failing: GhRunner = async (a) => (a[0] === "--version" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "boom" });
    expect(await submitWithGh(draft, { enabled: true, confirmed: true, runner: failing })).toMatchObject({ reason: "gh_failed", message: "boom" });
  });
});
