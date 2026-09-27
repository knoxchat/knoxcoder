import * as assert from "node:assert";

import { foldSnapshotsIntoSuccessor, replaySnapshotsToState, type ReplaySnapshot } from "./checkpointReplay";

suite("checkpointReplay", () => {
  test("replays creates, modifies, and deletes into full state", () => {
    const state = replaySnapshotsToState([
      {
        fileSnapshots: [
          {
            relativePath: "a.ts",
            content: "v1",
            encoding: "utf8",
            changeType: "created",
          },
          {
            relativePath: "b.ts",
            content: "keep",
            encoding: "utf8",
            changeType: "created",
          },
        ],
      },
      {
        fileSnapshots: [
          {
            relativePath: "a.ts",
            content: "v2",
            encoding: "utf8",
            changeType: "modified",
          },
          {
            relativePath: "b.ts",
            content: "",
            encoding: "utf8",
            deleted: true,
            changeType: "deleted",
          },
          {
            relativePath: "c.ts",
            content: "new",
            encoding: "base64",
            changeType: "created",
          },
        ],
      },
    ]);

    assert.strictEqual(state.size, 2);
    assert.deepStrictEqual(state.get("a.ts"), {
      content: "v2",
      encoding: "utf8",
    });
    assert.strictEqual(state.has("b.ts"), false);
    assert.deepStrictEqual(state.get("c.ts"), {
      content: "new",
      encoding: "base64",
    });
  });

  test("defaults missing encoding to utf8", () => {
    const state = replaySnapshotsToState([
      {
        fileSnapshots: [{ relativePath: "x.md", content: "# hi" }],
      },
    ]);
    assert.deepStrictEqual(state.get("x.md"), {
      content: "# hi",
      encoding: "utf8",
    });
  });

  test("folding an earlier delta into its successor preserves replayed state", () => {
    const older = {
      fileSnapshots: [
        {
          relativePath: "kept.ts",
          content: "from-older",
          encoding: "utf8",
          changeType: "created",
        },
        {
          relativePath: "later-overridden.ts",
          content: "old",
          encoding: "utf8",
          changeType: "created",
        },
      ],
    };
    const newer = {
      fileSnapshots: [
        {
          relativePath: "later-overridden.ts",
          content: "new",
          encoding: "utf8",
          changeType: "modified",
        },
        {
          relativePath: "only-newer.ts",
          content: "fresh",
          encoding: "utf8",
          changeType: "created",
        },
      ],
    };

    const expected = replaySnapshotsToState([older, newer]);

    const afterDelete = replaySnapshotsToState([
      { fileSnapshots: foldSnapshotsIntoSuccessor(older.fileSnapshots, newer.fileSnapshots) },
    ]);

    assert.deepStrictEqual(
      Object.fromEntries(afterDelete),
      Object.fromEntries(expected),
    );
  });

  test("folding copies hashes that exist only in the earlier checkpoint", () => {
    const older: ReplaySnapshot[] = [
      {
        relativePath: "only-in-baseline.ts",
        hash: "aaa",
        encoding: "utf8",
        changeType: "created",
      },
      {
        relativePath: "shared.ts",
        hash: "bbb-old",
        encoding: "utf8",
        changeType: "created",
      },
    ];
    const newer: ReplaySnapshot[] = [
      {
        relativePath: "shared.ts",
        hash: "bbb-new",
        encoding: "utf8",
        changeType: "modified",
      },
    ];

    const folded = foldSnapshotsIntoSuccessor(older, newer);
    const byPath = new Map(folded.map((snapshot) => [snapshot.relativePath, snapshot]));
    assert.strictEqual(byPath.get("only-in-baseline.ts")?.hash, "aaa");
    assert.strictEqual(byPath.get("shared.ts")?.hash, "bbb-new");
  });
});
