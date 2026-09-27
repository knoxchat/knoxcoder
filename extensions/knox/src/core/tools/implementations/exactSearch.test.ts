import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import { exactSearchImpl } from "./exactSearch";
import { SYSTEMS_SEARCH_MAX_RESULTS } from "../ripgrep";

function extras(ide: IDE): ToolExtras {
  return {
    ide,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_exact_search" } } as ToolExtras["tool"],
  };
}

describe("exactSearchImpl defaults (HL-22)", () => {
  it("uses 200 maxResults on a kernel-like workspace", async () => {
    const getSearchResults = vi.fn(async () => "mm/filemap.c\n1:copy_to_user");
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      listDir: vi.fn(async () => [
        ["Kconfig", 1],
        ["Makefile", 1],
        ["arch", 2],
      ]),
      getSearchResults,
    } as unknown as IDE;

    await exactSearchImpl({ query: "copy_to_user" }, extras(ide));
    expect(getSearchResults).toHaveBeenCalledWith(
      "copy_to_user",
      expect.objectContaining({
        maxResults: SYSTEMS_SEARCH_MAX_RESULTS,
        fixedStrings: true,
        pcre2: false,
      }),
    );
  });

  it("keeps 50 on an app workspace", async () => {
    const getSearchResults = vi.fn(async () => "No matches found");
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      listDir: vi.fn(async () => [
        ["package.json", 1],
        ["src", 2],
      ]),
      getSearchResults,
    } as unknown as IDE;

    await exactSearchImpl({ query: "foo" }, extras(ide));
    expect(getSearchResults).toHaveBeenCalledWith(
      "foo",
      expect.objectContaining({ maxResults: 50, fixedStrings: true }),
    );
  });

  it("keeps code-snippet queries literal and opts into regex via pcre2", async () => {
    const getSearchResults = vi.fn(async () => "No matches found");
    const ide = {
      getWorkspaceDirs: vi.fn(async () => ["file:///tmp/ws"]),
      listDir: vi.fn(async () => [["src", 2]]),
      getSearchResults,
    } as unknown as IDE;

    await exactSearchImpl({ query: "fn ui(&mut self," }, extras(ide));
    expect(getSearchResults).toHaveBeenCalledWith(
      "fn ui(&mut self,",
      expect.objectContaining({ fixedStrings: true, pcre2: false }),
    );

    getSearchResults.mockClear();
    await exactSearchImpl(
      { query: "foo|bar", pcre2: true },
      extras(ide),
    );
    expect(getSearchResults).toHaveBeenCalledWith(
      "foo|bar",
      expect.objectContaining({ fixedStrings: false, pcre2: true }),
    );
  });
});
