import { describe, expect, it } from "vitest";

import { allAvailableTools } from "./index";

/**
 * Provider-portable schema lint. Different providers accept different subsets
 * of JSON Schema, and a gateway scores an unparseable/odd schema as valid, so
 * a bad definition fails silently in production. Keep every definition inside
 * the common subset.
 */
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FORBIDDEN_KEYS = new Set(["$ref", "$defs", "definitions", "patternProperties", "if", "then", "else", "not", "allOf"]);

function lint(schema: any, path: string, problems: string[], depth = 0): void {
  if (!schema || typeof schema !== "object") {
    problems.push(`${path}: schema is not an object`);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (FORBIDDEN_KEYS.has(key)) {
      problems.push(`${path}: uses unsupported keyword "${key}"`);
    }
  }
  if (depth > 6) {
    problems.push(`${path}: nested deeper than 6 levels`);
    return;
  }
  const hasUnion = Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf);
  if (!schema.type && !hasUnion && !schema.enum) {
    problems.push(`${path}: missing "type"`);
  }
  if (schema.type === "array") {
    if (!schema.items || typeof schema.items !== "object") {
      problems.push(`${path}: array without "items"`);
    } else {
      lint(schema.items, `${path}[]`, problems, depth + 1);
    }
  }
  if (Array.isArray(schema.enum) && schema.enum.length === 0) {
    problems.push(`${path}: empty enum`);
  }
  if (schema.type === "object" || schema.properties) {
    const props = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in props)) {
        problems.push(`${path}: required "${required}" is not a declared property`);
      }
    }
    for (const [name, child] of Object.entries(props)) {
      lint(child, `${path}.${name}`, problems, depth + 1);
    }
  }
}

describe("tool catalog schemas", () => {
  it("has unique, provider-safe tool names", () => {
    const names = allAvailableTools.map((tool) => tool.function.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toMatch(NAME_RE);
    }
  });

  it("describes every tool and uses an object parameter schema", () => {
    const problems: string[] = [];
    for (const tool of allAvailableTools) {
      const fn = tool.function;
      if (!fn.description || fn.description.trim().length < 10) {
        problems.push(`${fn.name}: missing description`);
      }
      const parameters = fn.parameters as any;
      if (!parameters || parameters.type !== "object") {
        problems.push(`${fn.name}: parameters.type must be "object"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("stays inside the portable JSON Schema subset", () => {
    const problems: string[] = [];
    for (const tool of allAvailableTools) {
      lint(tool.function.parameters, tool.function.name, problems);
    }
    expect(problems).toEqual([]);
  });
});
