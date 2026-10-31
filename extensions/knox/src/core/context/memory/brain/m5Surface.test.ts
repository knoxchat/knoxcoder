/**
 * MEM-37 — leftover M₅ yields to a live recipe on the same fingerprint.
 */
import { describe, expect, it } from "vitest";

import { intentFingerprint } from "../recipes/intentFingerprint.js";
import {
  leftoverCoveredByFingerprints,
  leftoverFingerprints,
  leftoverIntentFingerprint,
  leftoverTextCovered,
} from "./m5Surface.js";

describe("MEM-37 leftover fingerprint coverage", () => {
  it("includes each leftover field fingerprint so a recipe can own the same intent", () => {
    const howTo = "how to setup the login workflow";
    const recipeFp = leftoverIntentFingerprint(howTo);
    expect(recipeFp).toBe(intentFingerprint(howTo));
    expect(leftoverFingerprints(["Setup login workflow", howTo])).toContain(recipeFp);
    expect(leftoverFingerprints(["Setup login workflow", howTo])).toContain(
      intentFingerprint("Setup login workflow"),
    );
  });

  it("covers a leftover only on an exact shared fingerprint", () => {
    const recipeFp = leftoverIntentFingerprint("how to setup the login workflow");
    expect(
      leftoverCoveredByFingerprints(
        leftoverFingerprints(["Setup login workflow", "how to setup the login workflow"]),
        [recipeFp],
      ),
    ).toBe(true);
    expect(
      leftoverCoveredByFingerprints(leftoverFingerprints(["rotate jwt refresh tokens"]), [recipeFp]),
    ).toBe(false);
    expect(leftoverCoveredByFingerprints([""], [recipeFp])).toBe(false);
    expect(leftoverCoveredByFingerprints([recipeFp], [])).toBe(false);
  });

  it("treats a how-to query as covered when a recipe owns that fingerprint", () => {
    const query = "how to setup the login workflow";
    const recipeFp = leftoverIntentFingerprint(query);
    expect(leftoverTextCovered(query, [recipeFp])).toBe(true);
    expect(leftoverTextCovered("hello", [recipeFp])).toBe(false);
  });
});
