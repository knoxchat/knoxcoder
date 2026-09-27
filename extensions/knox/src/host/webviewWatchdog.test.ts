import * as assert from "node:assert";

import {
  WEBVIEW_HEARTBEAT_STALE_MS,
  WEBVIEW_MAX_RELOADS,
  WEBVIEW_RELOAD_DECAY_MS,
  WEBVIEW_STARTUP_STALE_MS,
  applyWatchdogFocus,
  applyWatchdogHeartbeat,
  applyWatchdogReload,
  applyWatchdogUserReload,
  applyWatchdogViewReady,
  applyWatchdogVisibility,
  decideWebviewWatchdog,
  initialWebviewWatchdogState,
} from "./webviewWatchdog";

suite("webviewWatchdog (CSLD-20)", () => {
  test("does not reload while hidden", () => {
    let state = initialWebviewWatchdogState();
    state = applyWatchdogViewReady(state, 0, false);
    assert.strictEqual(decideWebviewWatchdog(state, WEBVIEW_STARTUP_STALE_MS + 1), "ok");
  });

  test("does not reload or give up while the window is unfocused", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    state = applyWatchdogFocus(state, false, 2_000);
    assert.strictEqual(decideWebviewWatchdog(state, 1_000_000), "ok");
  });

  test("reloads after missed heartbeats, then gives up", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    assert.strictEqual(
      decideWebviewWatchdog(state, 1_000 + WEBVIEW_HEARTBEAT_STALE_MS - 1),
      "ok",
    );
    assert.strictEqual(
      decideWebviewWatchdog(state, 1_000 + WEBVIEW_HEARTBEAT_STALE_MS + 1),
      "reload",
    );

    state = applyWatchdogReload(state, 20_000);
    state = applyWatchdogReload(state, 40_000);
    assert.strictEqual(state.reloadCount, WEBVIEW_MAX_RELOADS);
    assert.strictEqual(decideWebviewWatchdog(state, 40_000 + 60_000), "give-up");
  });

  test("does not storm reloads during backoff", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    state = applyWatchdogReload(state, 20_000);
    assert.strictEqual(decideWebviewWatchdog(state, 20_001), "ok");
  });

  test("decays reload count after a healthy interval", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true);
    state = applyWatchdogReload(state, 10_000);
    state = applyWatchdogHeartbeat(state, 11_000);
    assert.strictEqual(state.reloadCount, 1);
    state = applyWatchdogHeartbeat(state, 11_000 + WEBVIEW_RELOAD_DECAY_MS);
    assert.strictEqual(state.reloadCount, 0);
  });

  test("user reload resets the storm counter", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true);
    state = applyWatchdogReload(state, 10_000);
    state = applyWatchdogReload(state, 30_000);
    state = applyWatchdogUserReload(state, 50_000, true);
    assert.strictEqual(state.reloadCount, 0);
    assert.strictEqual(decideWebviewWatchdog(state, 50_001), "ok");
  });

  test("becoming visible after a long hide does not immediately reload", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    state = applyWatchdogVisibility(state, false, 2_000);
    assert.strictEqual(decideWebviewWatchdog(state, 1_000_000), "ok");

    state = applyWatchdogVisibility(state, true, 1_000_000);
    assert.strictEqual(decideWebviewWatchdog(state, 1_000_000), "ok");
    assert.strictEqual(
      decideWebviewWatchdog(state, 1_000_000 + WEBVIEW_STARTUP_STALE_MS - 1),
      "ok",
    );
    assert.strictEqual(
      decideWebviewWatchdog(state, 1_000_000 + WEBVIEW_STARTUP_STALE_MS + 1),
      "reload",
    );
  });

  test("refocusing after minutes away does not immediately reload", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    state = applyWatchdogFocus(state, false, 2_000);
    state = applyWatchdogFocus(state, true, 10 * 60_000);
    assert.strictEqual(decideWebviewWatchdog(state, 10 * 60_000), "ok");
    assert.strictEqual(
      decideWebviewWatchdog(state, 10 * 60_000 + WEBVIEW_STARTUP_STALE_MS - 1),
      "ok",
    );
    assert.strictEqual(
      decideWebviewWatchdog(state, 10 * 60_000 + WEBVIEW_STARTUP_STALE_MS + 1),
      "reload",
    );
  });

  test("heartbeat after resume keeps the view alive", () => {
    let state = applyWatchdogViewReady(initialWebviewWatchdogState(), 0, true, true);
    state = applyWatchdogHeartbeat(state, 1_000);
    state = applyWatchdogFocus(state, false, 2_000);
    state = applyWatchdogFocus(state, true, 10 * 60_000);
    const beatAt = 10 * 60_000 + 1_000;
    state = applyWatchdogHeartbeat(state, beatAt);
    assert.strictEqual(
      decideWebviewWatchdog(state, beatAt + WEBVIEW_HEARTBEAT_STALE_MS - 1),
      "ok",
    );
  });
});
