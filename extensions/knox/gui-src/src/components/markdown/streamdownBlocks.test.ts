import { parseMarkdownIntoBlocks } from "streamdown";
import { describe, expect, it } from "vitest";

/**
 * Streamdown 2.6 splits markdown into stable blocks so completed sections
 * are not re-parsed when a later fence/heading arrives. Rejoining with
 * `\n\n` (the previous chat path) destroys that stability.
 */
describe("streamdown block splitting", () => {
  it("keeps a completed code fence as its own block when a heading starts after it", () => {
    const closed = "Intro\n\n```js\nconst a = 1;\n```";
    const next = `${closed}\n\n## Next`;

    const closedBlocks = parseMarkdownIntoBlocks(closed);
    const nextBlocks = parseMarkdownIntoBlocks(next);

    expect(closedBlocks.some((block) => block.includes("const a = 1;"))).toBe(
      true,
    );
    expect(nextBlocks.length).toBeGreaterThan(closedBlocks.length);
    expect(nextBlocks[0]).toBe(closedBlocks[0]);
  });

  it("does not treat an unclosed fence as later prose until the closer arrives", () => {
    const streaming = "```ts\nexport function foo() {\n  return 1;";
    const blocks = parseMarkdownIntoBlocks(streaming);
    const joined = blocks.join("");
    expect(joined).toContain("export function foo()");
    expect(joined).not.toContain("```\n");
  });
});
