import { describe, expect, it } from "vitest";

import {
  CheckpointBundleError,
  computeBundleContentSha256,
  sealCheckpointBundle,
  verifyCheckpointBundle,
} from "./checkpointBundle";

const base = {
  exportedAt: "2026-10-13T00:00:00.000Z",
  checkpointIds: [],
  messageCheckpoints: {},
  stableIdCheckpoints: {},
  checkpoints: [],
  blobs: [],
};
const recipe = {
  title: "Add Header",
  intentText: "create Header",
  intentFingerprint: "create header",
  slots: [],
  preconditions: [],
  steps: [{ kind: "write_file", path: "src/H.tsx", blobHash: "a".repeat(64) }],
};

describe("recipes in bundles (MC-63)", () => {
  it("round-trips and keeps the recipes", () => {
    const sealed = sealCheckpointBundle({ ...base, recipes: [recipe] });
    const verified = verifyCheckpointBundle(JSON.parse(JSON.stringify(sealed)));
    expect(verified.recipes).toEqual([recipe]);
  });

  it("recipes are covered by the digest (and so the HMAC): tampering is detected", () => {
    const sealed = JSON.parse(JSON.stringify(sealCheckpointBundle({ ...base, recipes: [recipe] })));
    sealed.recipes[0].steps[0].path = "../../.ssh/authorized_keys";
    expect(() => verifyCheckpointBundle(sealed)).toThrow(CheckpointBundleError);
    const added = JSON.parse(JSON.stringify(sealCheckpointBundle(base)));
    added.recipes = [recipe];
    expect(() => verifyCheckpointBundle(added)).toThrow(/contentSha256 mismatch/);
  });

  it("bundles without recipes hash exactly as before", () => {
    const withoutField = computeBundleContentSha256(base as any);
    expect(computeBundleContentSha256({ ...base, recipes: [] } as any)).toBe(withoutField);
    expect(sealCheckpointBundle(base).contentSha256).toBe(withoutField);
  });
});
