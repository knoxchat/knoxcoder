import * as assert from "node:assert";

import { requireKnoxHostExtension } from "../util/knoxHostExtension";

/**
 * Phase 9: the in-tree builtin ships the same GUI commands / view as ./knox.
 * Runtime chat now lives in the native workbench pane (`KnoxChatViewPane`),
 * not the Vite webview bundle.
 */
suite("Phase 9 GUI feature parity (KN-090–096)", () => {
  test("contributes chat session, apply-from-chat, settings, and Knox view", () => {
    const extension = requireKnoxHostExtension();
    const contributes = extension.packageJSON?.contributes ?? {};
    const commands = (
      (contributes.commands ?? []) as Array<{ command: string }>
    ).map((entry) => entry.command);

    for (const id of [
      "knoxchat.newSession",
      "knoxchat.applyCodeFromChat",
      "knoxchat.openConfigPage",
      "knoxchat.focusKnoxInput",
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }

    const containers = contributes.viewsContainers?.secondarySidebar ?? [];
    const knoxContainer = (containers as Array<{ id: string }>).some(
      (entry) => entry.id === "knoxchat",
    );
    assert.ok(knoxContainer, "secondary sidebar container knoxchat");

    const knoxViews = contributes.views?.knoxchat ?? [];
    assert.ok(
      (knoxViews as Array<{ id: string }>).some(
        (view) => view.id === "knoxchat.knoxGUIView",
      ),
      "knoxchat.knoxGUIView (native workbench pane)",
    );
  });
});
