import { describe, expect, it } from "vitest";

import { parseCtags, queryParsedTags, formatTagHits } from "./tagsQuery";

const SAMPLE = `!_TAG_FILE_FORMAT	2	/extended format/
copy_process	kernel/fork.c	/^pid_t copy_process(/;"	f
copy_to_user	lib/usercopy.c	/^copy_to_user(/;"	f
schedule	kernel/sched/core.c	/^void schedule(/;"	f
`;

describe("parseCtags / queryParsedTags", () => {
  it("resolves an exact symbol from a mini tags file", () => {
    const tags = parseCtags(SAMPLE);
    const hits = queryParsedTags(tags, "copy_process");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toBe("kernel/fork.c");
    expect(formatTagHits("copy_process", hits)).toContain("kernel/fork.c");
    expect(formatTagHits("copy_process", hits)).toMatch(/make tags/);
  });

  it("matches a prefix when there is no exact hit", () => {
    const hits = queryParsedTags(parseCtags(SAMPLE), "copy_");
    expect(hits.map((h) => h.name).sort()).toEqual([
      "copy_process",
      "copy_to_user",
    ]);
  });
});
