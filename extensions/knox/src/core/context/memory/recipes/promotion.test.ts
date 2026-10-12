import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { RecipeStore } from "./RecipeStore";
import { PROMOTION_MIN_SUCCESSES, acceptRecipe, decidePromotion, promoteIfEligible } from "./promotion";
import type { NewRecipeInput } from "./types";

let dir: string;
let db: Awaited<ReturnType<typeof open>>;
let store: RecipeStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-promo-"));
  db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
  await applyBrainPragmas(db);
  await createTables(db);
  store = new RecipeStore(db as any);
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z" };

function input(over: Partial<NewRecipeInput> = {}): NewRecipeInput {
  return {
    projectId: "p1",
    intentFingerprint: "create button",
    steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa", checkpointId: "cp1" }],
    oracle,
    ...over,
  };
}

describe("decidePromotion (pure)", () => {
  const base = { status: "candidate" as const, oracle };

  it("needs a candidate", () => {
    for (const status of ["verified", "quarantined", "retired"] as const) {
      expect(decidePromotion({ status, oracle, userAcceptedAt: "x" }, 5)).toEqual({
        promote: false,
        reason: "not_candidate",
      });
    }
  });

  it("never promotes without an oracle pass, even with accept and repeats", () => {
    expect(decidePromotion({ status: "candidate", userAcceptedAt: "x" }, 9)).toEqual({
      promote: false,
      reason: "no_oracle",
    });
  });

  it("waits for evidence after a single pass", () => {
    expect(decidePromotion(base, 1)).toEqual({ promote: false, reason: "awaiting_evidence" });
  });

  it("promotes on user accept", () => {
    expect(decidePromotion({ ...base, userAcceptedAt: "x" }, 1)).toEqual({ promote: true, reason: "user_accepted" });
  });

  it("promotes on repeated success", () => {
    expect(decidePromotion(base, PROMOTION_MIN_SUCCESSES)).toEqual({ promote: true, reason: "repeat_success" });
  });
});

describe("promoteIfEligible", () => {
  it("keeps a single-pass candidate as candidate", async () => {
    const { recipe } = await store.create(input());
    const res = await promoteIfEligible(store, recipe.id);
    expect(res.promoted).toBe(false);
    expect(res.recipe.status).toBe("candidate");
  });

  it("promotes after the user accepts the diff", async () => {
    const { recipe } = await store.create(input());
    const res = await acceptRecipe(store, recipe.id);
    expect(res.promoted).toBe(true);
    expect(res.decision).toEqual({ promote: true, reason: "user_accepted" });
    expect(res.recipe.status).toBe("verified");
    expect(res.recipe.userAcceptedAt).toBeTruthy();
  });

  it("promotes when identical work is captured twice", async () => {
    const { recipe } = await store.create(input());
    await store.recordCapture(recipe.id, oracle);
    const res = await promoteIfEligible(store, recipe.id);
    expect(res.promoted).toBe(true);
    expect(res.decision).toEqual({ promote: true, reason: "repeat_success" });
    expect(res.recipe.captureCount).toBe(2);
  });

  it("counts the same intent across different work in the same project only", async () => {
    const a = await store.create(input());
    await store.create(
      input({ steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "bbb", checkpointId: "cp2" }] }),
    );
    expect((await promoteIfEligible(store, a.recipe.id)).promoted).toBe(true);

    const other = await store.create(
      input({
        projectId: "p2",
        steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "ccc", checkpointId: "cp3" }],
      }),
    );
    expect((await promoteIfEligible(store, other.recipe.id)).promoted).toBe(false);
  });

  it("does not count quarantined or retired siblings as evidence", async () => {
    const a = await store.create(input());
    const b = await store.create(
      input({ steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "bbb", checkpointId: "cp2" }] }),
    );
    await store.quarantine(b.recipe.id);
    expect((await promoteIfEligible(store, a.recipe.id)).promoted).toBe(false);
    await store.retire(b.recipe.id);
    expect((await promoteIfEligible(store, a.recipe.id)).promoted).toBe(false);
  });

  it("an accept without an oracle pass does not promote", async () => {
    const { recipe } = await store.create(input({ oracle: undefined }));
    const res = await acceptRecipe(store, recipe.id);
    expect(res.promoted).toBe(false);
    expect(res.decision).toEqual({ promote: false, reason: "no_oracle" });
    expect(res.recipe.status).toBe("candidate");
  });

  it("does not revive a quarantined recipe, or re-count it", async () => {
    const { recipe } = await store.create(input());
    await store.quarantine(recipe.id);
    await expect(store.recordCapture(recipe.id, oracle)).rejects.toThrow();
    await expect(store.recordUserAccept(recipe.id)).rejects.toThrow();
    const res = await promoteIfEligible(store, recipe.id);
    expect(res.decision).toEqual({ promote: false, reason: "not_candidate" });
    expect(res.recipe.status).toBe("quarantined");
  });

  it("is idempotent once verified", async () => {
    const { recipe } = await store.create(input());
    await acceptRecipe(store, recipe.id);
    const again = await promoteIfEligible(store, recipe.id);
    expect(again.promoted).toBe(false);
    expect(again.recipe.status).toBe("verified");
  });
});
