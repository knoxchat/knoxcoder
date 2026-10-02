import { describe, expect, it } from "vitest";

import {
  parseToolFilePath,
  sanitizeToolFilePath,
} from "./toolFilePath";

describe("sanitizeToolFilePath", () => {
  it("strips a leading blockquote / DSML leftover >", () => {
    expect(sanitizeToolFilePath(">kernel/src/interrupts.rs")).toBe(
      "kernel/src/interrupts.rs",
    );
    expect(sanitizeToolFilePath(">> kernel/src/interrupts.rs")).toBe(
      "kernel/src/interrupts.rs",
    );
    expect(sanitizeToolFilePath("&gt;kernel/src/interrupts.rs")).toBe(
      "kernel/src/interrupts.rs",
    );
  });

  it("unwraps quotes, backticks, markdown, and angle brackets", () => {
    expect(sanitizeToolFilePath('"src/main.rs"')).toBe("src/main.rs");
    expect(sanitizeToolFilePath("'src/main.rs'")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("`src/main.rs`")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("<src/main.rs>")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("[src/main.rs](src/main.rs)")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("**src/main.rs**")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("|src/main.rs|")).toBe("src/main.rs");
  });

  it("strips nested junk: quoted blockquote with a line suffix", () => {
    expect(sanitizeToolFilePath('">kernel/src/interrupts.rs:42"')).toBe(
      "kernel/src/interrupts.rs",
    );
  });

  it("strips ./, filepath= prefixes, and trailing punctuation", () => {
    expect(sanitizeToolFilePath("./src/main.rs")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("filepath=src/main.rs")).toBe("src/main.rs");
    expect(sanitizeToolFilePath("src/main.rs.")).toBe("src/main.rs");
  });

  it("keeps Windows drives, URIs, and @types paths", () => {
    expect(sanitizeToolFilePath("C:\\w\\a.rs")).toBe("C:/w/a.rs");
    expect(sanitizeToolFilePath("file:///tmp/a.rs")).toBe("file:///tmp/a.rs");
    expect(sanitizeToolFilePath("@types/node/index.d.ts")).toBe(
      "@types/node/index.d.ts",
    );
  });

  it("strips mention chips that are clearly files", () => {
    expect(sanitizeToolFilePath("@Cargo.toml")).toBe("Cargo.toml");
    expect(sanitizeToolFilePath("@./src/main.rs")).toBe("src/main.rs");
  });

  it("is a no-op on a clean relative path", () => {
    expect(sanitizeToolFilePath("kernel/src/interrupts.rs")).toBe(
      "kernel/src/interrupts.rs",
    );
    expect(sanitizeToolFilePath(".")).toBe(".");
    expect(sanitizeToolFilePath("..")).toBe("..");
  });
});

describe("parseToolFilePath", () => {
  it("pulls compiler and GitHub line markers into start/end", () => {
    expect(parseToolFilePath("src/main.rs:10")).toEqual({
      filepath: "src/main.rs",
      startLine: 10,
    });
    expect(parseToolFilePath("src/main.rs:10-20")).toEqual({
      filepath: "src/main.rs",
      startLine: 10,
      endLine: 20,
    });
    expect(parseToolFilePath("src/main.rs#L10-L20")).toEqual({
      filepath: "src/main.rs",
      startLine: 10,
      endLine: 20,
    });
    expect(parseToolFilePath("src/main.rs (lines 8-12)")).toEqual({
      filepath: "src/main.rs",
      startLine: 8,
      endLine: 12,
    });
  });

  it("does not treat a Windows drive letter as a line number", () => {
    expect(parseToolFilePath("C:\\w\\a.rs:12")).toEqual({
      filepath: "C:/w/a.rs",
      startLine: 12,
    });
  });

  it("does not strip glob stars", () => {
    expect(parseToolFilePath(">**/*.rs")).toEqual({ filepath: "**/*.rs" });
  });
});
