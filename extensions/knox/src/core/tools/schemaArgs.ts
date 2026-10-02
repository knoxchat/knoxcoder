/**
 * Schema-driven tool argument handling.
 *
 * Models routinely send arguments whose *shape* is slightly off even when the
 * intent is clear: `"50"` for a number, `"true"` for a boolean, a JSON string
 * where an array is declared, `null` for an optional parameter, a single
 * object where a one-element array is declared, `"Start"` for enum `"start"`.
 * Implementations that guard with `typeof args.x === "number"` then silently
 * ignore the value, which looks like the tool "not working".
 *
 * Two steps, both driven by `tool.function.parameters` (JSON Schema):
 *
 * 1. {@link coerceArgsToSchema} repairs unambiguous shape mismatches. It never
 *    invents values and never touches text that is already the right type.
 * 2. {@link validateArgsAgainstSchema} rejects what is still wrong, with an
 *    actionable message (what was expected, what was received, and the full
 *    parameter list) so the model can fix the next call instead of guessing.
 *
 * Failure categories mirror the three classes a gateway scores on every call:
 * InvalidJson, UnknownName and SchemaMismatch. This module owns SchemaMismatch.
 */

import { ToolCallError, ToolCallErrorCode } from "./errors";

type JsonSchema = Record<string, any>;

export interface SchemaIssue {
  /** Dotted path from the argument root, e.g. `questions[0].options`. */
  path: string;
  expected: string;
  received: string;
}

const MAX_DEPTH = 5;
const MAX_ARRAY_CHECK = 25;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaredTypes(schema: JsonSchema | undefined): string[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }
  if (Array.isArray(schema.type)) {
    return schema.type.filter((t: unknown): t is string => typeof t === "string");
  }
  return typeof schema.type === "string" ? [schema.type] : [];
}

function variantsOf(schema: JsonSchema | undefined): JsonSchema[] {
  if (!schema) {
    return [];
  }
  const list = schema.anyOf ?? schema.oneOf;
  return Array.isArray(list)
    ? list.filter((v: unknown): v is JsonSchema => isPlainObject(v))
    : [];
}

function describeReceived(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    const clipped = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    return `string ${JSON.stringify(clipped)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value} ${String(value)}`;
  }
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function matchesAnyType(value: unknown, types: string[]): boolean {
  return types.length === 0 || types.some((type) => matchesType(value, type));
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("{"))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function canonicalEnum(value: unknown, schema: JsonSchema): unknown {
  if (!Array.isArray(schema.enum) || typeof value !== "string") {
    return value;
  }
  if (schema.enum.includes(value)) {
    return value;
  }
  const lowered = value.trim().toLowerCase();
  const hit = schema.enum.find(
    (candidate: unknown) =>
      typeof candidate === "string" && candidate.toLowerCase() === lowered,
  );
  return hit ?? value;
}

/** Coerce one value toward `schema`. Returns the value unchanged when unsure. */
function coerceValue(value: unknown, schema: JsonSchema | undefined, depth: number): unknown {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) {
    return value;
  }
  const types = declaredTypes(schema);
  if (types.length === 0) {
    const variants = variantsOf(schema);
    // Unions: coerce only when exactly one variant could take the value.
    if (variants.length > 0) {
      const strict = variants.filter(
        (variant) => findIssues(value, variant, "", depth + 1).length === 0,
      );
      if (strict.length > 0) {
        return value;
      }
      for (const variant of variants) {
        const next = coerceValue(value, variant, depth + 1);
        if (findIssues(next, variant, "", depth + 1).length === 0) {
          return next;
        }
      }
    }
    return canonicalEnum(value, schema);
  }

  let next = value;
  if (!matchesAnyType(next, types)) {
    next = coerceScalarOrContainer(next, types, schema, depth);
  }

  if (isPlainObject(next) && types.includes("object") && isPlainObject(schema.properties)) {
    const props = schema.properties as Record<string, JsonSchema>;
    const required = new Set<string>(
      Array.isArray(schema.required) ? schema.required : [],
    );
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(next)) {
      const propSchema = props[key];
      // `null` / `undefined` for an optional parameter means "not provided".
      if ((raw === null || raw === undefined) && !required.has(key) && propSchema) {
        const allowsNull = declaredTypes(propSchema).includes("null");
        if (!allowsNull) {
          continue;
        }
      }
      out[key] = propSchema ? coerceValue(raw, propSchema, depth + 1) : raw;
    }
    return out;
  }

  if (Array.isArray(next) && types.includes("array") && isPlainObject(schema.items)) {
    return next.map((item) => coerceValue(item, schema.items, depth + 1));
  }

  return canonicalEnum(next, schema);
}

function coerceScalarOrContainer(
  value: unknown,
  types: string[],
  schema: JsonSchema,
  depth: number,
): unknown {
  for (const type of types) {
    if (type === "number" || type === "integer") {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed !== "" && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) {
          const parsed = Number(trimmed);
          if (matchesType(parsed, type)) {
            return parsed;
          }
        }
      }
    } else if (type === "boolean") {
      if (typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (lowered === "true") {
          return true;
        }
        if (lowered === "false") {
          return false;
        }
      }
    } else if (type === "string") {
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
    } else if (type === "array") {
      if (typeof value === "string") {
        const parsed = tryParseJson(value);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
      // A lone value where a list is declared: wrap when it fits the items.
      if (value !== null && value !== undefined && !Array.isArray(value)) {
        const wrapped = coerceValue(value, schema.items, depth + 1);
        const itemTypes = declaredTypes(schema.items);
        if (
          isPlainObject(schema.items) &&
          (itemTypes.length === 0 ? false : matchesAnyType(wrapped, itemTypes))
        ) {
          return [wrapped];
        }
      }
    } else if (type === "object") {
      if (typeof value === "string") {
        const parsed = tryParseJson(value);
        if (isPlainObject(parsed)) {
          return parsed;
        }
      }
    }
  }
  return value;
}

/**
 * Repair unambiguous shape mismatches in `args` using the tool's JSON Schema.
 * Pure: returns a new object, never mutates the input.
 */
export function coerceArgsToSchema(
  args: Record<string, any>,
  schema: JsonSchema | undefined,
): Record<string, any> {
  if (!schema || typeof schema !== "object" || !isPlainObject(schema.properties)) {
    return args;
  }
  const coerced = coerceValue(args, { ...schema, type: "object" }, 0);
  return isPlainObject(coerced) ? (coerced as Record<string, any>) : args;
}

function typeLabel(schema: JsonSchema | undefined): string {
  const types = declaredTypes(schema);
  if (types.length) {
    if (types.includes("array") && isPlainObject(schema?.items)) {
      const inner = declaredTypes(schema?.items);
      if (inner.length === 1) {
        return `${inner[0]}[]`;
      }
    }
    return types.join(" | ");
  }
  const variants = variantsOf(schema);
  if (variants.length) {
    return variants.map((v) => typeLabel(v)).join(" | ");
  }
  return "any";
}

function findIssues(
  value: unknown,
  schema: JsonSchema | undefined,
  path: string,
  depth: number,
): SchemaIssue[] {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) {
    return [];
  }
  const label = path || "(arguments)";
  const types = declaredTypes(schema);

  if (types.length === 0) {
    const variants = variantsOf(schema);
    if (variants.length > 0) {
      const ok = variants.some(
        (variant) => findIssues(value, variant, path, depth + 1).length === 0,
      );
      return ok
        ? []
        : [{ path: label, expected: typeLabel(schema), received: describeReceived(value) }];
    }
    return enumIssues(value, schema, label);
  }

  if (!matchesAnyType(value, types)) {
    // `integer` received a fractional number reads better than "expected integer, got number".
    return [
      {
        path: label,
        expected: typeLabel(schema),
        received: describeReceived(value),
      },
    ];
  }

  const issues: SchemaIssue[] = enumIssues(value, schema, label);

  if (isPlainObject(value) && isPlainObject(schema.properties)) {
    const props = schema.properties as Record<string, JsonSchema>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (value[key] === undefined) {
        continue;
      }
      issues.push(
        ...findIssues(value[key], propSchema, path ? `${path}.${key}` : key, depth + 1),
      );
    }
  }

  if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.slice(0, MAX_ARRAY_CHECK).forEach((item, index) => {
      issues.push(...findIssues(item, schema.items, `${path}[${index}]`, depth + 1));
    });
  }

  return issues;
}

function enumIssues(value: unknown, schema: JsonSchema, label: string): SchemaIssue[] {
  if (!Array.isArray(schema.enum) || value === undefined) {
    return [];
  }
  if (schema.enum.includes(value)) {
    return [];
  }
  return [
    {
      path: label,
      expected: `one of ${schema.enum.map((v: unknown) => JSON.stringify(v)).join(", ")}`,
      received: describeReceived(value),
    },
  ];
}

/** All shape problems in `args` relative to `schema` (empty = valid). */
export function findSchemaIssues(
  args: Record<string, any>,
  schema: JsonSchema | undefined,
): SchemaIssue[] {
  if (!schema || typeof schema !== "object" || !isPlainObject(schema.properties)) {
    return [];
  }
  return findIssues(args, { ...schema, type: "object" }, "", 0);
}

/** One line per parameter: `name (type, required) - description`. */
export function describeToolParameters(schema: JsonSchema | undefined): string {
  if (!schema || !isPlainObject(schema.properties)) {
    return "";
  }
  const required = new Set<string>(
    Array.isArray(schema.required) ? schema.required : [],
  );
  return Object.entries(schema.properties as Record<string, JsonSchema>)
    .map(([name, prop]) => {
      const flags = [typeLabel(prop), required.has(name) ? "required" : "optional"];
      const description =
        typeof prop?.description === "string"
          ? ` - ${prop.description.split(/(?<=[.!?])\s/)[0]?.slice(0, 140)}`
          : "";
      return `  ${name} (${flags.join(", ")})${description}`;
    })
    .join("\n");
}

export const TOOL_FAILURE_CATEGORY_SCHEMA_MISMATCH = "SchemaMismatch";

/**
 * Throw a `ToolCallError` when `args` still violate the schema after coercion.
 * Required-parameter presence is handled by `validateToolArgs`; this covers
 * types and enums.
 */
export function validateArgsAgainstSchema(
  toolName: string,
  args: Record<string, any>,
  schema: JsonSchema | undefined,
): void {
  const issues = findSchemaIssues(args, schema);
  if (issues.length === 0) {
    return;
  }
  const lines = issues
    .slice(0, 6)
    .map((i) => `- ${i.path}: expected ${i.expected}, got ${i.received}`);
  const params = describeToolParameters(schema);
  throw new ToolCallError({
    code: ToolCallErrorCode.INVALID_ARGUMENTS,
    message:
      `Invalid arguments for "${toolName}" (SchemaMismatch):\n${lines.join("\n")}` +
      (params ? `\nParameters:\n${params}` : "") +
      `\nFix the argument types and call the tool again.`,
    toolName,
    retryable: false,
    context: {
      category: TOOL_FAILURE_CATEGORY_SCHEMA_MISMATCH,
      issues,
    },
  });
}
