import { describe, expect, it } from "vitest";

import {
  calculateFence,
  displayArgsForToolCall,
  extractStreamingToolCode,
} from "./extractStreamingToolCode";

describe("extractStreamingToolCode", () => {
  it("reads write-style parsed args", () => {
    expect(
      extractStreamingToolCode({
        parsedArgs: { filepath: "src/main.rs", contents: "fn main() {}" },
      }),
    ).toEqual({
      filepath: "src/main.rs",
      codeContent: "fn main() {}",
      contentKey: "contents",
      started: true,
    });
  });

  it("accepts path aliases used by models instead of filepath", () => {
    expect(
      extractStreamingToolCode({
        parsedArgs: { target_file: "app.ts", new_string: "export const x = 1;" },
      }),
    ).toEqual({
      filepath: "app.ts",
      codeContent: "export const x = 1;",
      contentKey: "new_string",
      started: true,
    });
  });

  it("prefers new_string over old_string while editing", () => {
    expect(
      extractStreamingToolCode({
        parsedArgs: {
          filepath: "a.ts",
          old_string: "const a = 1;",
          new_string: "const a = 2;",
        },
      }),
    ).toMatchObject({ codeContent: "const a = 2;", contentKey: "new_string" });
  });

  it("extracts apply_patch documents", () => {
    const patch = "*** Begin Patch\n*** Add File: a.ts\n+ok\n*** End Patch";
    expect(
      extractStreamingToolCode({ parsedArgs: { patch } }),
    ).toMatchObject({ codeContent: patch, contentKey: "patch" });
  });

  it("reads nested smart-edit modification.content", () => {
    expect(
      extractStreamingToolCode({
        parsedArgs: {
          filepath: "src/x.ts",
          modification: { type: "replace", content: "fixed()" },
        },
      }),
    ).toMatchObject({ filepath: "src/x.ts", codeContent: "fixed()" });
  });

  it("pulls contents from incomplete JSON before parsedArgs is ready", () => {
    const raw = '{"filepath": "game.rs", "contents": "fn handle() {\\n    match event";';
    expect(
      extractStreamingToolCode({ parsedArgs: {}, rawArguments: raw }),
    ).toMatchObject({
      filepath: "game.rs",
      codeContent: "fn handle() {\n    match event",
    });
  });

  it("unescapes streamed JSON string fragments", () => {
    const raw = '{"contents": "line 1\\nline 2\\t\\"quoted\\""';
    expect(extractStreamingToolCode({ rawArguments: raw }).codeContent).toBe(
      'line 1\nline 2\t"quoted"',
    );
  });

  it("marks the stream as started once a contents field opens", () => {
    expect(
      extractStreamingToolCode({ rawArguments: '{"contents": "' }).started,
    ).toBe(true);
  });

  it("returns empty strings when nothing has streamed yet", () => {
    expect(extractStreamingToolCode({ parsedArgs: {} })).toEqual({
      filepath: "",
      codeContent: "",
      contentKey: undefined,
      started: false,
    });
  });
});

describe("displayArgsForToolCall", () => {
  it("fills filepath from aliases so tool headers are not blank", () => {
    expect(
      displayArgsForToolCall({ target_file: "src/lib.rs" }).filepath,
    ).toBe("src/lib.rs");
  });
});

describe("calculateFence", () => {
  it("lengthens fences when the contents include backticks", () => {
    expect(calculateFence("```rust\nfn x() {}\n```")).toBe("````");
  });
});
