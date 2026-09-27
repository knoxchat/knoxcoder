import * as assert from "node:assert";

import {
  addLineSpans,
  buildWorkbenchAgentDiffPayload,
  deleteLineSpanStartingAt,
  shiftLineSpansAfter,
  workbenchDiffPayloadIsEmpty,
} from "./lineRanges";

suite("KN-340 vertical diff line spans", () => {
  test("addLineSpans coalesces adjacent ranges", () => {
    const first = addLineSpans([], 2, 2);
    assert.deepStrictEqual(first, [{ startLine: 2, endLine: 3 }]);
    assert.deepStrictEqual(addLineSpans(first, 4, 1), [
      { startLine: 2, endLine: 4 },
    ]);
    assert.deepStrictEqual(addLineSpans(first, 6, 1), [
      { startLine: 2, endLine: 3 },
      { startLine: 6, endLine: 6 },
    ]);
  });

  test("shiftLineSpansAfter moves ranges at or below the edit line", () => {
    const ranges = [
      { startLine: 1, endLine: 1 },
      { startLine: 4, endLine: 6 },
    ];
    assert.deepStrictEqual(shiftLineSpansAfter(ranges, 4, -2), [
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 4 },
    ]);
    assert.deepStrictEqual(shiftLineSpansAfter(ranges, 5, 1), [
      { startLine: 1, endLine: 1 },
      { startLine: 4, endLine: 6 },
    ]);
  });

  test("deleteLineSpanStartingAt removes the block and apply callers see it gone", () => {
    const ranges = [
      { startLine: 2, endLine: 3 },
      { startLine: 8, endLine: 8 },
    ];
    const hit = deleteLineSpanStartingAt(ranges, 2);
    assert.deepStrictEqual(hit.removed, { startLine: 2, endLine: 3 });
    assert.deepStrictEqual(hit.ranges, [{ startLine: 8, endLine: 8 }]);
    const miss = deleteLineSpanStartingAt(ranges, 3);
    assert.strictEqual(miss.removed, undefined);
    assert.deepStrictEqual(miss.ranges, ranges);
  });

  test("workbench payload keeps 0-based lines and treats index as occupancy", () => {
    const payload = buildWorkbenchAgentDiffPayload("file:///a.ts", {
      red: [{ startLine: 0, endLine: 1 }],
      green: [{ startLine: 2, endLine: 2 }],
      index: [{ startLine: 4, endLine: 4 }],
    });
    assert.deepStrictEqual(payload.red, [
      { startLineNumber: 0, endLineNumber: 1 },
    ]);
    assert.strictEqual(workbenchDiffPayloadIsEmpty(payload), false);
    assert.strictEqual(
      workbenchDiffPayloadIsEmpty({
        red: [],
        green: [],
        index: [],
        belowIndex: [],
      }),
      true,
    );
    assert.strictEqual(
      workbenchDiffPayloadIsEmpty({
        red: [],
        green: [],
        index: [{ startLineNumber: 3, endLineNumber: 3 }],
        belowIndex: [],
      }),
      false,
    );
  });
});
