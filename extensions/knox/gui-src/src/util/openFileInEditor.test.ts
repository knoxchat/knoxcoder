import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  openFileInEditor,
  splitDisplayPath,
} from "./openFileInEditor";

const resolveRelativePathInDir = vi.fn();
const inferResolvedUriFromRelativePath = vi.fn();

vi.mock("core/util/ideUtils", () => ({
  resolveRelativePathInDir: (...args: unknown[]) =>
    resolveRelativePathInDir(...args),
  inferResolvedUriFromRelativePath: (...args: unknown[]) =>
    inferResolvedUriFromRelativePath(...args),
}));

describe("splitDisplayPath", () => {
  it("splits a nested relative path into dir and filename", () => {
    expect(splitDisplayPath("tetris/src/main.rs")).toEqual({
      dir: "tetris/src/",
      name: "main.rs",
    });
  });

  it("returns only the name when there is no directory", () => {
    expect(splitDisplayPath("main.rs")).toEqual({
      dir: "",
      name: "main.rs",
    });
  });

  it("strips a leading ./ and normalizes backslashes", () => {
    expect(splitDisplayPath(".\\src\\main.rs")).toEqual({
      dir: "src/",
      name: "main.rs",
    });
  });
});

describe("openFileInEditor", () => {
  const post = vi.fn();
  const ideMessenger = {
    post,
    ide: {},
  } as any;

  beforeEach(() => {
    post.mockReset();
    resolveRelativePathInDir.mockReset();
    inferResolvedUriFromRelativePath.mockReset();
    resolveRelativePathInDir.mockResolvedValue(
      "file:///workspace/tetris/src/main.rs",
    );
  });

  it("opens the resolved file when no line is given", async () => {
    await openFileInEditor(ideMessenger, "tetris/src/main.rs");

    expect(resolveRelativePathInDir).toHaveBeenCalledWith(
      "tetris/src/main.rs",
      ideMessenger.ide,
    );
    expect(post).toHaveBeenCalledWith("showFile", {
      filepath: "file:///workspace/tetris/src/main.rs",
    });
  });

  it("converts 1-based display lines to 0-based showLines", async () => {
    await openFileInEditor(ideMessenger, "tetris/src/main.rs", {
      startLine: 483,
      endLine: 483,
    });

    expect(post).toHaveBeenCalledWith("showLines", {
      filepath: "file:///workspace/tetris/src/main.rs",
      startLine: 482,
      endLine: 482,
    });
  });

  it("falls back to inferResolvedUriFromRelativePath when the file is not found", async () => {
    resolveRelativePathInDir.mockResolvedValue(undefined);
    inferResolvedUriFromRelativePath.mockResolvedValue(
      "file:///workspace/new-file.ts",
    );

    await openFileInEditor(ideMessenger, "new-file.ts");

    expect(inferResolvedUriFromRelativePath).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("showFile", {
      filepath: "file:///workspace/new-file.ts",
    });
  });

  it("opens an existing file URI without re-resolving", async () => {
    await openFileInEditor(
      ideMessenger,
      "file:///Users/knox/tetris/src/main.rs",
    );

    expect(resolveRelativePathInDir).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("showFile", {
      filepath: "file:///Users/knox/tetris/src/main.rs",
    });
  });

  it("does nothing for an empty path", async () => {
    await openFileInEditor(ideMessenger, "  ");
    expect(resolveRelativePathInDir).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
