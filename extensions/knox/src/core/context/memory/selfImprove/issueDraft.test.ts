import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { buildIssueDraft, previewShare, saveIssueDraft, scrubForSharing } from "./issueDraft";

const HOME = "/Users/alice";
const ROOT = "/Users/alice/work/proj";

function draft() {
  return buildIssueDraft({
    findings: [{ kind: "build_fail", signature: "cannot find module <q>", count: 4, recipeIds: [] }],
    evidence: [
      {
        label: "build log",
        text: `error at ${ROOT}/src/a.ts, cfg ${HOME}/.ssh/config\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456`,
        checkpointId: "cp-1234567890abcdef",
      },
    ],
    suspectedFiles: [`${ROOT}/src/a.ts`, `${HOME}/.knoxcoder/x.json`],
    workspaceRoot: ROOT,
    homeDir: HOME,
    repro: [`cd ${ROOT}`, "run build"],
    now: new Date("2026-10-13T00:00:00Z"),
  });
}

describe("issue drafter (MC-44)", () => {
  it("contains no secrets or absolute home paths", () => {
    const d = draft();
    const all = `${d.title}\n${d.body}`;
    expect(all).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(all).not.toContain("/Users/alice");
    expect(all).not.toMatch(/\/(Users|home)\/\w+/);
    expect(all).toContain("<repo>/src/a.ts");
    expect(d.suspectedFiles).toContain("<repo>/src/a.ts");
  });

  it("scrubs windows home paths", () => {
    expect(scrubForSharing("C:\\Users\\Bob\\proj\\a.ts")).not.toContain("Bob");
  });

  it("previews exactly what is shared and saves locally", () => {
    const d = draft();
    const p = previewShare(d);
    expect(p).toContain(d.body);
    expect(p).toContain(`Title: ${d.title}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-draft-"));
    try {
      const file = saveIssueDraft(d, dir);
      expect(fs.readFileSync(file, "utf8")).toContain(d.title);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is deterministic", () => {
    expect(draft().id).toBe(draft().id);
  });
});
