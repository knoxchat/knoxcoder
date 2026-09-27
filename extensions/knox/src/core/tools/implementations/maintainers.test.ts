import { describe, expect, it, vi } from "vitest";

import type { IDE, ToolExtras } from "../..";
import {
  lookupMaintainers,
  matchMaintainerPattern,
  parseMaintainers,
} from "../maintainersParse";
import { maintainersImpl } from "./maintainers";

const FIXTURE = `
MEMORY MANAGEMENT
M:	Andrew Morton <akpm@linux-foundation.org>
L:	linux-mm@kvack.org
S:	Maintained
F:	include/linux/mm.h
F:	mm/
X:	mm/kmsan/

FILESYSTEMS [GENERIC]
M:	Alexander Viro <viro@zeniv.linux.org.uk>
F:	fs/

THE REST
M:	Nobody
S:	Orphan
F:	*
`.trim();

function extras(files: Record<string, string>): ToolExtras {
  const store = new Map(
    Object.entries(files).map(([rel, text]) => [
      rel.startsWith("file:") ? rel : `file:///tmp/ws/${rel}`,
      text,
    ]),
  );
  const root = "file:///tmp/ws";
  return {
    ide: {
      getWorkspaceDirs: async () => [root],
      fileExists: async (uri: string) => store.has(uri),
      readFile: async (uri: string) => {
        const text = store.get(uri);
        if (text === undefined) {
          throw new Error("missing");
        }
        return text;
      },
    } as unknown as IDE,
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_maintainers" } } as ToolExtras["tool"],
  };
}

describe("MAINTAINERS parser", () => {
  it("matches directory prefixes and globs", () => {
    expect(matchMaintainerPattern("mm/filemap.c", "mm/")).toBe(true);
    expect(matchMaintainerPattern("fs/read_write.c", "mm/")).toBe(false);
    expect(matchMaintainerPattern("include/linux/mm.h", "include/linux/mm.h")).toBe(
      true,
    );
    expect(matchMaintainerPattern("arch/x86/Makefile", "arch/*/Makefile")).toBe(
      true,
    );
  });

  it("lookup prefers mm/ over THE REST and honors X:", () => {
    const records = parseMaintainers(FIXTURE);
    const mm = lookupMaintainers(records, "mm/filemap.c");
    expect(mm.hits[0]?.title).toBe("MEMORY MANAGEMENT");
    expect(mm.hits[0]?.maintainers[0]).toMatch(/Andrew Morton/);
    expect(mm.hits.some((hit) => hit.title === "THE REST")).toBe(false);

    const kmsan = lookupMaintainers(records, "mm/kmsan/kmsan.c");
    expect(kmsan.hits.some((hit) => hit.title === "MEMORY MANAGEMENT")).toBe(
      false,
    );
    expect(kmsan.hits[0]?.title).toBe("THE REST");
  });
});

describe("builtin_maintainers", () => {
  it("lookup returns maintainers without dumping THE REST", async () => {
    const result = await maintainersImpl(
      { op: "lookup", path: "mm/filemap.c" },
      extras({
        MAINTAINERS: FIXTURE,
        "scripts/get_maintainer.pl": "#!/usr/bin/perl\n",
      }),
    );
    expect(result[0].content).toContain("MEMORY MANAGEMENT");
    expect(result[0].content).toContain("Andrew Morton");
    expect(result[0].content).toContain("get_maintainer.pl");
    expect(result[0].content).not.toContain("FILESYSTEMS");
    expect(result[0].content).not.toContain("THE REST");
  });

  it("infers search from query and list from neither", async () => {
    const search = await maintainersImpl(
      { query: "mm" },
      extras({ MAINTAINERS: FIXTURE }),
    );
    expect(search[0].content).toContain("MEMORY MANAGEMENT");

    const list = await maintainersImpl({}, extras({ MAINTAINERS: FIXTURE }));
    expect(list[0].content).toContain("MEMORY MANAGEMENT");
    expect(list[0].content).toContain("FILESYSTEMS");
  });
});
