import * as assert from "node:assert";
import * as path from "path";

import {
  buildShadowDiffOpen,
  countFileLines,
  decideApplyShadowCommand,
  decideShadowAcceptRoute,
  isShadowPreviewEnabled,
  isShadowPreviewLargeFilesEnabled,
  normalizeFsPath,
  resolveShadowRelativePath,
  resolveShadowTarget,
  SHADOW_DIFF_VISIBLE_CONTEXT,
  SHADOW_LARGE_FILE_LINE_LIMIT,
  SHADOW_PREVIEW_COMMANDS,
  SHADOW_PREVIEW_LARGE_FILES_SETTING,
  SHADOW_PREVIEW_SETTING,
  ShadowPreviewStore,
  shouldPreviewApply,
  VSCODE_DIFF_COMMAND,
  type PendingShadowEdit,
} from "./shadowWorkspace";

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
}

function pending(
  originalPath: string,
  shadowPath = `${originalPath}.shadow`,
): PendingShadowEdit {
  return {
    originalPath,
    shadowPath,
    proposedContent: "proposed",
  };
}

suite("shadowWorkspace helpers", () => {
  test("normalizeFsPath strips file:// and normalizes", () => {
    const abs = path.join(path.sep, "tmp", "a.ts");
    assert.strictEqual(
      normalizeFsPath(`file://${abs}`),
      path.normalize(abs),
    );
    assert.strictEqual(
      normalizeFsPath(path.join("a", "..", "b", "c.ts")),
      path.normalize(path.join("b", "c.ts")),
    );
  });

  test("resolveShadowRelativePath keeps workspace-relative layout", () => {
    const root = path.join(path.sep, "ws");
    const file = path.join(root, "src", "a.ts");
    assert.strictEqual(
      resolveShadowRelativePath(file, root),
      path.join("src", "a.ts"),
    );
  });

  test("resolveShadowRelativePath uses _external for outside workspace", () => {
    const rel = resolveShadowRelativePath(
      path.join(path.sep, "other", "x.ts"),
      path.join(path.sep, "ws"),
    );
    assert.ok(rel.startsWith("_external"));
    assert.ok(rel.includes("x.ts") || rel.length > 0);
  });

  test("isShadowPreviewEnabled reads setting key", () => {
    assert.strictEqual(
      isShadowPreviewEnabled((k) =>
        k === SHADOW_PREVIEW_SETTING ? true : undefined,
      ),
      true,
    );
    assert.strictEqual(
      isShadowPreviewEnabled((k) =>
        k === SHADOW_PREVIEW_SETTING ? false : undefined,
      ),
      false,
    );
  });

  test("shouldPreviewApply gates empty / identical / disabled", () => {
    assert.strictEqual(
      shouldPreviewApply({
        enabled: false,
        fileExists: true,
        currentContent: "a",
        proposedContent: "b",
      }),
      false,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: false,
        currentContent: "a",
        proposedContent: "b",
      }),
      false,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: "   ",
        proposedContent: "b",
      }),
      false,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: "same",
        proposedContent: "same",
      }),
      false,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: "old",
        proposedContent: "new",
      }),
      true,
    );
  });
});

suite("KN-343 shadow preview", () => {
  test("settings, commands, vscode.diff, and 4000-line limit stay named", () => {
    assert.strictEqual(SHADOW_PREVIEW_SETTING, "knoxchat.enableShadowPreview");
    assert.strictEqual(
      SHADOW_PREVIEW_LARGE_FILES_SETTING,
      "knoxchat.shadowPreviewLargeFiles",
    );
    assert.strictEqual(SHADOW_LARGE_FILE_LINE_LIMIT, 4000);
    assert.strictEqual(VSCODE_DIFF_COMMAND, "vscode.diff");
    assert.strictEqual(SHADOW_DIFF_VISIBLE_CONTEXT, "knox.shadowDiffVisible");
    assert.strictEqual(
      SHADOW_PREVIEW_COMMANDS.accept,
      "knox.acceptShadowChanges",
    );
    assert.strictEqual(
      SHADOW_PREVIEW_COMMANDS.reject,
      "knox.rejectShadowChanges",
    );
    assert.strictEqual(
      SHADOW_PREVIEW_COMMANDS.apply,
      "knox.applyShadowChanges",
    );
    assert.strictEqual(
      SHADOW_PREVIEW_COMMANDS.showDiffView,
      "knox.showDiffView",
    );
  });

  test("skip files over 4000 lines unless shadowPreviewLargeFiles", () => {
    assert.strictEqual(
      isShadowPreviewLargeFilesEnabled((k) =>
        k === SHADOW_PREVIEW_LARGE_FILES_SETTING ? true : undefined,
      ),
      true,
    );
    assert.strictEqual(
      isShadowPreviewLargeFilesEnabled((k) =>
        k === SHADOW_PREVIEW_LARGE_FILES_SETTING ? false : undefined,
      ),
      false,
    );

    const atLimit = lines(SHADOW_LARGE_FILE_LINE_LIMIT);
    const overLimit = lines(SHADOW_LARGE_FILE_LINE_LIMIT + 1);
    assert.strictEqual(countFileLines(atLimit), 4000);
    assert.strictEqual(countFileLines(overLimit), 4001);

    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: atLimit,
        proposedContent: `${atLimit}\n// patched`,
      }),
      true,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: overLimit,
        proposedContent: `${overLimit}\n// patched`,
      }),
      false,
    );
    assert.strictEqual(
      shouldPreviewApply({
        enabled: true,
        fileExists: true,
        currentContent: overLimit,
        proposedContent: `${overLimit}\n// patched`,
        allowLargeFiles: true,
      }),
      true,
    );
  });

  test("vscode.diff opens original on the left and shadow on the right", () => {
    const edit = pending("/ws/src/a.ts", "/tmp/knox-shadow/src/a.ts");
    assert.deepStrictEqual(buildShadowDiffOpen(edit), {
      command: "vscode.diff",
      originalPath: "/ws/src/a.ts",
      shadowPath: "/tmp/knox-shadow/src/a.ts",
      titleFile: "a.ts",
    });
  });

  test("Accept with a waiter only resolves; standalone uses apply handler then raw write", () => {
    assert.strictEqual(
      decideShadowAcceptRoute({ hasWaiter: true, hasApplyHandler: true }),
      "waiter",
    );
    assert.strictEqual(
      decideShadowAcceptRoute({ hasWaiter: true, hasApplyHandler: false }),
      "waiter",
    );
    assert.strictEqual(
      decideShadowAcceptRoute({ hasWaiter: false, hasApplyHandler: true }),
      "apply-handler",
    );
    assert.strictEqual(
      decideShadowAcceptRoute({ hasWaiter: false, hasApplyHandler: false }),
      "raw-write",
    );
  });

  test("applyShadowChanges accepts a path, else all when several pending", () => {
    assert.strictEqual(
      decideApplyShadowCommand({ filePath: "/a.ts", pendingCount: 3 }),
      "accept-path",
    );
    assert.strictEqual(
      decideApplyShadowCommand({ pendingCount: 2 }),
      "accept-all",
    );
    assert.strictEqual(
      decideApplyShadowCommand({ pendingCount: 1 }),
      "accept-current",
    );
    assert.strictEqual(
      decideApplyShadowCommand({ pendingCount: 0 }),
      "accept-current",
    );
  });

  test("resolveShadowTarget maps original, shadow path, single pending, or pick", () => {
    const a = pending("/ws/a.ts", "/tmp/shadow/a.ts");
    const b = pending("/ws/b.ts", "/tmp/shadow/b.ts");
    assert.deepStrictEqual(
      resolveShadowTarget({ requestedPath: "/ws/a.ts", pending: [a, b] }),
      { kind: "found", originalPath: path.normalize("/ws/a.ts") },
    );
    assert.deepStrictEqual(
      resolveShadowTarget({
        activeFsPath: "/tmp/shadow/b.ts",
        pending: [a, b],
      }),
      { kind: "found", originalPath: "/ws/b.ts" },
    );
    assert.deepStrictEqual(
      resolveShadowTarget({
        activeFsPath: "/ws/a.ts",
        pending: [a, b],
      }),
      { kind: "found", originalPath: "/ws/a.ts" },
    );
    assert.deepStrictEqual(
      resolveShadowTarget({ pending: [a] }),
      { kind: "found", originalPath: "/ws/a.ts" },
    );
    assert.deepStrictEqual(resolveShadowTarget({ pending: [a, b] }), {
      kind: "pick",
      originalPaths: ["/ws/a.ts", "/ws/b.ts"],
    });
    assert.deepStrictEqual(resolveShadowTarget({ pending: [] }), {
      kind: "none",
    });
  });

  test("store stages pending, Accept waiter, Reject waiter, and context key", () => {
    const store = new ShadowPreviewStore();
    const file = path.join(path.sep, "ws", "a.ts");
    let decided: string | undefined;
    store.upsert({
      originalPath: file,
      shadowPath: "/tmp/shadow/a.ts",
      proposedContent: "new",
      streamId: "s1",
    });
    assert.strictEqual(store.size, 1);
    assert.strictEqual(store.contextVisible(), true);
    assert.strictEqual(store.get(file)?.proposedContent, "new");

    store.setWaiter(file, (decision) => {
      decided = decision;
    });
    assert.strictEqual(store.hasWaiter(file), true);
    store.takeWaiter(file)?.("accept");
    assert.strictEqual(decided, "accept");
    assert.strictEqual(store.hasWaiter(file), false);

    store.setWaiter(file, (decision) => {
      decided = decision;
    });
    store.rejectAllWaiters();
    assert.strictEqual(decided, "reject");
    assert.strictEqual(store.hasWaiter(file), false);

    store.upsert({
      originalPath: file,
      shadowPath: "/tmp/shadow/a.ts",
      proposedContent: "newer",
    });
    assert.strictEqual(store.get(file)?.streamId, "s1");
    assert.strictEqual(store.get(file)?.proposedContent, "newer");
    store.delete(file);
    assert.strictEqual(store.size, 0);
    assert.strictEqual(store.contextVisible(), false);
  });
});
