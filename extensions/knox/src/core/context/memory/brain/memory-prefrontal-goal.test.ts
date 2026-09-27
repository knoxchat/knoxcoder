/**
 * REL-07 — Session-scoped prefrontal C_goal.
 */
import { describe, expect, it } from "vitest";

import {
  formatMemoryGoal,
  PrefrontalCortex,
} from "./regions/PrefrontalCortex.js";

describe("REL-07 session-scoped goal", () => {
  it("get/set/clear are isolated per session id", () => {
    PrefrontalCortex.resetAll();
    PrefrontalCortex.setGoal("Fix auth in session A", "sess-a");
    PrefrontalCortex.setGoal("Style the button", "sess-b");

    expect(PrefrontalCortex.getGoal("sess-a")).toBe("Fix auth in session A");
    expect(PrefrontalCortex.getGoal("sess-b")).toBe("Style the button");

    PrefrontalCortex.clearGoal("sess-a");
    expect(PrefrontalCortex.getGoal("sess-a")).toBeNull();
    expect(PrefrontalCortex.getGoal("sess-b")).toBe("Style the button");
  });

  it("two concurrent sessions cannot clobber each other's goal", () => {
    PrefrontalCortex.resetAll();
    PrefrontalCortex.switchSession("sess-a");
    PrefrontalCortex.setGoal("Auth work", "sess-a");

    PrefrontalCortex.switchSession("sess-b");
    PrefrontalCortex.setGoal("README badges", "sess-b");

    expect(PrefrontalCortex.getGoal("sess-a")).toBe("Auth work");
    expect(PrefrontalCortex.getGoal("sess-b")).toBe("README badges");
    expect(PrefrontalCortex.resolveGoal(undefined, "sess-a")).toBe("Auth work");
  });

  it("hippocampus feedback does not overwrite C_goal", () => {
    PrefrontalCortex.resetAll();
    PrefrontalCortex.setGoal("how do I style the button?", "sess-a");
    PrefrontalCortex.feedbackFromHippocampus(
      { title: "Decision: use postgres", category: "decision" },
      "sess-a",
    );
    expect(PrefrontalCortex.getGoal("sess-a")).toBe("how do I style the button?");
    expect(PrefrontalCortex.getRecentKnowledgeHint("sess-a")).toBe(
      "Decision: use postgres",
    );
  });

  it("amygdala feedback does not set C_goal", () => {
    PrefrontalCortex.resetAll();
    PrefrontalCortex.feedbackFromAmygdala(
      "URGENT CRITICAL: fix authentication now!!!",
      0.95,
    );
    expect(PrefrontalCortex.getGoal()).toBeNull();
  });

  it("formatMemoryGoal prefers plan title, else first line", () => {
    expect(formatMemoryGoal("how do I style the button?", "Ship login")).toBe(
      "Ship login",
    );
    expect(
      formatMemoryGoal("first line ask\nsecond line details"),
    ).toBe("first line ask");
    expect(formatMemoryGoal("   ")).toBeUndefined();
  });
});
