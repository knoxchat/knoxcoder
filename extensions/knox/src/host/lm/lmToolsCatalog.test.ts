import * as assert from "node:assert";

import { knoxLmToolNames } from "./lmToolsCatalog";

suite("KN-170 LM tools catalog", () => {
  test("builtin catalog names are unique and prefixed", () => {
    const names = knoxLmToolNames();
    assert.ok(names.length >= 30, `expected many tools, got ${names.length}`);
    assert.strictEqual(names.length, new Set(names).size);
    for (const name of names) {
      assert.ok(name.startsWith("builtin_"), name);
    }
    assert.ok(names.includes("builtin_read_file"));
    assert.ok(names.includes("builtin_memory"));
  });
});
