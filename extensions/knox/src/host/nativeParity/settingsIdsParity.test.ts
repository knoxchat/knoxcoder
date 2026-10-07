import * as assert from "node:assert";

import { requireKnoxHostExtension } from "../util/knoxHostExtension";

/**
 * KN-382: live builtin still contributes the frozen knoxchat.* /
 * knox.checkpoints.* setting ids (Settings Sync + user keybindings).
 */
suite("KN-382 settings id parity", () => {
  test("package.json keeps knoxchat.* and knox.checkpoints.* settings", () => {
    const extension = requireKnoxHostExtension();
    const properties = (extension.packageJSON?.contributes?.configuration
      ?.properties ?? {}) as Record<string, unknown>;
    const ids = Object.keys(properties).filter(
      (id) => id.startsWith("knoxchat.") || id.startsWith("knox.checkpoints."),
    );

    assert.ok(ids.includes("knoxchat.showInlineTip"));
    assert.ok(ids.includes("knoxchat.enableInlineCompletions"));
    assert.ok(ids.includes("knoxchat.jev.enabled"));
    assert.ok(ids.includes("knoxchat.memoryBrain.maxBytes"));
    assert.ok(ids.includes("knox.checkpoints.enableAutoCheckpoints"));
    assert.ok(ids.includes("knox.checkpoints.auto.enabled"));
    assert.ok(ids.includes("knox.checkpoints.smart.enableMetrics"));
    assert.ok(ids.includes("knox.checkpoints.inlineDiff.enabled"));
    assert.strictEqual(ids.length, 61, "frozen KN-382 setting catalog");

    for (const id of ids) {
      assert.ok(
        id.startsWith("knoxchat.") || id.startsWith("knox.checkpoints."),
        `unexpected setting id ${id}`,
      );
    }
  });

  test("keybindings still bind knoxchat.* and knox.checkpoints.* commands", () => {
    const extension = requireKnoxHostExtension();
    const keybindings = (extension.packageJSON?.contributes?.keybindings ??
      []) as Array<{ command?: string }>;
    const commands = new Set(
      keybindings
        .map((entry) => entry.command)
        .filter(
          (id): id is string =>
            Boolean(
              id &&
                (id.startsWith("knoxchat.") || id.startsWith("knox.checkpoints.")),
            ),
        ),
    );

    for (const id of [
      "knoxchat.focusKnoxInput",
      "knoxchat.acceptDiff",
      "knoxchat.focusEdit",
      "knox.checkpoints.create",
      "knox.checkpoints.undo",
    ]) {
      assert.ok(commands.has(id), `missing keybinding ${id}`);
    }
  });
});
