import * as assert from "node:assert";

import {
  AGENT_MODE_CONTEXT_KEY,
  AgentModeStatus,
  isAgentModeStatusOn,
} from "./agentModeStatus";

suite("isAgentModeStatusOn", () => {
  test("inactive is off", () => {
    assert.strictEqual(isAgentModeStatusOn(AgentModeStatus.INACTIVE), false);
    assert.strictEqual(isAgentModeStatusOn("inactive"), false);
  });

  test("active / processing / error are on", () => {
    assert.strictEqual(isAgentModeStatusOn(AgentModeStatus.ACTIVE), true);
    assert.strictEqual(isAgentModeStatusOn(AgentModeStatus.PROCESSING), true);
    assert.strictEqual(isAgentModeStatusOn(AgentModeStatus.ERROR), true);
  });

  test("KN-350 context key id is knoxAgentModeActive", () => {
    assert.strictEqual(AGENT_MODE_CONTEXT_KEY, "knoxAgentModeActive");
  });
});
