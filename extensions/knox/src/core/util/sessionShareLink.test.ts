import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SESSION_SHARE_AUTHORITY,
  SESSION_SHARE_PATH,
  SESSION_SHARE_SCHEME,
  buildSessionShareUri,
  filePathFromShareQuery,
  isSessionSharePath,
} from "./sessionShareLink";

describe("sessionShareLink", () => {
  it("builds a knoxcoder URI whose path round-trips", () => {
    const file = path.join(os.tmpdir(), "knox-share", "2026_session.md");
    const uri = buildSessionShareUri(file);
    expect(uri.startsWith(`${SESSION_SHARE_SCHEME}://${SESSION_SHARE_AUTHORITY}${SESSION_SHARE_PATH}?`)).toBe(
      true,
    );
    const query = uri.split("?")[1] ?? "";
    expect(filePathFromShareQuery(query)).toBe(path.resolve(file));
  });

  it("accepts file: URLs and rejects http(s)", () => {
    const file = path.join(os.tmpdir(), "t.md");
    expect(filePathFromShareQuery(`path=${pathToFileURL(file).href}`)).toBe(
      path.resolve(file),
    );
    expect(filePathFromShareQuery("path=https://example.com/x.md")).toBeUndefined();
    expect(filePathFromShareQuery("path=")).toBeUndefined();
  });

  it("recognizes import paths", () => {
    expect(isSessionSharePath("/session/import")).toBe(true);
    expect(isSessionSharePath("/session/import/")).toBe(true);
    expect(isSessionSharePath("/import")).toBe(true);
    expect(isSessionSharePath("/chat")).toBe(false);
  });
});
