import { describe, expect, it } from "vitest";

import { ToolCallError, ToolCallErrorCode } from "./errors";
import {
  coerceArgsToSchema,
  describeToolParameters,
  findSchemaIssues,
  validateArgsAgainstSchema,
} from "./schemaArgs";

const schema = {
  type: "object",
  required: ["filepath"],
  properties: {
    filepath: { type: "string", description: "Path. Second sentence." },
    startLine: { type: "integer" },
    ratio: { type: "number" },
    recursive: { type: "boolean" },
    mode: { type: "string", enum: ["start", "stop"] },
    paths: { type: "array", items: { type: "string" } },
    options: {
      type: "object",
      properties: { depth: { type: "integer" } },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

describe("coerceArgsToSchema", () => {
  it("turns numeric and boolean strings into real numbers and booleans", () => {
    expect(
      coerceArgsToSchema(
        { filepath: "a.ts", startLine: "12", ratio: "0.5", recursive: "TRUE" },
        schema,
      ),
    ).toEqual({ filepath: "a.ts", startLine: 12, ratio: 0.5, recursive: true });
  });

  it("stringifies numbers where a string is declared", () => {
    expect(coerceArgsToSchema({ filepath: 42 }, schema).filepath).toBe("42");
  });

  it("parses JSON strings into arrays and objects", () => {
    const out = coerceArgsToSchema(
      { filepath: "a", paths: '["x","y"]', options: '{"depth":"3"}' },
      schema,
    );
    expect(out.paths).toEqual(["x", "y"]);
    expect(out.options).toEqual({ depth: 3 });
  });

  it("wraps a lone value where an array is declared", () => {
    expect(coerceArgsToSchema({ filepath: "a", paths: "src" }, schema).paths).toEqual(["src"]);
    expect(
      coerceArgsToSchema({ filepath: "a", questions: { id: "q1" } }, schema).questions,
    ).toEqual([{ id: "q1" }]);
  });

  it("drops null/undefined for optional parameters but keeps required ones", () => {
    const out = coerceArgsToSchema({ filepath: null, startLine: null, mode: undefined }, schema);
    expect("startLine" in out).toBe(false);
    expect("mode" in out).toBe(false);
    expect(out.filepath).toBeNull();
  });

  it("canonicalizes enum case", () => {
    expect(coerceArgsToSchema({ filepath: "a", mode: "Start" }, schema).mode).toBe("start");
  });

  it("recurses into array items", () => {
    const out = coerceArgsToSchema(
      { filepath: "a", questions: [{ id: 1, options: "[\"a\"]" }] },
      schema,
    );
    expect(out.questions).toEqual([{ id: "1", options: ["a"] }]);
  });

  it("never touches values that already match and does not mutate the input", () => {
    const input = { filepath: "a", startLine: 3 };
    const out = coerceArgsToSchema(input, schema);
    expect(out).toEqual(input);
    expect(input).toEqual({ filepath: "a", startLine: 3 });
  });

  it("does not coerce non-numeric text or fractional integers", () => {
    expect(coerceArgsToSchema({ filepath: "a", startLine: "abc" }, schema).startLine).toBe("abc");
    expect(coerceArgsToSchema({ filepath: "a", startLine: "1.5" }, schema).startLine).toBe("1.5");
  });

  it("is a no-op for schemas without properties", () => {
    const args = { anything: "1" };
    expect(coerceArgsToSchema(args, { type: "object" })).toBe(args);
    expect(coerceArgsToSchema(args, undefined)).toBe(args);
  });
});

describe("findSchemaIssues / validateArgsAgainstSchema", () => {
  it("reports type and enum mismatches with paths", () => {
    const issues = findSchemaIssues(
      { filepath: "a", startLine: "abc", mode: "pause", paths: [1] },
      schema,
    );
    const byPath = Object.fromEntries(issues.map((i) => [i.path, i]));
    expect(byPath.startLine.expected).toBe("integer");
    expect(byPath.mode.expected).toMatch(/one of "start", "stop"/);
    expect(byPath["paths[0]"].expected).toBe("string");
  });

  it("flags fractional values for integer parameters", () => {
    expect(findSchemaIssues({ filepath: "a", startLine: 1.5 }, schema)).toHaveLength(1);
  });

  it("accepts unions when any variant matches and ignores unknown keywords", () => {
    const union = {
      type: "object",
      properties: { value: { anyOf: [{ type: "string" }, { type: "number" }] } },
    };
    expect(findSchemaIssues({ value: 3 }, union)).toEqual([]);
    expect(findSchemaIssues({ value: true }, union)).toHaveLength(1);
  });

  it("throws an actionable SchemaMismatch ToolCallError", () => {
    try {
      validateArgsAgainstSchema("builtin_read_file", { filepath: "a", startLine: "abc" }, schema);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolCallError);
      const err = error as ToolCallError;
      expect(err.code).toBe(ToolCallErrorCode.INVALID_ARGUMENTS);
      expect(err.retryable).toBe(false);
      expect(err.context.category).toBe("SchemaMismatch");
      expect(err.message).toMatch(/startLine: expected integer, got string "abc"/);
      expect(err.message).toMatch(/Parameters:/);
      expect(err.message).toMatch(/filepath \(string, required\)/);
    }
  });

  it("does not throw for valid args", () => {
    expect(() =>
      validateArgsAgainstSchema("t", { filepath: "a", startLine: 2 }, schema),
    ).not.toThrow();
  });
});

describe("describeToolParameters", () => {
  it("lists type, requiredness, and first description sentence", () => {
    const text = describeToolParameters(schema);
    expect(text).toContain("filepath (string, required) - Path.");
    expect(text).not.toContain("Second sentence");
    expect(text).toContain("paths (string[], optional)");
  });
});
