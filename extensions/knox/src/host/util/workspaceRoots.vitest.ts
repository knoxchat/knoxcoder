import { describe, expect, it } from "vitest";

import { orderFoldersActiveFirst } from "./workspaceRoots";

const a = { fsPath: "/work/a" };
const b = { fsPath: "/work/b" };
const nested = { fsPath: "/work/a/pkg" };

describe("orderFoldersActiveFirst", () => {
  it("keeps order with a single folder or no active file", () => {
    expect(orderFoldersActiveFirst([a], "/work/a/x.ts")).toEqual([a]);
    expect(orderFoldersActiveFirst([a, b], undefined)).toEqual([a, b]);
  });

  it("moves the folder owning the active file first", () => {
    expect(orderFoldersActiveFirst([a, b], "/work/b/src/x.ts")).toEqual([b, a]);
    expect(orderFoldersActiveFirst([a, b], "/work/a/src/x.ts")).toEqual([a, b]);
  });

  it("prefers the deepest folder for nested roots", () => {
    expect(orderFoldersActiveFirst([a, b, nested], "/work/a/pkg/x.ts")).toEqual([nested, a, b]);
  });

  it("leaves order alone for files outside every folder and does not mutate", () => {
    const input = [a, b];
    expect(orderFoldersActiveFirst(input, "/tmp/x.ts")).toEqual([a, b]);
    orderFoldersActiveFirst(input, "/work/b/x.ts");
    expect(input).toEqual([a, b]);
  });
});
