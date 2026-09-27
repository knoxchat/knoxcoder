import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addToTestDir,
  setUpTestDir,
  tearDownTestDir,
  TEST_DIR,
} from "../test/testDir";
import FileSystemIde from "./filesystem";
import {
  relativePathCandidates,
  resolveRelativePathInDir,
} from "./ideUtils";
import { getUriPathBasename, joinPathsToUri } from "./uri";

describe("relativePathCandidates", () => {
  it("strips a leading workspace folder name", () => {
    expect(
      relativePathCandidates("tetris/src/main.rs", [
        "file:///Users/knox/tetris",
      ]),
    ).toEqual(["tetris/src/main.rs", "src/main.rs"]);
  });

  it("keeps a normal relative path", () => {
    expect(
      relativePathCandidates("src/main.rs", ["file:///Users/knox/tetris"]),
    ).toEqual(["src/main.rs"]);
  });
});

describe("resolveRelativePathInDir", () => {
  beforeEach(() => {
    setUpTestDir();
    addToTestDir([["src/main.rs", "fn main() {}\n"]]);
  });
  afterEach(tearDownTestDir);

  it("resolves a workspace-relative file", async () => {
    const ide = new FileSystemIde(TEST_DIR);
    const uri = await resolveRelativePathInDir("src/main.rs", ide);
    expect(uri).toBe(joinPathsToUri(TEST_DIR, "src/main.rs"));
  });

  it("resolves when the model prefixes the workspace folder name", async () => {
    const ide = new FileSystemIde(TEST_DIR);
    const prefixed = `${getUriPathBasename(TEST_DIR)}/src/main.rs`;
    const uri = await resolveRelativePathInDir(prefixed, ide);
    expect(uri).toBe(joinPathsToUri(TEST_DIR, "src/main.rs"));
  });
});
