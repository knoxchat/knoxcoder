import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import {
  buildChangeStrategyInstruction,
  detectDoomLoop,
  type DoomLoopCall,
} from "./doomLoop";

const edit = (content: string, file = "a.ts"): DoomLoopCall => ({
  name: BuiltInToolNames.EditFile,
  args: { filepath: file, old_string: "x", new_string: content },
});
const make = (out: string): DoomLoopCall => ({
  name: BuiltInToolNames.Build,
  args: { n: Math.random() },
  output: out,
});
const ask = (q: string): DoomLoopCall => ({
  name: BuiltInToolNames.AskUser,
  args: { questions: [{ prompt: q }] },
});

describe("K-036 stuck patterns", () => {
  it("flags A,B,A,B edits on one file", () => {
    const hit = detectDoomLoop([edit("A"), edit("B"), edit("A"), edit("B")], { threshold: 3 });
    expect(hit?.kind).toBe("oscillating_edit");
  });

  it("ignores progressing edits and different files", () => {
    expect(detectDoomLoop([edit("A"), edit("B"), edit("C"), edit("D")], { threshold: 3 })).toBeNull();
    expect(
      detectDoomLoop([edit("A", "x"), edit("B", "y"), edit("A", "x"), edit("B", "y")], { threshold: 3 }),
    ).toBeNull();
  });

  it("flags the same failing oracle output across edits", () => {
    const err = "src/a.c:10:5: error: 'foo' undeclared";
    const hit = detectDoomLoop(
      [make(err), edit("1"), make(err), edit("2"), make(err)],
      { threshold: 3 },
    );
    expect(hit?.kind).toBe("oracle_stuck");
  });

  it("does not flag changing oracle errors", () => {
    const hit = detectDoomLoop(
      [
        make("a.c:1:1: error: one"),
        edit("1"),
        make("a.c:2:1: error: two"),
        edit("2"),
        make("a.c:3:1: error: three"),
      ],
      { threshold: 3 },
    );
    expect(hit).toBeNull();
  });

  it("flags a repeated identical question but not a new one", () => {
    expect(detectDoomLoop([ask("Which runtime?"), ask("Which runtime?")], { threshold: 3 })?.kind).toBe("repeat_question");
    expect(detectDoomLoop([ask("one"), ask("two")], { threshold: 3 })).toBeNull();
  });

  it("builds a change-strategy instruction", () => {
    const hit = detectDoomLoop([ask("q"), ask("q")], { threshold: 3 })!;
    expect(buildChangeStrategyInstruction(hit)).toContain("different approach");
  });
});

describe("K-036 apply_patch oscillation", () => {
  const patch = (a: string, b: string): DoomLoopCall => ({
    name: BuiltInToolNames.ApplyPatch,
    args: { patch: `*** Begin Patch\n*** Update File: a.ts\n@@\n-${a}\n+${b}\n*** End Patch` },
  });
  it("flags forward/reverse patches on one file", () => {
    const hit = detectDoomLoop([patch("x", "y"), patch("y", "x"), patch("x", "y"), patch("y", "x")], { threshold: 3 });
    expect(hit?.kind).toBe("oscillating_edit");
  });
  it("ignores distinct patches", () => {
    expect(detectDoomLoop([patch("a", "b"), patch("b", "c"), patch("c", "d"), patch("d", "e")], { threshold: 3 })).toBeNull();
  });
});
