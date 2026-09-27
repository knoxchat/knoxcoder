import * as assert from "node:assert";

import {
  FileSearchIndex,
  fileSearchEntry,
  shouldIndexWorkspaceFile,
  tokenizeFileSearchText,
} from "./fileSearchIndex";

suite("KN-356 FileSearch for @", () => {
  test("skips node_modules and .git paths", () => {
    assert.strictEqual(shouldIndexWorkspaceFile("src/app.ts"), true);
    assert.strictEqual(shouldIndexWorkspaceFile("node_modules/minisearch/index.js"), false);
    assert.strictEqual(shouldIndexWorkspaceFile("foo/.git/config"), false);
  });

  test("tokenizes camelCase so @FileSearch matches FileSearch.ts", () => {
    const tokens = tokenizeFileSearchText("FileSearch.ts");
    assert.ok(tokens.includes("file"));
    assert.ok(tokens.includes("search"));
  });

  test("search ranks prefix hits and updates on add/remove", () => {
    const index = new FileSearchIndex();
    index.replaceAll([
      fileSearchEntry("file:///ws/src/FileSearch.ts", "src/FileSearch.ts"),
      fileSearchEntry("file:///ws/src/copyBuffer.ts", "src/copyBuffer.ts"),
      fileSearchEntry("file:///ws/node_modules/x.ts", "node_modules/x.ts"),
    ]);

    const hits = index.search("FileSearch");
    assert.ok(hits.some((hit) => hit.relativePath === "src/FileSearch.ts"));
    assert.ok(!hits.some((hit) => hit.relativePath === "node_modules/x.ts"));
    assert.deepStrictEqual(index.search(""), []);
    assert.deepStrictEqual(index.search("   "), []);

    index.add(fileSearchEntry("file:///ws/src/newFile.ts", "src/newFile.ts"));
    assert.ok(index.search("newFile").some((hit) => hit.id === "file:///ws/src/newFile.ts"));

    index.remove("file:///ws/src/newFile.ts");
    assert.ok(!index.search("newFile").some((hit) => hit.id === "file:///ws/src/newFile.ts"));
  });
});
