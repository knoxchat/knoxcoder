import { describe, expect, it } from "vitest";

import {
  checkCitation,
  checkCitations,
  citationNeedsReview,
  collectSourcesFromMessages,
  extractFileCitations,
  formatUserCitationWarning,
  quoteInSource,
} from "./citation";
import { resolveJevRuntime } from "./config";
import type { JevClient, JevSystemOneResult } from "./types";

function runtime() {
  return {
    ...resolveJevRuntime({ enabled: true }),
    apiKey: "test-key",
  };
}

function fakeClient(result: JevSystemOneResult | Error): JevClient {
  return {
    async systemOne() {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
}

describe("extractFileCitations", () => {
  it("reads Cursor start:end:path fences and the preceding claim", () => {
    const citations = extractFileCitations(
      [
        "copy_to_user copies into user space.",
        "```12:15:mm/filemap.c",
        "return copy_to_user(dst, src, n);",
        "```",
      ].join("\n"),
    );
    expect(citations).toHaveLength(1);
    expect(citations[0].path).toBe("mm/filemap.c");
    expect(citations[0].quote).toContain("copy_to_user");
    expect(citations[0].claim).toMatch(/user space/);
  });

  it("ignores language-only fences", () => {
    expect(
      extractFileCitations("```typescript\nconst x = 1;\n```"),
    ).toEqual([]);
  });
});

describe("quoteInSource", () => {
  it("matches across whitespace and curly quotes", () => {
    expect(
      quoteInSource(
        "If the principal processing the claim does not identify itself",
        'If the principal   processing the claim does not identify itself',
      ),
    ).toBe(true);
  });
});

describe("collectSourcesFromMessages", () => {
  it("pairs read_file tool calls with the following tool result", () => {
    const sources = collectSourcesFromMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "1",
            type: "function",
            function: {
              name: "builtin_read_file",
              arguments: '{"filepath":"mm/filemap.c"}',
            },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "1",
        content: "return copy_to_user(dst, src, n);\n",
      },
    ]);
    expect(sources[0]?.path).toBe("mm/filemap.c");
    expect(sources[0]?.content).toMatch(/copy_to_user/);
  });
});

describe("checkCitation", () => {
  const source = {
    path: "mm/filemap.c",
    content: "return copy_to_user(dst, src, n);\n/* copies to user space */\n",
  };

  it("marks a missing quote as fabricated without calling Jev", async () => {
    const result = await checkCitation({
      claim: "The function wipes the disk.",
      quote: "this quote is not in the file at all, promise",
      path: "mm/filemap.c",
      sources: [source],
      runtime: runtime(),
      client: fakeClient(new Error("should not be called")),
    });
    expect(result.verdict).toBe("fabricated");
    expect(result.source).toBe("heuristic");
  });

  it("returns contradicted when Jev says the section disagrees", async () => {
    const result = await checkCitation({
      claim: "copy_to_user copies from user space only",
      quote: "return copy_to_user(dst, src, n);",
      path: "mm/filemap.c",
      sources: [source],
      runtime: runtime(),
      client: fakeClient({
        model: "jev-1.13.0",
        answers: {
          relation: {
            type: "choice",
            choice: "contradicts",
            confidence: 0.96,
          },
        },
      }),
    });
    expect(result.verdict).toBe("contradicted");
    expect(result.auto).toBe(true);
    expect(result.source).toBe("jev");
  });

  it("skips when Jev is disabled", async () => {
    const result = await checkCitation({
      claim: "copies to user space",
      quote: "return copy_to_user(dst, src, n);",
      path: "mm/filemap.c",
      sources: [source],
      runtime: resolveJevRuntime({ enabled: false }),
    });
    expect(result.verdict).toBe("skipped");
  });

  it("fails open when the client throws", async () => {
    const result = await checkCitation({
      claim: "copies to user space",
      quote: "return copy_to_user(dst, src, n);",
      path: "mm/filemap.c",
      sources: [source],
      runtime: { ...runtime(), failOpen: true },
      client: fakeClient(new Error("timeout")),
    });
    expect(result.verdict).toBe("skipped");
  });
});

describe("formatUserCitationWarning", () => {
  it("marks fabricated fences for the user", () => {
    expect(
      formatUserCitationWarning([
        {
          source: "heuristic",
          verdict: "fabricated",
          confidence: null,
          auto: true,
          reason: "quote not in source",
          path: "mm/filemap.c",
        },
      ]),
    ).toMatch(/fabricated \(mm\/filemap\.c\)/);
  });

  it("flags low-confidence citations for review", () => {
    expect(
      citationNeedsReview({
        source: "jev",
        verdict: "verified",
        confidence: 0.4,
        auto: false,
        reason: "relation=supports confidence=0.40",
        path: "mm/filemap.c",
      }),
    ).toBe(true);
    expect(
      formatUserCitationWarning([
        {
          source: "jev",
          verdict: "unsupported",
          confidence: 0.4,
          auto: false,
          reason: "relation=says_nothing confidence=0.40",
          path: "mm/filemap.c",
        },
      ]),
    ).toMatch(/unsupported/);
  });
});

describe("checkCitations", () => {
  it("judges several surviving quotes in one System One request", async () => {
    let calls = 0;
    const results = await checkCitations({
      completion: [
        "copy_to_user copies into user space.",
        "```12:15:mm/filemap.c",
        "return copy_to_user(dst, src, n);",
        "```",
        "It also wipes the disk.",
        "```20:22:mm/filemap.c",
        "/* copies to user space */",
        "```",
      ].join("\n"),
      sources: [
        {
          path: "mm/filemap.c",
          content:
            "return copy_to_user(dst, src, n);\n/* copies to user space */\n",
        },
      ],
      runtime: runtime(),
      client: {
        async systemOne(request) {
          calls += 1;
          expect(Object.keys(request.questions)).toEqual(
            expect.arrayContaining(["relation_0", "relation_1"]),
          );
          return {
            model: "jev-1.13.0",
            answers: {
              relation_0: {
                type: "choice",
                choice: "supports",
                confidence: 0.93,
              },
              relation_1: {
                type: "choice",
                choice: "contradicts",
                confidence: 0.91,
              },
            },
          };
        },
      },
    });
    expect(calls).toBe(1);
    expect(results.map((item) => item.verdict)).toEqual([
      "verified",
      "contradicted",
    ]);
  });
});
